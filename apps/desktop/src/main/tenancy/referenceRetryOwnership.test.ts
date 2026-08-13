/**
 * P13C ROUND 24 — O-9. THE CALL SITE ROUND 10 MISSED.
 *
 * `enterprise/index.ts` debounces the parked-reference retry pass behind a
 * timer. Round 10 fixed this exact shape in `graph/index.ts`, `memory/index.ts`
 * and `services/taskScheduler.ts` — capture the principal at enqueue, key the
 * pending set by owner, never re-arm an armed timer — and this fourth site was
 * not re-read against the fix. It kept ONE shared timer, cleared and re-armed on
 * every save on the install, calling `engine.retryPending(null)` with no
 * principal at all, so the queue that ran was whichever tenant happened to be
 * signed in 400 ms later.
 *
 * WHAT CLASS OF EVIDENCE THIS FILE IS, STATED PLAINLY
 *
 * WIRED, not EXECUTED. `initEnterprise` reaches `app.getPath` and cannot be
 * constructed in a node test, so — unlike the graph and memory halves of this
 * fix, which `round10PrincipalsChannels.test.ts` drives behaviourally through
 * `initGraph` — this suite reads the source and asserts the shape. That is a
 * weaker claim and it is recorded as one: it proves the defect cannot silently
 * return through an edit, and it does NOT prove the pass runs as the right
 * tenant at runtime. G13 must not be recorded as EXECUTED on this file alone.
 *
 * The precedent for source-level invariants in this program is
 * `migrationInventoryIntegrity.test.ts`, which pins store seams the same way.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(join(__dirname, '..', 'enterprise', 'index.ts'), 'utf8');

/** The debounce block, isolated so an assertion cannot pass on some other timer. */
function retryBlock(): string {
  const start = SOURCE.indexOf('const pendingReferenceRetries');
  expect(start, 'the per-owner pending set is gone — the shared-timer defect is back').toBeGreaterThan(-1);
  const end = SOURCE.indexOf('const resolveReferencesFor');
  const tail = SOURCE.indexOf('};', SOURCE.indexOf('}, 400);'));
  expect(end).toBeGreaterThan(start);
  return SOURCE.slice(start, tail);
}

describe('O-9 — the parked-reference retry names its owner', () => {
  it('captures a principal at enqueue rather than resolving one at fire time', () => {
    const block = retryBlock();
    expect(block).toContain('tenantPrincipal({ jobId: REFERENCE_RETRY_JOB_ID, scope: activeTenantScope() });');
    // The capture must happen in `resolveReferencesFor`, which runs inside the
    // saving caller's context — not inside the setTimeout callback.
    const captureAt = block.indexOf('tenantPrincipal(');
    const timerAt = block.indexOf('setTimeout(');
    expect(captureAt).toBeGreaterThan(-1);
    expect(timerAt).toBeGreaterThan(-1);
    expect(captureAt, 'the principal is resolved inside the timer callback again').toBeLessThan(timerAt);
  });

  it('drops a change with no resolvable owner instead of running it as the reader', () => {
    expect(retryBlock()).toContain('if (principal === null) return;');
  });

  it('runs each pending pass under its own captured principal', () => {
    const block = retryBlock();
    expect(block).toContain('runAsPrincipal(principal, () => engine.retryPending(null))');
    // `retryPending` must not appear anywhere in this block OUTSIDE that wrapper.
    const calls = block.match(/engine\.retryPending\(/g) ?? [];
    expect(calls).toHaveLength(1);
  });

  it('coalesces WITHIN an owner and never ACROSS one', () => {
    const block = retryBlock();
    expect(block).toContain('`${principal.tenantId}::${principal.workspaceId ?? \'\'}`');
    expect(block).toContain('pendingReferenceRetries.set(key, principal)');
  });

  it('never re-arms an armed timer, so one busy tenant cannot starve the rest', () => {
    const block = retryBlock();
    expect(block).toContain('if (retryTimer) return;');
    expect(
      block,
      'clearTimeout on the shared retry timer is the starvation defect itself',
    ).not.toContain('clearTimeout(retryTimer)');
  });

  it('the job identity is a named constant, not a string literal at the call site', () => {
    expect(SOURCE).toContain("const REFERENCE_RETRY_JOB_ID = 'enterprise:reference-retry';");
  });
});
