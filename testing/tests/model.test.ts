import { describe, expect, it } from 'vitest';
import { ReferenceModel } from '../engine/referenceModel.js';
import { deepEqual } from '../engine/equality.js';
import { parseWasmSections, sectionSize } from '../engine/size.js';
import { generateScenario } from '../engine/fuzz.js';

describe('reference model and deterministic utilities', () => {
  it('advances lower-priority patterns without writing their output', () => {
    const scenario = generateScenario(7, 32768);
    scenario.patterns = [
      { type: 0, steps: [{ type: 'HOLD', state: 'OFF', durationMs: 1000 }, { type: 'LOOP', durationMs: 0 }] },
      { type: 2, steps: [{ type: 'HOLD', state: 'ON', durationMs: 20 }, { type: 'HOLD', state: 'OFF', durationMs: 20 }, { type: 'LOOP', durationMs: 0 }] },
    ];
    scenario.operations = [
      { op: 'start', type: 2 },
      { op: 'update' },
      { op: 'start', type: 0 },
      { op: 'update' },
      { op: 'advance', ms: 500 },
      { op: 'update' },
    ];
    const model = new ReferenceModel(scenario);
    for (const operation of scenario.operations) model.apply(operation);
    const state = model.snapshot();
    expect(state.selectedType).toBe(0);
    expect(state.active[1]!.elapsedTime).toBeLessThan(200);
    expect(state.pinR).toBe(0);
  });

  it('uses object semantics rather than property insertion order', () => {
    expect(deepEqual({ a: 1, b: [2] }, { b: [2], a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
  });

  it('parses WASM code and data section sizes', () => {
    const binary = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 10, 2, 1, 0, 11, 3, 1, 0, 0]);
    const sections = parseWasmSections(binary);
    expect(sectionSize(sections, 10, 'code')).toBe(4);
    expect(sectionSize(sections, 11, 'data')).toBe(5);
  });
});
