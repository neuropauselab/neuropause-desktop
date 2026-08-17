/**
 * NeuroPause OS — Work Hub feed query must satisfy the unified:query contract.
 *
 * Root cause of the reported "Error invoking remote method 'unified:query': IpcError: Invalid request for
 * unified:query": the Work Hub sent `limit: 2000`, but the main-process Zod schema `UnifiedQueryRequest` caps
 * `limit` at 500, so the request was rejected before it reached the store — the Meetings tile surfaced the raw
 * IPC error. The fix lives in the renderer (send a contract-valid request), NOT in the frozen contract. This test
 * pins the Work Hub request against the real shared schema so the mismatch cannot silently return.
 */
import { describe, expect, it } from 'vitest';
import { UnifiedQueryRequest } from '@neuropause/shared';
import { HUB_FEED_QUERY } from '@renderer/hub/HubHost';

describe('Work Hub feed query — unified:query contract compliance', () => {
  it('HUB_FEED_QUERY parses against the real UnifiedQueryRequest schema', () => {
    const parsed = UnifiedQueryRequest.safeParse(HUB_FEED_QUERY);
    expect(parsed.success).toBe(true);
  });

  it('limit stays within the contract cap (max 500)', () => {
    expect(HUB_FEED_QUERY.limit).toBeLessThanOrEqual(500);
  });

  it('every requested kind is accepted by the contract', () => {
    for (const kind of HUB_FEED_QUERY.kinds ?? []) {
      expect(UnifiedQueryRequest.safeParse({ kinds: [kind] }).success).toBe(true);
    }
  });

  it('regression: the old limit (2000) is REJECTED by the contract (documents the root cause)', () => {
    const bad = UnifiedQueryRequest.safeParse({ ...HUB_FEED_QUERY, limit: 2000 });
    expect(bad.success).toBe(false);
  });
});
