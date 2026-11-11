import { buildInfo, environmentInfo } from '../protocol/build.js';
import type { Profile, Scenario, WasmExports } from '../protocol/types.js';
import { benchmarkWasm } from './benchmark.js';
import { readBlocks } from './binary.js';
import { resultFromError, ScenarioSession } from './session.js';

interface Request {
  kind: 'init' | 'step' | 'run' | 'finish' | 'blocks' | 'advance' | 'bench';
  scenario?: Scenario;
  profile?: Profile;
  artifactBase?: string;
  count?: number;
  ms?: number;
  samples?: number;
  batchSize?: number;
  warmups?: number;
}

let session: ScenarioSession | undefined;
let scenario: Scenario | undefined;
let profile: Profile = 'debug';
let loadedWasm: WasmExports | undefined;

async function loadWasm(nextProfile: Profile, artifactBase?: string): Promise<WasmExports> {
  const base = artifactBase?.replace(/\/$/, '') ?? '/wasm';
  const directory = nextProfile === 'debug' ? base : `${base}/${nextProfile}`;
  const [wasmResponse, metadataResponse] = await Promise.all([
    fetch(`${directory}/ledip_tester.wasm`),
    fetch(`${directory}/build.json`),
  ]);
  if (!wasmResponse.ok || !metadataResponse.ok) {
    throw new Error(`WASM ${nextProfile} artifacts are missing; run npm run build:all`);
  }
  const metadata = await metadataResponse.json() as { sourceRevision: string; emscripten: string };
  globalThis.__LEDIP_SOURCE_REVISION__ = metadata.sourceRevision;
  globalThis.__LEDIP_EMSCRIPTEN__ = metadata.emscripten;
  const wasmBinary = new Uint8Array(await wasmResponse.arrayBuffer());
  const modulePath = `${directory}/ledip_tester.js`;
  const { default: createModule } = await import(/* @vite-ignore */ modulePath);
  return createModule({ wasmBinary });
}

async function initialize(nextScenario: Scenario, nextProfile: Profile, artifactBase?: string): Promise<void> {
  loadedWasm = await loadWasm(nextProfile, artifactBase);
  session = new ScenarioSession(loadedWasm, nextScenario, nextProfile);
  scenario = nextScenario;
  profile = nextProfile;
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const request = event.data;
  const started = performance.now();
  try {
    if (request.kind === 'bench') {
      const wasm = await loadWasm('release');
      const measurement = benchmarkWasm(wasm, request.samples ?? 20, request.batchSize ?? 1000, request.warmups ?? 3);
      self.postMessage({
        kind: 'benchmark',
        report: {
          protocolVersion: 1,
          id: 'wasm-update-benchmark',
          status: 'pass',
          profile: 'release',
          environment: environmentInfo(),
          build: buildInfo('release'),
          ...measurement,
          note: 'Browser WASM baseline only; not MCU speed and not interchangeable with Node.',
        },
      });
      return;
    }
    if (request.kind === 'init') {
      await initialize(request.scenario!, request.profile ?? 'debug', request.artifactBase);
      self.postMessage({ kind: 'initialized', trace: session!.trace, state: session!.currentState });
      return;
    }
    if (!session || !scenario) throw new Error('session is not initialized');
    if (request.kind === 'blocks') {
      self.postMessage({
        kind: 'blocks',
        blocks: readBlocks(session.wasmExports, session.handleId),
      });
      return;
    }
    if (request.kind === 'step' || request.kind === 'advance') {
      const entries = request.kind === 'advance'
        ? session.advanceInteractively(request.ms ?? 0)
        : Array.from({ length: request.count ?? 1 }, () => session!.step()).filter(Boolean);
      self.postMessage({
        kind: 'stepped',
        entries,
        trace: session.trace,
        state: session.currentState,
        finished: session.finished,
      });
      return;
    }
    const result = request.kind === 'finish' ? session.finish() : session.run();
    result.metrics.durationMs = performance.now() - started;
    result.artifacts.wasm = '/wasm/ledip_tester.wasm';
    self.postMessage({ kind: 'result', result });
  } catch (error) {
    if (scenario) {
      const result = resultFromError(error, scenario, profile, session?.wasmExports ?? loadedWasm);
      result.trace = session?.trace ?? [];
      result.metrics.durationMs = performance.now() - started;
      self.postMessage({ kind: 'result', result });
    } else {
      self.postMessage({ kind: 'error', error: error instanceof Error ? error.message : String(error) });
    }
  }
};
