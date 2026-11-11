import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import { parentPort } from 'node:worker_threads';
import { buildInfo, environmentInfo } from '../protocol/build.js';
import type { Profile, Scenario } from '../protocol/types.js';
import { benchmarkWasm } from './benchmark.js';
import { createNodeWasm } from './nodeLoader.js';
import { resultFromError, ScenarioSession } from './session.js';

interface RunMessage {
  kind: 'run';
  scenario: Scenario;
  profile: Profile;
}

interface BenchMessage {
  kind: 'bench';
  samples: number;
  batchSize: number;
  warmups: number;
}

async function runBenchmark(message: BenchMessage) {
  const wasm = await createNodeWasm('release');
  const measurement = benchmarkWasm(wasm, message.samples, message.batchSize, message.warmups);
  return {
    protocolVersion: 1,
    id: 'wasm-update-benchmark',
    status: 'pass',
    profile: 'release',
    environment: {
      ...environmentInfo(),
      cpu: cpus()[0]?.model ?? 'unknown',
    },
    build: buildInfo('release'),
    ...measurement,
    note: 'WASM timings are not MCU speed measurements; Node and browser baselines are separate.',
  };
}

parentPort!.on('message', async (message: RunMessage | BenchMessage) => {
  const started = performance.now();
  let wasm: Awaited<ReturnType<typeof createNodeWasm>> | undefined;
  let session: ScenarioSession | undefined;
  try {
    if (message.kind === 'bench') {
      parentPort!.postMessage(await runBenchmark(message));
      return;
    }
    wasm = await createNodeWasm(message.profile);
    session = new ScenarioSession(wasm, message.scenario, message.profile);
    const result = session.run();
    result.metrics.durationMs = performance.now() - started;
    if (globalThis.__LEDIP_WASM_PATH__) result.artifacts.wasm = globalThis.__LEDIP_WASM_PATH__;
    parentPort!.postMessage(result);
  } catch (error) {
    if (message.kind === 'run') {
      const result = resultFromError(error, message.scenario, message.profile, wasm);
      result.trace = session?.trace ?? [];
      result.metrics.durationMs = performance.now() - started;
      if (globalThis.__LEDIP_WASM_PATH__) result.artifacts.wasm = globalThis.__LEDIP_WASM_PATH__;
      parentPort!.postMessage(result);
    } else {
      parentPort!.postMessage({ status: 'execution_error', error: error instanceof Error ? error.stack : String(error) });
    }
  }
});
