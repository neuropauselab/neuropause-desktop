/**
 * M1-02 — replay guard. Sequence numbers must strictly advance from the
 * initial state, reuse is refused, and sentAt must sit inside the skew
 * window (boundary inclusive) with malformed timestamps refused.
 */
import { describe, expect, it } from 'vitest';
import { checkReplay, DEFAULT_MAX_SKEW_MS, initialReplayState } from './replay';

const NOW = Date.parse('2026-08-07T12:00:00.000Z');

describe('checkReplay', () => {
  it('accepts strictly advancing sequences from the initial state', () => {
    let state = initialReplayState();
    for (const seq of [0, 1, 5, 6]) {
      const verdict = checkReplay({ seq, sentAt: '2026-08-07T12:00:00.000Z', nowMs: NOW, state });
      expect(verdict.ok).toBe(true);
      if (verdict.ok) state = verdict.state;
    }
    expect(state.lastSeq).toBe(6);
  });

  it('refuses reused, regressed, and non-integer sequences', () => {
    const state = { lastSeq: 5 };
    for (const seq of [5, 4, 0, 2.5]) {
      const verdict = checkReplay({ seq, sentAt: '2026-08-07T12:00:00.000Z', nowMs: NOW, state });
      expect(verdict).toEqual({ ok: false, reason: 'seq-reused' });
    }
  });

  it('enforces the skew window on both sides, boundary inclusive', () => {
    const state = initialReplayState();
    const at = (deltaMs: number): string => new Date(NOW + deltaMs).toISOString();
    expect(checkReplay({ seq: 1, sentAt: at(-DEFAULT_MAX_SKEW_MS), nowMs: NOW, state }).ok).toBe(
      true,
    );
    expect(checkReplay({ seq: 1, sentAt: at(DEFAULT_MAX_SKEW_MS), nowMs: NOW, state }).ok).toBe(
      true,
    );
    expect(
      checkReplay({ seq: 1, sentAt: at(-DEFAULT_MAX_SKEW_MS - 1), nowMs: NOW, state }),
    ).toEqual({
      ok: false,
      reason: 'clock-skew',
    });
    expect(checkReplay({ seq: 1, sentAt: 'garbage', nowMs: NOW, state })).toEqual({
      ok: false,
      reason: 'clock-skew',
    });
  });

  it('honors a custom window', () => {
    const state = initialReplayState();
    const sentAt = new Date(NOW - 10_000).toISOString();
    expect(checkReplay({ seq: 1, sentAt, nowMs: NOW, state, maxSkewMs: 5_000 })).toEqual({
      ok: false,
      reason: 'clock-skew',
    });
    expect(checkReplay({ seq: 1, sentAt, nowMs: NOW, state, maxSkewMs: 15_000 }).ok).toBe(true);
  });
});
