import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { runIsolated } from '../engine/isolated.js';
import { readMemory } from '../engine/binary.js';
import { createNodeWasm } from '../engine/nodeLoader.js';
import { parseScenario } from '../protocol/validate.js';
import { generateScenario, shrinkScenario } from '../engine/fuzz.js';

async function scenario(path: string) {
  return parseScenario(await readFile(new URL(path, import.meta.url), 'utf8'));
}

describe('real component in WASM', () => {
  it('runs the basic scenario and releases every allocation', async () => {
    const result = await runIsolated(await scenario('../scenarios/regression/basic-gpio.json'));
    expect(result.status).toBe('pass');
    expect(result.metrics.afterDestroy?.liveBlocks).toBe(0);
    expect(result.trace.some((entry) => entry.events.some((event) => event.kind === 'pin'))).toBe(true);
  });

  it('keeps RGB color requests separate from actual pins', async () => {
    const result = await runIsolated(await scenario('../scenarios/regression/rgb-cache-pins.json'));
    expect(result.status).toBe('pass');
    expect(result.trace[2]?.state.requestedColor).toEqual([1, 0, 0, 0]);
    expect(result.trace[2]?.state.pinR).toBe(-1);
  });

  it('terminates an infinite zero-duration loop outside the worker', async () => {
    const result = await runIsolated(await scenario('../scenarios/robustness/zero-duration-loop.json'));
    expect(result.status).toBe('timeout');
    expect(result.reason).toBe('timeout');
  });

  it('reports pool exhaustion instead of falling back to the default heap', async () => {
    const result = await runIsolated(await scenario('../scenarios/robustness/pool-exhaustion.json'));
    expect(result.status).toBe('execution_error');
    expect(result.reason).toBe('oom');
  });

  it('injects the requested allocation failure', async () => {
    const input = await scenario('../scenarios/regression/basic-gpio.json');
    input.memory.failAllocationAt = 3;
    const result = await runIsolated(input);
    expect(result.status).toBe('execution_error');
    expect(result.reason).toBe('oom');
    expect(result.metrics.failureMemory?.lastFailureIndex).toBe(3);
    expect(result.metrics.failureMemory?.lastFailureOperationIndex).toBe(-1);
  });

  it('reports event overflow instead of silently dropping output', async () => {
    const input = await scenario('../scenarios/regression/basic-gpio.json');
    input.memory.eventCapacity = 1;
    const result = await runIsolated(input);
    expect(result.status).toBe('fail');
    expect(result.reason).toBe('trace_overflow');
  });

  it('matches the independent model for fixed-seed generated scenarios', async () => {
    for (const seed of [1, 12345, 0xffffffff]) {
      const result = await runIsolated(generateScenario(seed, 32768));
      expect(result.status, `${seed}: ${result.error ?? ''}`).toBe('pass');
    }
  });

  it('covers C/C++ allocation families in the fixed TLSF pool', async () => {
    const wasm = await createNodeWasm('memory-check');
    const handle = wasm._ledip_create(0, 1, 65536, 0, 16);
    expect(handle).toBeGreaterThanOrEqual(0);
    expect(wasm._ledip_allocator_self_test()).toBe(0);
    expect(wasm._ledip_destroy(handle)).toBe(0);
    expect(readMemory(wasm, handle).liveBlocks).toBe(0);
  });

  it('shrinks a failing scenario and confirms the reduced failure', async () => {
    const input = generateScenario(42, 32768);
    input.assertions.push({ type: 'state', at: 0, field: 'activeCount', equals: 999 });
    const isFailure = async (candidate: typeof input) => (await runIsolated(candidate)).status !== 'pass';
    const shrunk = await shrinkScenario(input, isFailure);
    expect(shrunk.operations.length).toBeLessThan(input.operations.length);
    expect((await runIsolated(shrunk)).status).toBe('fail');
  });
});
