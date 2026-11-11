import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Scenario, ScenarioResult } from '../protocol/types.js';
import { markdownReport } from '../engine/markdownReport.js';

export function printResult(value: unknown, format: 'json' | 'text' | 'md'): void {
  if (format === 'md') {
    process.stdout.write(markdownReport(value));
    return;
  }
  if (format === 'json') {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  if (typeof value === 'object' && value && 'status' in value && 'id' in value) {
    const result = value as ScenarioResult;
    process.stdout.write(`${result.id}: ${result.status.toUpperCase()}\n`);
    for (const assertion of result.assertions ?? []) {
      if (assertion.status !== 'pass') {
        process.stdout.write(`  ${assertion.status}: ${assertion.message} at t=${assertion.time ?? '?'}, op=${assertion.operationIndex ?? '?'}\n`);
      }
    }
    if (result.error) process.stdout.write(`  ${result.error}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export async function saveReproduction(result: ScenarioResult, scenario: Scenario, directory: string): Promise<string> {
  await mkdir(directory, { recursive: true });
  const safeId = scenario.id.replace(/[^a-zA-Z0-9_.-]/g, '_');
  const path = resolve(directory, `${safeId}.repro.json`);
  await writeFile(path, JSON.stringify({
    protocolVersion: 1,
    kind: 'ledip-reproduction',
    scenario,
    effectiveConfig: result.effectiveConfig,
    trace: result.trace,
    build: result.build,
    environment: result.environment,
    firstFailure: result.assertions.find((assertion) => assertion.status === 'fail'),
  }, null, 2));
  return path;
}

export function exitCode(result: { status: string }): number {
  if (result.status === 'pass' || result.status === 'unsupported' || result.status === 'skipped') return 0;
  if (result.status === 'execution_error' || result.status === 'timeout') return 3;
  return 1;
}
