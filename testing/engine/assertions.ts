import type {
  Assertion,
  AssertionResult,
  MemoryStats,
  ScenarioResult,
  StateField,
  StateSnapshot,
  TraceEntry,
} from '../protocol/types.js';
import { semanticSnapshot } from './referenceModel.js';

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function result(assertion: Assertion, passed: boolean, details: Partial<AssertionResult> = {}): AssertionResult {
  return {
    assertion,
    status: passed ? 'pass' : 'fail',
    message: passed ? 'matched' : 'value differs',
    ...details,
  };
}

function stateField(state: StateSnapshot, field: StateField): number | number[] {
  const value = state[field];
  if (typeof value === 'number' || Array.isArray(value)) return value;
  throw new Error(`state field ${field} is not scalar or an array`);
}

export function evaluateAssertions(
  assertions: Assertion[],
  trace: TraceEntry[],
  beforeDestroy: MemoryStats,
  afterDestroy: MemoryStats,
): AssertionResult[] {
  return assertions.map((assertion) => {
    if (assertion.type === 'noOverflow') {
      const overflow = trace.find((entry) => entry.state.eventOverflow > 0);
      return result(assertion, !overflow, {
        ...(overflow ? { time: overflow.time, operationIndex: overflow.operationIndex } : {}),
        expected: 0,
        actual: overflow?.state.eventOverflow ?? 0,
      });
    }
    if (assertion.type === 'state') {
      const entry = [...trace].reverse().find((candidate) => candidate.time <= assertion.at && candidate.operation.op !== 'destroy');
      if (!entry) return result(assertion, false, { message: 'no state exists at requested time', time: assertion.at });
      const actual = stateField(entry.state, assertion.field);
      return result(assertion, equal(actual, assertion.equals), {
        time: entry.time,
        operationIndex: entry.operationIndex,
        expected: assertion.equals,
        actual,
      });
    }
    if (assertion.type === 'event') {
      const entry = trace.find((candidate) => candidate.operationIndex === assertion.operationIndex);
      const event = entry?.events[assertion.eventIndex];
      if (!event) return result(assertion, false, { message: 'event does not exist', operationIndex: assertion.operationIndex });
      const passed = event.kind === assertion.kind && (!assertion.args || equal(event.args, assertion.args));
      return result(assertion, passed, {
        time: event.time,
        operationIndex: event.operationIndex,
        expected: { kind: assertion.kind, args: assertion.args },
        actual: { kind: event.kind, args: event.args },
      });
    }
    if (assertion.type === 'memory') {
      const stats = assertion.phase === 'beforeDestroy' ? beforeDestroy : afterDestroy;
      const actual = stats[assertion.field];
      const passed = assertion.equals !== undefined ? equal(actual, assertion.equals) : actual <= assertion.atMost!;
      return result(assertion, passed, { expected: assertion.equals ?? `<= ${assertion.atMost}`, actual });
    }
    return {
      assertion,
      status: 'pass',
      message: 'reference comparisons were evaluated during execution',
    };
  });
}

export function firstFailure(result: ScenarioResult): AssertionResult | undefined {
  return result.assertions.find((assertion) => assertion.status === 'fail');
}
