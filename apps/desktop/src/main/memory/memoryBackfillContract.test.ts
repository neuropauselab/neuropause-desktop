/**
 * S148 — the FG-S148-MEMORY-BACKFILL response contract is pinned to the PRODUCER.
 *
 * The frozen IpcResponseMap entry `'memory:backfill'` is an inline object literal (the FG authorized
 * exactly one additive entry to responses.ts and no other frozen surface, and the named producer type
 * `MemoryBackfillSummary` lives in main — see the certification for why the inline form is the only
 * in-authorization realization). This test is the guard against the two silently diverging: it asserts,
 * at COMPILE TIME and in BOTH directions, that the frozen response type and the main handler's
 * `MemoryBackfillSummary` are mutually assignable. Add or rename a field on either side and the type
 * check fails here first — the consumer-derived pin §2 #27 asks for, applied to a producer/contract split.
 */
import { describe, expect, it } from 'vitest';
import type { IpcResponseMap } from '@neuropause/shared';
import type { MemoryBackfillSummary } from './memoryBackfill';

type FrozenBackfill = IpcResponseMap['memory:backfill'];

// Bidirectional assignability — neither side may carry a field the other lacks.
const _summaryToFrozen: (s: MemoryBackfillSummary) => FrozenBackfill = (s) => s;
const _frozenToSummary: (f: FrozenBackfill) => MemoryBackfillSummary = (f) => f;

describe('S148 · memory:backfill response contract', () => {
  it('the frozen response type and main MemoryBackfillSummary are structurally identical', () => {
    // The assignments above are the real assertion (compile-time). This keeps them referenced and
    // documents a concrete instance round-tripping through both directions.
    const sample: MemoryBackfillSummary = {
      orgId: 'org-1',
      total: 10,
      processed: 10,
      embedded: 9,
      skipped: 0,
      failed: 1,
      batches: 1,
    };
    const asFrozen: FrozenBackfill = _summaryToFrozen(sample);
    const back: MemoryBackfillSummary = _frozenToSummary(asFrozen);
    expect(back).toEqual(sample);
    // The no-active-org shape is representable on both sides.
    const skipped: MemoryBackfillSummary = { orgId: null, total: 0, processed: 0, embedded: 0, skipped: 0, failed: 0, batches: 0, skippedReason: 'no_active_org' };
    expect(_summaryToFrozen(skipped).skippedReason).toBe('no_active_org');
  });
});
