export const PROTOCOL_VERSION = 1 as const;

export type DriverType = 'recorder' | 'gpio' | 'rgb-gpio' | 'none';
export type StepType = 'HOLD' | 'BREATHE' | 'BRIGHTNESS' | 'RGB' | 'IRGB' | 'CLEAR' | 'HSV' | 'LOOP' | 'STOP';
export type LedStateName = 'NONE' | 'OFF' | 'ON' | 'BREATHING';
export type Profile = 'debug' | 'memory-check' | 'release' | 'size';

export interface Step {
  type: StepType;
  durationMs: number;
  state?: LedStateName;
  brightness?: number;
  color?: [number, number, number];
  index?: number;
}

export interface PatternDefinition {
  type: number;
  steps: Step[];
}

export interface MemoryConfig {
  heapSize: number;
  failAllocationAt?: number;
  eventCapacity?: number;
}

export type Operation =
  | { op: 'register'; type: number; steps: Step[] }
  | { op: 'start' | 'stop'; type: number }
  | { op: 'advance'; ms: number }
  | { op: 'update' }
  | { op: 'batch'; count: number; intervalMs: number }
  | { op: 'failAllocation'; nth: number | null }
  | { op: 'checkpoint'; name: string };

export type Assertion =
  | { type: 'state'; at: number; field: StateField; equals: number | number[] }
  | { type: 'event'; operationIndex: number; eventIndex: number; kind: EventKind; args?: number[] }
  | { type: 'memory'; phase: 'beforeDestroy' | 'afterDestroy'; field: MemoryField; equals?: number; atMost?: number }
  | { type: 'noOverflow' }
  | { type: 'reference' };

export interface Scenario {
  protocolVersion: typeof PROTOCOL_VERSION;
  id: string;
  driver: DriverType;
  activeLevel?: 0 | 1;
  memory: MemoryConfig;
  patterns: PatternDefinition[];
  operations: Operation[];
  assertions: Assertion[];
  budgets: { maxOperations: number; timeoutMs: number; maxEvents?: number };
  seed?: number;
  robustness?: boolean;
}

export type EventKind = 'state' | 'brightness' | 'color' | 'indexColor' | 'clear' | 'update' | 'pin';
export interface OutputEvent {
  time: number;
  rawTime: number;
  operationIndex: number;
  kind: EventKind;
  args: number[];
}

export interface ActivePattern {
  type: number;
  stepIndex: number;
  elapsedTime: number;
  lastUpdateTime: number;
  firstStart: boolean;
  colorType: number;
  color: number[];
}

export type StateField = 'time' | 'activeCount' | 'selectedType' | 'requestedState' | 'brightness' | 'requestedColor' | 'pinR' | 'pinG' | 'pinB' | 'pinMask' | 'eventOverflow' | 'unsupportedMask';
export interface StateSnapshot {
  time: number;
  rawTime: number;
  activeCount: number;
  selectedType: number;
  requestedState: number;
  brightness: number;
  requestedColor: number[];
  pinR: number;
  pinG: number;
  pinB: number;
  pinMask: number;
  eventOverflow: number;
  unsupportedMask: number;
  active: ActivePattern[];
}

export type MemoryField = 'configuredBytes' | 'physicalPoolBytes' | 'allocatorOverheadBytes' | 'currentRequestedBytes' | 'peakRequestedBytes' | 'currentPoolBytes' | 'peakPoolBytes' | 'allocationCount' | 'freeCount' | 'failureCount' | 'liveBlocks' | 'freeBytes' | 'largestFreeBlock' | 'fragmentationPercent' | 'lastFailureIndex' | 'lastFailureSize' | 'lastFailureOperation';
export interface MemoryStats {
  configuredBytes: number;
  physicalPoolBytes: number;
  allocatorOverheadBytes: number;
  currentRequestedBytes: number;
  peakRequestedBytes: number;
  currentPoolBytes: number;
  peakPoolBytes: number;
  allocationCount: number;
  freeCount: number;
  failureCount: number;
  liveBlocks: number;
  freeBytes: number;
  largestFreeBlock: number;
  fragmentationPercent: number;
  lastFailureIndex: number;
  lastFailureSize: number;
  lastFailureOperation: number;
  lastFailureOperationIndex: number;
  tlsfConsistent: boolean;
}

