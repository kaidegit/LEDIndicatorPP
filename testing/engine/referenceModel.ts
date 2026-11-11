import type {
  ActivePattern,
  Operation,
  PatternDefinition,
  Scenario,
  StateSnapshot,
  Step,
} from '../protocol/types.js';

interface ModelPattern extends ActivePattern {
  lastColorType: number;
}

const STEP_TYPES = ['HOLD', 'BREATHE', 'BRIGHTNESS', 'RGB', 'IRGB', 'CLEAR', 'HSV', 'LOOP', 'STOP'];
const STATE_VALUES = ['NONE', 'OFF', 'ON', 'BREATHING'];
const UINT32_RANGE = 0x1_0000_0000;

function emptyState(driver: Scenario['driver'], activeLevel: 0 | 1): StateSnapshot {
  const noPins = driver === 'recorder' || driver === 'none';
  return {
    time: 0,
    rawTime: 0,
    activeCount: 0,
    selectedType: -1,
    requestedState: 0,
    brightness: -1,
    requestedColor: [0, 0, 0, 0],
    pinR: noPins ? -1 : -1,
    pinG: noPins ? -1 : -1,
    pinB: noPins ? -1 : -1,
    pinMask: 0xffff_ffff,
    eventOverflow: 0,
    unsupportedMask: 0,
    active: [],
  };
}

export class UnsupportedModelCase extends Error {}

export class ReferenceModel {
  private readonly patterns = new Map<number, Step[]>();
  private active: ModelPattern[] = [];
  private readonly state: StateSnapshot;
  private readonly activeLevel: 0 | 1;

  constructor(private readonly scenario: Scenario) {
    this.activeLevel = scenario.activeLevel ?? 1;
    this.state = emptyState(scenario.driver, this.activeLevel);
    for (const pattern of scenario.patterns) this.register(pattern);
  }

  snapshot(): StateSnapshot {
    return structuredClone(this.state);
  }

  apply(operation: Operation): StateSnapshot {
    switch (operation.op) {
      case 'register':
        this.register({ type: operation.type, steps: operation.steps });
        break;
      case 'start':
        this.start(operation.type);
        break;
      case 'stop':
        this.stop(operation.type);
        break;
      case 'advance':
        this.advance(operation.ms);
        break;
      case 'update':
        this.update();
        break;
      case 'batch':
        for (let index = 0; index < operation.count; index += 1) {
          this.advance(operation.intervalMs);
          this.update();
        }
        break;
      case 'failAllocation':
      case 'checkpoint':
        break;
    }
    return this.snapshot();
  }

  private register(pattern: PatternDefinition): void {
    this.patterns.set(pattern.type, structuredClone(pattern.steps));
  }

  private start(type: number): void {
    if (!this.patterns.has(type)) return;
    const existing = this.active.find((pattern) => pattern.type === type);
    if (existing) {
      Object.assign(existing, this.newPattern(type));
    } else {
      this.active.push(this.newPattern(type));
    }
    this.active.sort((left, right) => left.type - right.type);
    this.syncActive();
  }

  private newPattern(type: number): ModelPattern {
    return {
      type,
      stepIndex: 0,
      elapsedTime: 0,
      lastUpdateTime: this.state.rawTime,
      firstStart: true,
      colorType: 3,
      color: [0, 0, 0, 0],
      lastColorType: 3,
    };
  }

  private stop(type: number): void {
    const index = this.active.findIndex((pattern) => pattern.type === type);
    if (index < 0) return;
    const removedHighest = index === 0;
    this.active.splice(index, 1);
    if (removedHighest) this.restoreHighest();
    this.syncActive();
  }

  private advance(milliseconds: number): void {
    this.state.time += milliseconds;
    this.state.rawTime = this.state.time % UINT32_RANGE;
    for (const pattern of this.active) pattern.lastUpdateTime = pattern.lastUpdateTime >>> 0;
  }

