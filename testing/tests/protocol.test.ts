import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { InputError, parseScenario, validateScenario } from '../protocol/validate.js';
import { generateScenario } from '../engine/fuzz.js';

const basicPath = new URL('../scenarios/regression/basic-gpio.json', import.meta.url);

describe('scenario protocol', () => {
  it('loads a valid scenario', async () => {
    const scenario = parseScenario(await readFile(basicPath, 'utf8'));
    expect(scenario.id).toBe('basic-gpio');
    expect(scenario.protocolVersion).toBe(1);
  });

  it('reports the field path for malformed input', () => {
    expect(() => parseScenario('{"protocolVersion":1,"id":"x"}')).toThrow(InputError);
    try {
      parseScenario('{"protocolVersion":1,"id":"x"}');
    } catch (error) {
      expect((error as InputError).issues.join('\n')).toContain('/memory');
    }
  });

  it('keeps unsafe component probes separate from normal validation', () => {
    const scenario = generateScenario(123, 32768);
    scenario.patterns[0]!.steps = [];
    expect(() => validateScenario(scenario)).toThrow(/must not be empty/);
    scenario.robustness = true;
    expect(validateScenario(scenario).robustness).toBe(true);
  });

  it('accepts unsupported steps so execution can report their capability', () => {
    const scenario = generateScenario(123, 32768);
    scenario.patterns[0]!.steps[0] = { type: 'HSV', durationMs: 10, color: [0, 0, 0] };
    expect(validateScenario(scenario).patterns[0]!.steps[0]!.type).toBe('HSV');
  });
});
