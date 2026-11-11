import { buildInfo, environmentInfo, GENERATOR_VERSION } from '../protocol/build.js';
import type {
  AssertionResult,
  MemoryStats,
  Operation,
  Profile,
  Scenario,
  ScenarioResult,
  StateSnapshot,
  TraceEntry,
  WasmExports,
} from '../protocol/types.js';
import { evaluateAssertions } from './assertions.js';
import { deepEqual } from './equality.js';
import { encodeSteps, readEvents, readMemory, readState } from './binary.js';
import { ReferenceModel, semanticSnapshot, UnsupportedModelCase } from './referenceModel.js';

const DRIVER_IDS = { recorder: 0, gpio: 1, 'rgb-gpio': 2, none: 3 };
const OPERATION_IDS = { register: 0, start: 1, stop: 2, advance: 3, update: 4, batch: 5, failAllocation: 6, checkpoint: 7 };

export class ExecutionFailure extends Error {
  constructor(
    message: string,
    public readonly reason: 'oom' | 'trace_overflow' | 'invalid_input' | 'worker_error',
  ) {
    super(message);
  }
}

export class ScenarioSession {
  readonly trace: TraceEntry[] = [];
  readonly referenceResults: AssertionResult[] = [];
  private handle = -1;
  private time = 0;
  private operationIndex = 0;
  private model?: ReferenceModel;
  private failureAt: number;
  private destroyed = false;
  private beforeDestroy?: MemoryStats;
  private afterDestroy?: MemoryStats;

  constructor(
    private readonly wasm: WasmExports,
    readonly scenario: Scenario,
    readonly profile: Profile = 'debug',
  ) {
    this.failureAt = scenario.memory.failAllocationAt ?? 0;
    this.handle = wasm._ledip_create(
      DRIVER_IDS[scenario.driver],
      scenario.activeLevel ?? 1,
      scenario.memory.heapSize,
      this.failureAt,
      scenario.memory.eventCapacity ?? 4096,
    );
    if (this.handle === -4) throw new ExecutionFailure('allocation failed while creating instance', 'oom');
    if (this.handle < 0) throw new ExecutionFailure(`WASM create failed with code ${this.handle}`, 'invalid_input');
    if (scenario.assertions.some((assertion) => assertion.type === 'reference')) {
      this.model = new ReferenceModel(scenario);
    }
    for (const pattern of scenario.patterns) {
      this.call(this.wasm._ledip_add_pattern(this.handle, pattern.type, encodeSteps(this.wasm, pattern.steps)), -1);
    }
    this.capture({ op: 'initial' }, -1);
  }

  get currentTime(): number {
    return this.time;
  }

  get wasmExports(): WasmExports {
    return this.wasm;
  }

  get handleId(): number {
    return this.handle;
  }

  get currentState(): StateSnapshot {
    return this.trace.at(-1)!.state;
  }

  get finished(): boolean {
    return this.operationIndex >= this.scenario.operations.length;
  }

  step(): TraceEntry | undefined {
    if (this.finished || this.destroyed) return undefined;
    const index = this.operationIndex;
    const operation = this.scenario.operations[index]!;
    this.wasm._ledip_configure_failure(this.handle, this.failureAt, OPERATION_IDS[operation.op], index);
    this.apply(operation, index);
    this.operationIndex += 1;
    return this.capture(operation, index);
  }

  advanceInteractively(milliseconds: number): TraceEntry[] {
    if (this.destroyed) return [];
    const operations: Operation[] = [
      { op: 'advance', ms: milliseconds },
      { op: 'update' },
    ];
    this.scenario.operations.splice(this.operationIndex, 0, ...operations);
    this.scenario.budgets.maxOperations += operations.length;
    return operations.map(() => this.step()!);
  }

  run(): ScenarioResult {
    while (!this.finished) this.step();
    return this.finish();
  }

