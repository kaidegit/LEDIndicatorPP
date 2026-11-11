import type { ActivePattern, EventKind, LedStateName, MemoryStats, OutputEvent, StateSnapshot, Step, StepType, WasmExports } from '../protocol/types.js';

export const EVENT_SIZE = 24;
export const STATE_SIZE = 560;
export const MEMORY_SIZE = 80;
export const MAX_ACTIVE_PATTERNS = 16;

const stepTypes: StepType[] = ['HOLD', 'BREATHE', 'BRIGHTNESS', 'RGB', 'IRGB', 'CLEAR', 'HSV', 'LOOP', 'STOP'];
const states: LedStateName[] = ['NONE', 'OFF', 'ON', 'BREATHING'];
const eventKinds: EventKind[] = ['state', 'brightness', 'color', 'indexColor', 'clear', 'update', 'pin'];

export function encodeSteps(wasm: WasmExports, steps: Step[]): number {
  const capacity = wasm._ledip_input_capacity();
  const bytes = steps.length * 12;
  if (bytes > capacity) throw new Error(`pattern requires ${bytes} bytes; input capacity is ${capacity}`);
  const pointer = wasm._ledip_input_pointer();
  const view = new DataView(wasm.HEAPU8.buffer);
  steps.forEach((step, index) => {
    const offset = pointer + index * 12;
    view.setUint8(offset, stepTypes.indexOf(step.type));
    view.setUint32(offset + 4, step.durationMs, true);
    let value = 0;
    if (step.state !== undefined) value = states.indexOf(step.state);
    if (step.brightness !== undefined) value = step.brightness;
    if (step.color !== undefined) value = (step.color[0] << 8) | (step.color[1] << 16) | (step.color[2] << 24) | ((step.index ?? 0) & 0xff);
    view.setUint32(offset + 8, value >>> 0, true);
  });
  return steps.length;
}

export function readEvents(wasm: WasmExports, handle: number, time: number, operationIndex: number): OutputEvent[] {
  const count = wasm._ledip_event_count(handle);
  const pointer = wasm._ledip_events_pointer(handle);
  const view = new DataView(wasm.HEAPU8.buffer);
  const events: OutputEvent[] = [];
  for (let index = 0; index < count; index += 1) {
    const offset = pointer + index * EVENT_SIZE;
    const rawTime = view.getUint32(offset, true);
    const elapsedSinceEvent = ((time >>> 0) - rawTime) >>> 0;
    events.push({
      time: Math.max(0, time - elapsedSinceEvent),
      rawTime,
      operationIndex,
      kind: eventKinds[view.getUint32(offset + 4, true)] ?? 'update',
      args: [8, 12, 16, 20].map((field) => view.getUint32(offset + field, true)),
    });
  }
  wasm._ledip_clear_events(handle);
  return events;
}

export function readState(wasm: WasmExports, handle: number, time: number): StateSnapshot {
  const pointer = wasm._ledip_state_pointer(handle);
  const view = new DataView(wasm.HEAPU8.buffer);
  const active: ActivePattern[] = [];
  const activeCount = view.getUint32(pointer + 4, true);
  let pagePointer = pointer + 48;
  for (let index = 0; index < activeCount; index += 1) {
    if (index % MAX_ACTIVE_PATTERNS === 0) pagePointer = wasm._ledip_active_page_pointer(handle, index);
    const offset = pagePointer + (index % MAX_ACTIVE_PATTERNS) * 32;
    active.push({
      type: view.getInt32(offset, true),
      stepIndex: view.getUint32(offset + 4, true),
      elapsedTime: view.getUint32(offset + 8, true),
      lastUpdateTime: view.getUint32(offset + 12, true),
      colorType: view.getUint32(offset + 16, true),
      firstStart: view.getUint32(offset + 20, true) !== 0,
      color: [0, 1, 2, 3].map((field) => view.getUint8(offset + 24 + field)),
    });
  }
  return {
    time,
    rawTime: view.getUint32(pointer, true),
    activeCount,
    selectedType: view.getInt32(pointer + 8, true),
    requestedState: view.getUint32(pointer + 12, true),
    brightness: view.getInt32(pointer + 16, true),
    requestedColor: [0, 1, 2, 3].map((field) => view.getUint8(pointer + 20 + field)),
    pinR: view.getInt32(pointer + 24, true),
    pinG: view.getInt32(pointer + 28, true),
    pinB: view.getInt32(pointer + 32, true),
    pinMask: view.getUint32(pointer + 36, true),
    eventOverflow: view.getUint32(pointer + 40, true),
    unsupportedMask: view.getUint32(pointer + 44, true),
    active,
  };
}

export function readMemory(wasm: WasmExports, handle: number): MemoryStats {
  const pointer = wasm._ledip_memory_pointer(handle);
  const view = new DataView(wasm.HEAPU8.buffer);
  const unsigned = (offset: number) => view.getUint32(pointer + offset, true);
  return {
    configuredBytes: unsigned(0),
    physicalPoolBytes: unsigned(4),
    allocatorOverheadBytes: unsigned(8),
    currentRequestedBytes: unsigned(12),
    peakRequestedBytes: unsigned(16),
    currentPoolBytes: unsigned(20),
    peakPoolBytes: unsigned(24),
    allocationCount: unsigned(28),
    freeCount: unsigned(32),
    failureCount: unsigned(36),
    liveBlocks: unsigned(40),
    freeBytes: unsigned(44),
    largestFreeBlock: unsigned(48),
    lastFailureIndex: unsigned(52),
    lastFailureSize: unsigned(56),
    lastFailureOperation: view.getInt32(pointer + 60, true),
    lastFailureOperationIndex: view.getInt32(pointer + 64, true),
    tlsfConsistent: unsigned(68) !== 0,
    fragmentationPercent: view.getFloat64(pointer + 72, true),
  };
}

export interface MemoryBlock { offset: number; size: number; used: boolean }
export function readBlocks(wasm: WasmExports, handle: number): MemoryBlock[] {
  const count = wasm._ledip_block_count(handle);
  const pointer = wasm._ledip_blocks_pointer(handle);
  const view = new DataView(wasm.HEAPU8.buffer);
  return Array.from({ length: count }, (_, index) => ({
    offset: view.getUint32(pointer + index * 12, true),
    size: view.getUint32(pointer + index * 12 + 4, true),
    used: view.getUint32(pointer + index * 12 + 8, true) !== 0,
  }));
}
