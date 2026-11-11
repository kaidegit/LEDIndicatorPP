import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import { runIsolated } from '../engine/isolated.js';
import { nodePackage } from '../engine/nodeLoader.js';
import { parseScenario } from '../protocol/validate.js';
import type { ScenarioResult } from '../protocol/types.js';

async function createWebWorker() {
  const { root } = await nodePackage();
  const worker = new Worker(resolve(root, 'dist/tests/webWorkerHost.js'));
  const request = <T>(message: Record<string, unknown>) => new Promise<T>((resolve, reject) => {
    worker.once('error', reject);
    worker.once('message', (response) => {
      if (response.kind === 'error') reject(new Error(response.error));
      else resolve(response as T);
    });
    worker.postMessage(message);
  });
  return { worker, request, root };
}

function semanticResult(result: ScenarioResult): unknown {
  return {
    status: result.status,
    reason: result.reason,
    assertions: result.assertions,
    trace: result.trace,
  };
}

describe('Web Worker shared engine', () => {
  it('matches the complete deterministic Node result', async () => {
    const { root } = await nodePackage();
    const scenario = parseScenario(await readFile(resolve(root, 'scenarios/regression/basic-gpio.json'), 'utf8'));
    const nodeResult = await runIsolated(scenario);
    const { worker, request } = await createWebWorker();
    try {
      await request({ kind: 'init', scenario, artifactBase: pathToFileURL(resolve(root, 'wasm/build/debug')).href });
      const response = await request<{ result: ScenarioResult }>({ kind: 'run' });
      expect(response.result.environment.host).toBe('node');
      expect(semanticResult(response.result)).toEqual(semanticResult(nodeResult));
    } finally {
      await worker.terminate();
    }
  });

  it('supports step, resume, destroy and TLSF block reads', async () => {
    const { root } = await nodePackage();
    const scenario = parseScenario(await readFile(resolve(root, 'scenarios/regression/basic-gpio.json'), 'utf8'));
    const { worker, request } = await createWebWorker();
    try {
      await request({ kind: 'init', scenario, artifactBase: pathToFileURL(resolve(root, 'wasm/build/debug')).href });
      const stepped = await request<{ trace: unknown[] }>({ kind: 'step', count: 2 });
      expect(stepped.trace).toHaveLength(3);
      const response = await request<{ result: ScenarioResult }>({ kind: 'run' });
      expect(response.result.status).toBe('pass');
      const blocks = await request<{ blocks: unknown[] }>({ kind: 'blocks' });
      expect(blocks.blocks.length).toBeGreaterThan(0);
    } finally {
      await worker.terminate();
    }
  });
});
