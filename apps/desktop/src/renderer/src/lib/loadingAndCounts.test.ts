/**
 * Moved to `ui-tests/loadingAndCounts.test.tsx`.
 *
 * These hooks need a DOM (`renderHook`) and a fake `requestAnimationFrame`, so
 * they belong to the jsdom UI suite, not the Node suite. This stub remains
 * only because the sandbox that wrote it could create files but not delete
 * them; `cleanup-sandbox-symlinks.sh` removes it.
 */
import { describe, expect, it } from 'vitest';

describe('moved', () => {
  it('lives in ui-tests/loadingAndCounts.test.tsx', () => {
    expect(true).toBe(true);
  });
});
