import type { MemoryBlock } from '../engine/binary.js';
import { resultFromError } from '../engine/session.js';
import type { Scenario, ScenarioResult, StateSnapshot, TraceEntry } from '../protocol/types.js';

interface StepResponse {
  trace: TraceEntry[];
  state: StateSnapshot;
  finished: boolean;
}

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class BrowserRunner {
  private worker: Worker | undefined;
  private pending: PendingRequest | undefined;
  private scenario: Scenario | undefined;
  private timeoutMs = 3000;

  async initialize(scenario: Scenario): Promise<TraceEntry[]> {
    this.stop();
    this.scenario = scenario;
    this.timeoutMs = scenario.budgets.timeoutMs;
    this.worker = new Worker(new URL('../engine/webWorker.ts', import.meta.url), { type: 'module' });
    const response = await this.request<StepResponse>({ kind: 'init', scenario, profile: 'debug' });
    return response.trace;
  }

  async run(scenario: Scenario): Promise<ScenarioResult> {
    try {
      await this.initialize(scenario);
      return await this.request<ScenarioResult>({ kind: 'run' });
    } catch (error) {
      const result = resultFromError(error, scenario, 'debug');
      if (error instanceof Error && error.name === 'WorkerTimeout') {
        result.status = 'timeout';
        result.reason = 'timeout';
      }
      return result;
    }
  }

  async step(count = 1): Promise<StepResponse> {
    return this.request<StepResponse>({ kind: 'step', count });
  }

  async advance(milliseconds: number): Promise<StepResponse> {
    return this.request<StepResponse>({ kind: 'advance', ms: milliseconds });
  }

  async finish(): Promise<ScenarioResult> {
    return this.request<ScenarioResult>({ kind: 'finish' });
  }

  async benchmark(samples = 20, batchSize = 1000): Promise<Record<string, unknown>> {
    this.stop();
    this.worker = new Worker(new URL('../engine/webWorker.ts', import.meta.url), { type: 'module' });
    this.timeoutMs = 120000;
    const response = await this.request<{ report: Record<string, unknown> }>({
      kind: 'bench',
      samples,
      batchSize,
      warmups: 3,
    });
    return response.report;
  }

  async blocks(): Promise<MemoryBlock[]> {
    const response = await this.request<{ blocks: MemoryBlock[] }>({ kind: 'blocks' });
    return response.blocks;
  }

  stop(): void {
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(new Error('worker cancelled'));
      this.pending = undefined;
    }
    this.worker?.terminate();
    this.worker = undefined;
  }

  private request<T>(message: Record<string, unknown>): Promise<T> {
    if (!this.worker) return Promise.reject(new Error('worker is not initialized'));
    if (this.pending) return Promise.reject(new Error('another request is still running'));
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending) clearTimeout(this.pending.timer);
        this.pending = undefined;
        this.worker?.terminate();
        this.worker = undefined;
        reject(Object.assign(new Error('worker exceeded real-time budget'), { name: 'WorkerTimeout' }));
      }, this.timeoutMs);
      this.pending = { resolve, reject, timer };
      this.worker!.onmessage = (event: MessageEvent) => {
        const data = event.data;
        const pending = this.pending;
        if (!pending) return;
        this.pending = undefined;
        clearTimeout(pending.timer);
        if (data.kind === 'error') pending.reject(new Error(data.error));
        else if (data.kind === 'result') pending.resolve(data.result);
        else pending.resolve(data);
      };
      this.worker!.onerror = (event) => {
        this.stop();
        reject(new Error(event.message));
      };
      this.worker!.postMessage(message);
    });
  }
}
