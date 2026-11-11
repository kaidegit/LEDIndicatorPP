import { GENERATOR_VERSION } from '../protocol/build.js';
import type { Operation, PatternDefinition, Scenario } from '../protocol/types.js';

export function randomGenerator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

export function generateScenario(seed: number, heapSize: number, serial = 0): Scenario {
  const random = randomGenerator(seed + serial);
  const patterns: PatternDefinition[] = [0, 1, 2].map((type) => ({
    type,
    steps: [
      { type: 'HOLD', state: 'ON', durationMs: 20 + Math.floor(random() * 100) },
      { type: 'HOLD', state: 'OFF', durationMs: 20 + Math.floor(random() * 100) },
      { type: 'LOOP', durationMs: 0 },
    ],
  }));
  const operations: Operation[] = [];
  for (let index = 0; index < 24; index += 1) {
    const choice = random();
    if (choice < 0.35) operations.push({ op: 'advance', ms: Math.floor(random() * 120) });
    else if (choice < 0.75) operations.push({ op: 'update' });
    else if (choice < 0.9) operations.push({ op: 'start', type: Math.floor(random() * 3) });
    else operations.push({ op: 'stop', type: Math.floor(random() * 3) });
  }
  return {
    protocolVersion: 1,
    id: `fuzz-${seed}-${serial}`,
    driver: 'gpio',
    memory: { heapSize },
    patterns,
    operations,
    assertions: [{ type: 'reference' }, { type: 'noOverflow' }],
    budgets: { maxOperations: operations.length, timeoutMs: 2000 },
    seed,
  };
}

export function shrinkScenario(
  original: Scenario,
  isFailure: (candidate: Scenario) => Promise<boolean>,
): Promise<Scenario>;
export async function shrinkScenario(
  original: Scenario,
  isFailure: (candidate: Scenario) => Promise<boolean>,
): Promise<Scenario> {
  let current = structuredClone(original);
  let reduced = true;
  while (reduced) {
    reduced = false;
    let chunkSize = Math.max(1, Math.floor(current.operations.length / 2));
    while (chunkSize >= 1) {
      for (let start = 0; start < current.operations.length; start += chunkSize) {
        const candidate = structuredClone(current);
        candidate.operations.splice(start, chunkSize);
        if (candidate.operations.length === 0) continue;
        candidate.budgets.maxOperations = candidate.operations.length;
        if (await isFailure(candidate)) {
          current = candidate;
          reduced = true;
          break;
        }
      }
      chunkSize = Math.floor(chunkSize / 2);
    }
  }
  current.id = `${original.id}-shrunk`;
  return current;
}

export { GENERATOR_VERSION };
