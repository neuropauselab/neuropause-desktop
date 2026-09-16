/**
 * P13C ROUND 36 — GATE 1. The runtime-readiness signal.
 *
 * The failure being pinned: the window opens before `initRuntimeCore()`
 * finishes, the renderer's early invokes race ~650 late-registered channels,
 * and (worse) an init FAILURE was silent — a complete UI over dead channels.
 * This module is the answer the renderer reads; these tests pin its
 * transitions and, critically, that the failure message handed to the
 * renderer can never be a stack trace or an unbounded dump.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  __resetRuntimeStateForTests,
  markRuntimeFailed,
  markRuntimeReady,
  runtimeStateSnapshot,
  safeInitFailureMessage,
} from './runtimeReadiness';

afterEach(() => __resetRuntimeStateForTests());

describe('runtime readiness state', () => {
  it('boots as starting with no message — the honest pre-init answer', () => {
    expect(runtimeStateSnapshot()).toEqual({ state: 'starting', message: null });
  });

  it('transitions to ready', () => {
    markRuntimeReady();
    expect(runtimeStateSnapshot()).toEqual({ state: 'ready', message: null });
  });

  it('transitions to failed carrying the sanitized message', () => {
    markRuntimeFailed('Store scope gate refused: 3 stores unbound.');
    expect(runtimeStateSnapshot()).toEqual({
      state: 'failed',
      message: 'Store scope gate refused: 3 stores unbound.',
    });
  });

  it('snapshots are copies — a caller cannot mutate the shared state', () => {
    const snap = runtimeStateSnapshot();
    (snap as { state: string }).state = 'ready';
    expect(runtimeStateSnapshot().state).toBe('starting');
  });
});

describe('safeInitFailureMessage — the renderer copy is a sentence, never a dump', () => {
  it('keeps only the first line of a multi-line error', () => {
    const err = new Error('composition failed\n  at initRuntimeCore (/Users/someone/src/runtimeCore.ts:3987)');
    expect(safeInitFailureMessage(err)).toBe('composition failed');
  });

  it('never includes the stack even when message is empty', () => {
    const err = new Error('');
    expect(safeInitFailureMessage(err)).toBe('Unknown startup error.');
  });

  it('caps a pathological message', () => {
    const msg = safeInitFailureMessage(new Error('x'.repeat(5000)));
    expect(msg.length).toBeLessThanOrEqual(300);
    expect(msg.endsWith('…')).toBe(true);
  });

  it('handles a non-Error throw', () => {
    expect(safeInitFailureMessage('boom-string')).toBe('Unknown startup error.');
    expect(safeInitFailureMessage(undefined)).toBe('Unknown startup error.');
  });
});