export interface TraceEntry {
  operationIndex: number;
  operation: Operation | { op: 'initial' } | { op: 'destroy' };
  time: number;
  state: StateSnapshot;
  events: OutputEvent[];
  memory: MemoryStats;
}

export interface AssertionResult {
  assertion: Assertion;
  status: 'pass' | 'fail' | 'unsupported';
  message: string;
  time?: number;
  operationIndex?: number;
  expected?: unknown;
  actual?: unknown;
}

export interface BuildInfo {
  profile: Profile;
  sourceRevision: string;
  emscripten: string;
  tlsf: string;
  magicEnum: string;
  optimization: string;
  exceptions: boolean;
  exceptionStrategy: 'native-wasm';
  lto: boolean;
  tracing: boolean;
}

export interface EnvironmentInfo {
  host: 'node' | 'browser';
  runtime: string;
  platform: string;
  arch: string;
}

export interface ScenarioResult {
  protocolVersion: typeof PROTOCOL_VERSION;
  id: string;
  status: 'pass' | 'fail' | 'unsupported' | 'skipped' | 'execution_error' | 'timeout';
  reason?: 'assertion' | 'timeout' | 'trap' | 'oom' | 'trace_overflow' | 'invalid_input' | 'unsupported' | 'worker_error';
  build: BuildInfo;
  environment: EnvironmentInfo;
  effectiveConfig: Scenario;
  seed?: number;
  assertions: AssertionResult[];
  trace: TraceEntry[];
  metrics: {
    operations: number;
    events: number;
    durationMs: number;
    beforeDestroy?: MemoryStats;
    afterDestroy?: MemoryStats;
    wasmMemoryBytes?: number;
    staticBytes?: number | null;
    tlsfPoolBytes?: number;
    stackReservedBytes?: number;
    stackHighWaterBytes?: number | null;
    failureMemory?: MemoryStats;
  };
  artifacts: { wasm?: string; reproduction?: string };
  reproduce: { command: string; generatorVersion?: string };
  error?: string;
}

export interface WasmExports {
  _ledip_create(driver: number, activeLevel: number, heapSize: number, failAt: number, eventCapacity: number): number;
  _ledip_destroy(handle: number): number;
  _ledip_add_pattern(handle: number, type: number, count: number): number;
  _ledip_start(handle: number, type: number): number;
  _ledip_stop(handle: number, type: number): number;
  _ledip_set_time(handle: number, time: number): void;
  _ledip_update(handle: number): number;
  _ledip_run_batch(handle: number, count: number, interval: number): number;
  _ledip_input_pointer(): number;
  _ledip_input_capacity(): number;
  _ledip_events_pointer(handle: number): number;
  _ledip_event_count(handle: number): number;
  _ledip_clear_events(handle: number): void;
  _ledip_state_pointer(handle: number): number;
  _ledip_memory_pointer(handle: number): number;
  _ledip_blocks_pointer(handle: number): number;
  _ledip_block_count(handle: number): number;
  _ledip_configure_failure(handle: number, nth: number, operation: number, operationIndex: number): void;
  _ledip_check_memory(handle: number): number;
  _ledip_stack_high_water(): number;
  _ledip_allocator_self_test(): number;
  HEAPU8: Uint8Array;
  HEAPU32: Uint32Array;
  wasmMemory?: { buffer: ArrayBuffer };
}

export interface WasmModule {
  exports: WasmExports;
  wasmBinary?: Uint8Array;
  wasmMemory?: { buffer: ArrayBuffer };
}

export type WasmFactory = (options?: { wasmBinary?: Uint8Array; locateFile?: (path: string) => string }) => Promise<WasmExports>;
