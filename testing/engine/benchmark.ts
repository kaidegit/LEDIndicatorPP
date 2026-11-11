import type { Scenario, WasmExports } from '../protocol/types.js';
import { readState } from './binary.js';
import { ScenarioSession } from './session.js';

export interface BenchmarkMeasurement {
  configuration: { patterns: number; samples: number; warmups: number; batchSize: number };
  wasmBatchMs: { median: number; p95: number; samples: number[] };
  jsToWasmMs: { total: number; perUpdate: number };
  perUpdateMs: number;
  checksum: number;
}

function percentile(sorted: number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))]!;
}

export function benchmarkWasm(
  wasm: WasmExports,
  samples: number,
  batchSize: number,
  warmups: number,
): BenchmarkMeasurement {
  if (samples < 1 || batchSize < 1 || warmups < 0) throw new Error('invalid benchmark configuration');
  const patternCount = 32;
  const scenario: Scenario = {
    protocolVersion: 1,
    id: 'benchmark',
    driver: 'gpio',
    memory: { heapSize: 256 * 1024, eventCapacity: 16 },
    patterns: Array.from({ length: patternCount }, (_, type) => ({
      type,
      steps: [
        { type: 'HOLD', state: 'ON', durationMs: 10 },
        { type: 'HOLD', state: 'OFF', durationMs: 10 },
        { type: 'LOOP', durationMs: 0 },
      ],
    })),
    operations: [],
    assertions: [],
    budgets: { maxOperations: 1, timeoutMs: 30000 },
  };
  const session = new ScenarioSession(wasm, scenario, 'release');
  const handle = session.handleId;
  for (let type = 0; type < patternCount; type += 1) wasm._ledip_start(handle, type);
  for (let index = 0; index < warmups; index += 1) {
    wasm._ledip_run_batch(handle, batchSize, 1);
  }
  const durations: number[] = [];
  for (let index = 0; index < samples; index += 1) {
    const start = performance.now();
    const code = wasm._ledip_run_batch(handle, batchSize, 1);
    durations.push(performance.now() - start);
    if (code !== 0) throw new Error(`benchmark batch failed: ${code}`);
  }
  const crossBoundaryStart = performance.now();
  for (let index = 0; index < batchSize; index += 1) wasm._ledip_update(handle);
  const crossBoundaryMs = performance.now() - crossBoundaryStart;
  const sorted = [...durations].sort((left, right) => left - right);
  const checksum = readState(wasm, handle, 0).pinR;
  if (checksum !== 0 && checksum !== 1) throw new Error('benchmark produced no valid GPIO output');
  session.finish();
  return {
    configuration: { patterns: patternCount, samples, warmups, batchSize },
    wasmBatchMs: {
      median: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      samples: durations,
    },
    jsToWasmMs: {
      total: crossBoundaryMs,
      perUpdate: crossBoundaryMs / batchSize,
    },
    perUpdateMs: percentile(sorted, 0.5) / batchSize,
    checksum,
  };
}
