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
  it.each([0, 1] as const)('models the initial white RGB cache at active level %i', async (activeLevel) => {
    const input = await scenario('../scenarios/regression/basic-gpio.json');
    input.driver = 'rgb-gpio';
    input.activeLevel = activeLevel;
    input.operations = [{ op: 'start', type: 0 }, { op: 'update' }];
    input.assertions = [{ type: 'reference' }];
    const result = await runIsolated(input);
    expect(result.status).toBe('pass');
    expect(result.trace[2]!.state.requestedColor).toEqual([0, 0, 0, 0]);
    expect([result.trace[2]!.state.pinR, result.trace[2]!.state.pinG, result.trace[2]!.state.pinB]).toEqual([activeLevel, activeLevel, activeLevel]);
  });

  it('reads all active patterns across multiple observation pages', async () => {
    const input = await scenario('../scenarios/regression/basic-gpio.json');
    input.patterns = Array.from({ length: 40 }, (_, type) => ({ type, steps: input.patterns[0]!.steps }));
    input.operations = [...input.patterns.map(({ type }) => ({ op: 'start' as const, type })), { op: 'update' }];
    input.budgets.maxOperations = input.operations.length;
    input.memory.heapSize = 65536;
    input.assertions = [{ type: 'reference' }];
    const result = await runIsolated(input);
    expect(result.status).toBe('pass');
    const state = result.trace.at(-2)!.state;
    expect(state.activeCount).toBe(40);
    expect(state.active.map(({ type }) => type)).toEqual(input.patterns.map(({ type }) => type));
    expect(state.active.every(({ firstStart }) => !firstStart)).toBe(true);
  });

  it('distinguishes configured capacity from the fixed backing reservation', async () => {
    for (const heapSize of [32768, 65536]) {
      const input = await scenario('../scenarios/regression/basic-gpio.json');
      input.memory.heapSize = heapSize;
      const result = await runIsolated(input);
      expect(result.status).toBe('pass');
      expect(result.metrics.afterDestroy).toMatchObject({ configuredBytes: heapSize, physicalPoolBytes: 1048576, currentPoolBytes: 0 });
      expect(result.metrics.tlsfPoolBytes).toBe(1048576);
    }
  });

  it('classifies allocation failure during start as OOM', async () => {
    const input = await scenario('../scenarios/regression/basic-gpio.json');
    input.memory.failAllocationAt = 5;
    const result = await runIsolated(input);
    expect(result).toMatchObject({ status: 'execution_error', reason: 'oom' });
    expect(result.metrics.failureMemory).toMatchObject({ lastFailureIndex: 5, lastFailureOperation: 1, lastFailureOperationIndex: 0 });
  });

  it.each(['stop', 'update', 'batch'] as const)('classifies restoration allocation failure during %s as OOM', async (op) => {
    const input = await scenario('../scenarios/regression/basic-gpio.json');
    input.patterns = [
      { type: 0, steps: [{ type: 'HOLD', state: 'OFF', durationMs: 10 }, { type: 'STOP', durationMs: 0 }] },
      { type: 1, steps: [{ type: 'HOLD', state: 'ON', durationMs: 100 }, { type: 'LOOP', durationMs: 0 }] },
    ];
    input.operations = [{ op: 'start', type: 1 }, { op: 'start', type: 0 }, { op: 'update' }];
    input.assertions = [];
    const baseline = await runIsolated(input);
    expect(baseline.status).toBe('pass');
    const nextAllocation = baseline.metrics.beforeDestroy!.allocationCount + 1;
    input.operations.push({ op: 'failAllocation', nth: nextAllocation });
    if (op === 'stop') input.operations.push({ op, type: 0 });
    else if (op === 'batch') input.operations.push({ op, count: 1, intervalMs: 10 });
    else input.operations.push({ op: 'advance', ms: 10 }, { op });
    input.budgets.maxOperations = input.operations.length;
    const result = await runIsolated(input);
    expect(result).toMatchObject({ status: 'execution_error', reason: 'oom' });
    expect(result.metrics.failureMemory?.lastFailureIndex).toBe(nextAllocation);
    expect(result.metrics.failureMemory?.lastFailureOperationIndex).toBe(input.operations.length - 1);
  });

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