  private update(): void {
    let restoreHighest = false;
    for (let index = 0; index < this.active.length;) {
      const pattern = this.active[index]!;
      const steps = this.patterns.get(pattern.type);
      if (!steps || steps.length === 0) throw new UnsupportedModelCase('empty or missing pattern');
      const delta = (this.state.rawTime - pattern.lastUpdateTime) >>> 0;
      pattern.lastUpdateTime = this.state.rawTime;
      pattern.elapsedTime = (pattern.elapsedTime + delta) >>> 0;
      if (pattern.firstStart) {
        this.assertStep(steps, pattern.stepIndex);
        if (index === 0) this.execute(steps[pattern.stepIndex]!);
        this.cacheColor(pattern, steps[pattern.stepIndex]!);
        pattern.firstStart = false;
      }
      let zeroDurationTransitions = 0;
      while (true) {
        this.assertStep(steps, pattern.stepIndex);
        const step = steps[pattern.stepIndex]!;
        if (pattern.elapsedTime < step.durationMs) break;
        pattern.elapsedTime -= step.durationMs;
        pattern.stepIndex = step.type === 'LOOP' ? 0 : pattern.stepIndex + 1;
        this.assertStep(steps, pattern.stepIndex);
        const next = steps[pattern.stepIndex]!;
        if (next.type === 'STOP') {
          restoreHighest ||= index === 0;
          this.active.splice(index, 1);
          break;
        }
        if (index === 0) this.execute(next);
        this.cacheColor(pattern, next);
        zeroDurationTransitions = next.durationMs === 0 ? zeroDurationTransitions + 1 : 0;
        if (zeroDurationTransitions > steps.length + 1) {
          throw new UnsupportedModelCase('zero-duration cycle');
        }
      }
      if (this.active[index] === pattern) index += 1;
    }
    if (restoreHighest) this.restoreHighest();
    this.syncActive();
  }

  private assertStep(steps: Step[], index: number): void {
    if (index < 0 || index >= steps.length) throw new UnsupportedModelCase('step index outside pattern');
  }

  private cacheColor(pattern: ModelPattern, step: Step): void {
    if (step.type !== 'RGB' && step.type !== 'IRGB') return;
    pattern.colorType = STEP_TYPES.indexOf(step.type);
    pattern.color = [...step.color!, step.type === 'IRGB' ? step.index! : 0];
    pattern.lastColorType = pattern.colorType;
  }

  private restoreHighest(): void {
    const pattern = this.active[0];
    if (!pattern) return;
    const steps = this.patterns.get(pattern.type);
    if (!steps) return;
    if (pattern.lastColorType === 3 || pattern.lastColorType === 4) {
      this.execute({
        type: pattern.lastColorType === 3 ? 'RGB' : 'IRGB',
        durationMs: 0,
        color: pattern.color.slice(0, 3) as [number, number, number],
        index: pattern.color[3] ?? 0,
      });
    }
    this.assertStep(steps, pattern.stepIndex);
    this.execute(steps[pattern.stepIndex]!);
  }

  private execute(step: Step): void {
    switch (step.type) {
      case 'HOLD':
      case 'BREATHE':
        this.setState(STATE_VALUES.indexOf(step.state!));
        break;
      case 'BRIGHTNESS':
        if (this.scenario.driver === 'recorder') this.state.brightness = step.brightness!;
        break;
      case 'RGB':
      case 'IRGB':
        if (this.scenario.driver === 'recorder' || this.scenario.driver === 'rgb-gpio') {
          this.state.requestedColor = [...step.color!, step.type === 'IRGB' ? step.index! : 0];
        }
        break;
      case 'CLEAR':
        break;
      default:
        break;
    }
  }

  private setState(requestedState: number): void {
    if (this.scenario.driver === 'none') return;
    this.state.requestedState = requestedState;
    if (this.scenario.driver === 'recorder') return;
    if (requestedState === 1) {
      const level = 1 - this.activeLevel;
      this.setPins(this.scenario.driver === 'gpio' ? 1 : 7, level);
    } else if (requestedState === 2) {
      if (this.scenario.driver === 'gpio') {
        this.setPins(1, this.activeLevel);
      } else {
        let activeMask = 0;
        if (this.state.requestedColor[0]) activeMask |= 1;
        if (this.state.requestedColor[1]) activeMask |= 2;
        if (this.state.requestedColor[2]) activeMask |= 4;
        this.setPins(activeMask, this.activeLevel);
        this.setPins(7 & ~activeMask, 1 - this.activeLevel);
      }
    }
  }

  private setPins(mask: number, level: number): void {
    if (mask & 1) this.state.pinR = level;
    if (mask & 2) this.state.pinG = level;
    if (mask & 4) this.state.pinB = level;
    this.state.pinMask = mask;
  }

  private syncActive(): void {
    this.state.activeCount = this.active.length;
    this.state.selectedType = this.active[0]?.type ?? -1;
    this.state.active = this.active.map(({ lastColorType: _, ...pattern }) => structuredClone(pattern));
  }
}

export function semanticSnapshot(state: StateSnapshot): unknown {
  return {
    time: state.time,
    rawTime: state.rawTime,
    activeCount: state.activeCount,
    selectedType: state.selectedType,
    requestedState: state.requestedState,
    brightness: state.brightness,
    requestedColor: state.requestedColor,
    pinR: state.pinR,
    pinG: state.pinG,
    pinB: state.pinB,
    pinMask: state.pinMask,
    active: state.active,
  };
}