  finish(): ScenarioResult {
    if (!this.destroyed) {
      this.beforeDestroy = readMemory(this.wasm, this.handle);
      this.call(this.wasm._ledip_destroy(this.handle), this.operationIndex);
      this.afterDestroy = readMemory(this.wasm, this.handle);
      this.capture({ op: 'destroy' }, this.operationIndex);
      this.destroyed = true;
    }
    const beforeDestroy = this.beforeDestroy!;
    const afterDestroy = this.afterDestroy!;
    const assertions = [
      ...this.referenceResults,
      ...evaluateAssertions(this.scenario.assertions.filter((assertion) => assertion.type !== 'reference'), this.trace, beforeDestroy, afterDestroy),
    ];
    if (this.currentState.unsupportedMask !== 0) {
      for (const assertion of this.scenario.assertions.filter((item) => item.type === 'reference')) {
        assertions.push({ assertion, status: 'unsupported', message: `unsupported step mask 0x${this.currentState.unsupportedMask.toString(16)}` });
      }
    }
    const overflow = this.currentState.eventOverflow > 0;
    const failed = assertions.some((assertion) => assertion.status === 'fail');
    const unsupported = this.currentState.unsupportedMask !== 0
      || assertions.some((assertion) => assertion.status === 'unsupported');
    const status = overflow || failed ? 'fail' : unsupported ? 'unsupported' : 'pass';
    const reason = overflow ? 'trace_overflow' : failed ? 'assertion' : unsupported ? 'unsupported' : undefined;
    const result: ScenarioResult = {
      protocolVersion: 1,
      id: this.scenario.id,
      status,
      build: buildInfo(this.profile),
      environment: environmentInfo(),
      effectiveConfig: this.scenario,
      assertions,
      trace: this.trace,
      metrics: {
        operations: this.operationIndex,
        events: this.trace.reduce((total, entry) => total + entry.events.length, 0),
        durationMs: 0,
        beforeDestroy,
        afterDestroy,
        wasmMemoryBytes: this.wasm.HEAPU8.byteLength,
        staticBytes: null,
        tlsfPoolBytes: afterDestroy.physicalPoolBytes,
        stackReservedBytes: 1048576,
        stackHighWaterBytes: (this.wasm._ledip_stack_high_water() >>> 0) === 0xffff_ffff ? null : this.wasm._ledip_stack_high_water(),
      },
      artifacts: {},
      reproduce: {
        command: `ledip_tester run --scenario ${this.scenario.id}.json --format json`,
        generatorVersion: GENERATOR_VERSION,
      },
    };
    if (this.scenario.seed !== undefined) result.seed = this.scenario.seed;
    if (reason) result.reason = reason;
    if (afterDestroy.liveBlocks !== 0) {
      result.status = 'fail';
      result.reason = result.reason ?? 'oom';
      result.error = `${afterDestroy.liveBlocks} blocks (${afterDestroy.currentPoolBytes} bytes) remain after destroy`;
    }
    if (this.scenario.robustness && result.status === 'pass' && this.scenario.assertions.length === 0) {
      result.status = 'skipped';
      result.error = 'probe completed without assertions; this does not demonstrate capability support';
    }
    return result;
  }

  private apply(operation: Operation, index: number): void {
    let code = 0;
    switch (operation.op) {
      case 'register':
        code = this.wasm._ledip_add_pattern(this.handle, operation.type, encodeSteps(this.wasm, operation.steps));
        break;
      case 'start':
        code = this.wasm._ledip_start(this.handle, operation.type);
        break;
      case 'stop':
        code = this.wasm._ledip_stop(this.handle, operation.type);
        break;
      case 'advance':
        this.time += operation.ms;
        this.wasm._ledip_set_time(this.handle, this.time >>> 0);
        break;
      case 'update':
        code = this.wasm._ledip_update(this.handle);
        break;
      case 'batch':
        this.time += operation.count * operation.intervalMs;
        code = this.wasm._ledip_run_batch(this.handle, operation.count, operation.intervalMs);
        break;
      case 'failAllocation':
        this.failureAt = operation.nth ?? 0;
        this.wasm._ledip_configure_failure(this.handle, this.failureAt, OPERATION_IDS[operation.op], index);
        break;
      case 'checkpoint':
        break;
    }
    this.call(code, index);
  }

