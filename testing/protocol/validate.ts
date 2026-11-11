import { Ajv, type ErrorObject } from 'ajv';
import schema from './schema.json' with { type: 'json' };
import type { Scenario, Step } from './types.js';

const ajv = new Ajv({ allErrors: true, strict: false });
const validateSchema = ajv.compile(schema);

export class InputError extends Error {
  constructor(public readonly issues: string[]) {
    super(issues.join('; '));
    this.name = 'InputError';
  }
}

function issueText(error: ErrorObject): string {
  if (error.keyword === 'required') {
    const missing = (error.params as { missingProperty?: string }).missingProperty;
    return `${error.instancePath}/${missing} is required`.replace(/\/+/g, '/');
  }
  return `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`;
}

function validateStep(step: Step, path: string, robustness: boolean): string[] {
  const issues: string[] = [];
  if ((step.type === 'HOLD' || step.type === 'BREATHE') && step.state === undefined) issues.push(`${path}/state is required for ${step.type}`);
  if (step.type === 'BRIGHTNESS' && step.brightness === undefined) issues.push(`${path}/brightness is required`);
  if ((step.type === 'RGB' || step.type === 'IRGB') && step.color === undefined) issues.push(`${path}/color is required for ${step.type}`);
  if (step.type === 'IRGB' && step.index === undefined) issues.push(`${path}/index is required for IRGB`);
  return issues;
}

export function validateScenario(value: unknown): Scenario {
  if (!validateSchema(value)) throw new InputError((validateSchema.errors ?? []).map(issueText));
  const scenario = value as unknown as Scenario;
  const issues: string[] = [];
  if (scenario.operations.length > scenario.budgets.maxOperations) issues.push('/operations exceeds /budgets/maxOperations');
  const robustness = scenario.robustness ?? false;
  scenario.patterns.forEach((pattern, patternIndex) => {
    if (!robustness && pattern.steps.length === 0) issues.push(`/patterns/${patternIndex}/steps must not be empty outside robustness mode`);
    pattern.steps.forEach((step, stepIndex) => issues.push(...validateStep(step, `/patterns/${patternIndex}/steps/${stepIndex}`, robustness)));
  });
  scenario.operations.forEach((operation, operationIndex) => {
    if (operation.op === 'register') operation.steps.forEach((step, stepIndex) => issues.push(...validateStep(step, `/operations/${operationIndex}/steps/${stepIndex}`, robustness)));
  });
  if (issues.length > 0) throw new InputError(issues);
  return scenario;
}

export function parseScenario(text: string): Scenario {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new InputError([`/ is not valid JSON: ${error instanceof Error ? error.message : String(error)}`]);
  }
  return validateScenario(value);
}
