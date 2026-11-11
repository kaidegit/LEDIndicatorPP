import { resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { Profile, Scenario, ScenarioResult } from '../protocol/types.js';
import { nodePackage } from './nodeLoader.js';
import { resultFromError } from './session.js';

class WorkerTimeout extends Error {}

interface WorkerOptions {
  kind: 'run' | 'bench';
  scenario?: Scenario;
  profile?: Profile;
  timeoutMs: number;
  samples?: number;
  batchSize?: number;
  warmups?: number;
}

export async function runWorker<T>(options: WorkerOptions): Promise<T> {
  const { root } = await nodePackage();
  const workerPath = resolve(root, 'dist/engine/nodeWorker.js');
  return new Promise((resolveResult, reject) => {
    const worker = new Worker(workerPath, { stdout: true, stderr: true });
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      action();
    };
    const timer = setTimeout(
      () => finish(() => reject(new WorkerTimeout('worker exceeded real-time budget'))),
      options.timeoutMs,
    );
    worker.stdout.on('data', (chunk) => process.stderr.write(chunk));
    worker.stderr.on('data', (chunk) => process.stderr.write(chunk));
    worker.once('message', (message: T) => finish(() => resolveResult(message)));
    worker.once('error', (error) => finish(() => reject(error)));
    worker.once('exit', (code) => {
      if (code !== 0 && !settled) {
        finish(() => reject(new Error(`worker exited with code ${code}`)));
      }
    });
    worker.postMessage(options);
  });
}

export async function runIsolated(scenario: Scenario, profile: Profile = 'debug'): Promise<ScenarioResult> {
  try {
    return await runWorker<ScenarioResult>({
      kind: 'run',
      scenario,
      profile,
      timeoutMs: scenario.budgets.timeoutMs,
    });
  } catch (error) {
    const result = resultFromError(error, scenario, profile);
    if (error instanceof WorkerTimeout) {
      result.status = 'timeout';
      result.reason = 'timeout';
      result.error = `real-time budget ${scenario.budgets.timeoutMs} ms exceeded; worker terminated`;
    } else {
      result.status = 'execution_error';
      result.reason = result.error?.includes('RuntimeError') ? 'trap' : 'worker_error';
    }
    return result;
  }
}