  private capture(operation: TraceEntry['operation'], operationIndex: number): TraceEntry {
    if (this.wasm._ledip_check_memory(this.handle) !== 0) {
      throw new ExecutionFailure('TLSF consistency or redzone check failed', 'worker_error');
    }
    const state = readState(this.wasm, this.handle, this.time);
    const events = readEvents(this.wasm, this.handle, this.time, operationIndex);
    const memory = readMemory(this.wasm, this.handle);
    const entry: TraceEntry = { operationIndex, operation, time: this.time, state, events, memory };
    this.trace.push(entry);
    if (this.model && operation.op !== 'initial' && operation.op !== 'destroy') {
      this.compareReference(operation, operationIndex, state);
    }
    return entry;
  }

  private compareReference(operation: Operation, operationIndex: number, actual: StateSnapshot): void {
    if (this.referenceResults.some((result) => result.status !== 'pass')) return;
    try {
      const expected = this.model!.apply(operation);
      const expectedSemantic = semanticSnapshot(expected);
      const actualSemantic = semanticSnapshot(actual);
      if (!deepEqual(expectedSemantic, actualSemantic)) {
        const assertion = this.scenario.assertions.find((item) => item.type === 'reference')!;
        this.referenceResults.push({
          assertion,
          status: 'fail',
          message: 'first reference-model deviation',
          time: this.time,
          operationIndex,
          expected: expectedSemantic,
          actual: actualSemantic,
        });
      }
    } catch (error) {
      if (!(error instanceof UnsupportedModelCase)) throw error;
      const assertion = this.scenario.assertions.find((item) => item.type === 'reference')!;
      this.referenceResults.push({ assertion, status: 'unsupported', message: error.message, time: this.time, operationIndex });
    }
  }

  private call(code: number, operationIndex: number): void {
    if (code === 0) return;
    if (code === 3 || code === -4) throw new ExecutionFailure(`allocation failed at operation ${operationIndex}`, 'oom');
    if (code === 4) throw new ExecutionFailure('event buffer overflow', 'trace_overflow');
    throw new ExecutionFailure(`WASM operation ${operationIndex} failed with code ${code}`, 'invalid_input');
  }
}

export function resultFromError(
  error: unknown,
  scenario: Scenario,
  profile: Profile,
  wasm?: WasmExports,
): ScenarioResult {
  const failure = error instanceof ExecutionFailure
    ? error
    : new ExecutionFailure(error instanceof Error ? error.message : String(error), 'worker_error');
  const isTrap = error instanceof Error && (error.name === 'RuntimeError' || error.message.includes('unreachable'));
  const failureMemory = wasm ? readMemory(wasm, -1) : undefined;
  const result: ScenarioResult = {
    protocolVersion: 1,
    id: scenario.id,
    status: failure.reason === 'invalid_input' ? 'fail' : 'execution_error',
    reason: isTrap ? 'trap' : failure.reason,
    build: buildInfo(profile),
    environment: environmentInfo(),
    effectiveConfig: scenario,
    assertions: [],
    trace: [],
    metrics: {
      operations: 0,
      events: 0,
      durationMs: 0,
      ...(failureMemory ? { failureMemory } : {}),
    },
    artifacts: {},
    reproduce: { command: `ledip_tester run --scenario ${scenario.id}.json --format json` },
    error: failure.message,
  };
  if (failureMemory && failureMemory.failureCount > 0) {
    result.error += `; allocation #${failureMemory.lastFailureIndex}, ${failureMemory.lastFailureSize} bytes, operation ${failureMemory.lastFailureOperationIndex}`;
  }
  return result;
}
