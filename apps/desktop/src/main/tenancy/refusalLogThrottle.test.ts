/**
 * P13C ROUND 52 — GATE 3. THE W-10 EMISSION LAYER, PINNED.
 *
 * `refusalDiagnostic.test.ts` pins the RESOLVER-side bracket math (which refusal,
 * refusalIndex, firstRefusalAfterSuccess, recovery) because that lives in the
 * injectable `tenantContext.ts`. The EMISSION policy — how often a refusal
 * actually prints, and what it carries when it does — was inlined in the
 * `onRefusal` callback in `enterprise/index.ts`, which imports Electron and so
 * was never covered. Round 52 extracted it as the pure `decideRefusalLog`
 * (refusalLogThrottle.ts); these tests pin the extracted decision.
 *
 * WHAT THESE TESTS PIN
 *   1. The LOST transition (firstRefusalAfterSuccess) ALWAYS emits, throttle or not.
 *   2. Within the interval, a steady refusal is suppressed — one line per reason
 *      per minute — and the suppressed occurrences are counted, not lost.
 *   3. When a line does emit, it carries how many it stands for, then resets.
 *   4. The throttle is per-reason: a second reason is not muted by the first.
 *   5. The label selects LOST vs the steady line correctly.
 *   6. NEGATIVE CONTROL: without the interval guard, every refusal emits — proving
 *      the throttle, not something else, is what suppresses.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  decideRefusalLog,
  REFUSAL_LOG_INTERVAL_MS,
  type RefusalLogState,
} from './refusalLogThrottle';

const REASON = 'not_a_member';
const OTHER = 'no_workspace';

describe('P13C round 52 · W-10 refusal-log throttle', () => {
  let states: Map<string, RefusalLogState>;
  beforeEach(() => {
    states = new Map<string, RefusalLogState>();
  });

  it('the first refusal for a reason always emits (nothing to throttle against yet)', () => {
    const d = decideRefusalLog(states, REASON, false, 1_000);
    expect(d.emit).toBe(true);
    expect(d.suppressedSinceLastLine).toBe(0);
    expect(d.label).toBe('Tenant refused');
  });

  it('the LOST transition ALWAYS emits, even inside the throttle interval', () => {
    // Prime the window with an emitted line.
    decideRefusalLog(states, REASON, false, 1_000);
    // A steady refusal 1ms later would be suppressed…
    expect(decideRefusalLog(states, REASON, false, 1_001).emit).toBe(false);
    // …but a LOST transition at the same instant is never suppressed.
    const lost = decideRefusalLog(states, REASON, true, 1_002);
    expect(lost.emit).toBe(true);
    expect(lost.label).toBe('Tenant resolution LOST — first refusal after a working session');
  });

  it('within the interval a steady refusal is SUPPRESSED and counted', () => {
    decideRefusalLog(states, REASON, false, 0); // emits, opens the window
    const a = decideRefusalLog(states, REASON, false, 10_000);
    const b = decideRefusalLog(states, REASON, false, 30_000);
    const c = decideRefusalLog(states, REASON, false, REFUSAL_LOG_INTERVAL_MS - 1);
    expect([a.emit, b.emit, c.emit]).toEqual([false, false, false]);
    expect(states.get(REASON)?.suppressed).toBe(3);
  });

  it('when the interval passes, the next line emits carrying the suppressed count, then resets', () => {
    decideRefusalLog(states, REASON, false, 0); // emits
    decideRefusalLog(states, REASON, false, 100); // suppressed (1)
    decideRefusalLog(states, REASON, false, 200); // suppressed (2)
    const next = decideRefusalLog(states, REASON, false, REFUSAL_LOG_INTERVAL_MS); // interval elapsed
    expect(next.emit).toBe(true);
    expect(next.suppressedSinceLastLine).toBe(2);
    // Counter reset after emitting.
    expect(states.get(REASON)?.suppressed).toBe(0);
    // And a refusal immediately after the fresh line is suppressed again.
    expect(decideRefusalLog(states, REASON, false, REFUSAL_LOG_INTERVAL_MS + 1).emit).toBe(false);
  });

  it('the throttle is PER-REASON — a second reason is not muted by the first', () => {
    decideRefusalLog(states, REASON, false, 0); // reason A emits
    expect(decideRefusalLog(states, REASON, false, 500).emit).toBe(false); // A suppressed
    // A different reason, same instant, still emits — its window is its own.
    expect(decideRefusalLog(states, OTHER, false, 500).emit).toBe(true);
  });

  it('the exact interval boundary emits (>= interval is not "within")', () => {
    decideRefusalLog(states, REASON, false, 0);
    // now - last === interval → NOT strictly less → emits.
    expect(decideRefusalLog(states, REASON, false, REFUSAL_LOG_INTERVAL_MS).emit).toBe(true);
  });

  it('NEGATIVE CONTROL: with interval 0, no refusal is ever suppressed — the throttle is what mutes', () => {
    decideRefusalLog(states, REASON, false, 0, 0);
    // With a zero interval, `now - last < 0` is never true, so every line emits.
    for (let t = 1; t <= 5; t += 1) {
      expect(decideRefusalLog(states, REASON, false, t, 0).emit).toBe(true);
    }
    expect(states.get(REASON)?.suppressed).toBe(0);
  });
});
