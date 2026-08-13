/**
 * Background execution under a principal (P13C).
 *
 * WHAT PROGRAM 13B LEFT. Events are stamped with the resolved tenant at
 * publish time, and background timers had no principal — so their events were
 * written unowned and became invisible to everyone. Fail-closed and correct,
 * and a real functional gap: the runtime supervisor's CRITICAL alerts stopped
 * appearing in any timeline.
 *
 * THE FIX IS NOT "MAKE THE TIMELINE GLOBAL". It is to give a job its own
 * principal, captured where the job is scheduled and carried along its async
 * execution — so a tenant job's events belong to that tenant, a system job's
 * events say they are the product's, and a job with no tenant does not run.
 *
 * The concurrency cases are the ones that would have been impossible with a
 * `let currentTenant`: two jobs interleave here, and each must still see its
 * own principal at every await point.
 */
import { describe, expect, it } from 'vitest';
import type { TenantScope } from '@neuropause/shared';
import {
  currentPrincipal,
  principalScope,
  runAsPrincipal,
  systemPrincipal,
  tenantPrincipal,
} from './backgroundPrincipal';

const A: TenantScope = { tenantId: 'org-a', workspaceId: 'ws-a' };
const B: TenantScope = { tenantId: 'org-b', workspaceId: 'ws-b' };

const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('background principal', () => {
  /* ── Phase 6: fail closed ─────────────────────────────────────────────── */

  it('refuses to build a tenant principal when no tenant resolves', () => {
    expect(tenantPrincipal({ jobId: 'x', scope: null })).toBeNull();
    // And there is no variant that substitutes a default: the only way to get a
    // tenant into a principal is to pass a resolved scope.
    expect(tenantPrincipal({ jobId: 'x', scope: { tenantId: '', workspaceId: '' } })).toBeNull();
  });

  it('a system principal carries no tenant, so it reads nothing tenant-scoped', () => {
    runAsPrincipal(systemPrincipal('health-monitor'), () => {
      expect(currentPrincipal()?.principalType).toBe('system');
      // Not "sees everything" — sees nothing. A global maintenance job that
      // touched a tenant store must come back empty rather than fall through
      // to whoever happens to be signed in.
      expect(principalScope()).toBeNull();
    });
  });

  it('outside a job there is no principal at all', () => {
    expect(currentPrincipal()).toBeNull();
    expect(principalScope()).toBeNull();
  });

  /* ── Phase 9: concurrency ─────────────────────────────────────────────── */

  /**
   * THE TEST A MUTABLE GLOBAL CANNOT PASS.
   *
   * Two jobs interleave at every await. With a `let currentTenant` the second
   * job's assignment would overwrite the first's, and job A would finish under
   * tenant B — silently, and only under load. Async-local storage gives each
   * execution its own view.
   */
  it('two concurrent jobs never observe each other’s principal', async () => {
    const seen: string[] = [];

    const job = async (scope: TenantScope, label: string): Promise<void> => {
      const principal = tenantPrincipal({ jobId: label, scope })!;
      await runAsPrincipal(principal, async () => {
        for (let i = 0; i < 5; i += 1) {
          await tick(1);
          // Re-read at every step: the principal must survive each await.
          seen.push(`${label}:${principalScope()?.tenantId}`);
        }
      });
    };

    await Promise.all([job(A, 'a'), job(B, 'b')]);

    expect(seen.filter((s) => s.startsWith('a:')).every((s) => s === 'a:org-a')).toBe(true);
    expect(seen.filter((s) => s.startsWith('b:')).every((s) => s === 'b:org-b')).toBe(true);
    expect(seen).toHaveLength(10);
  });

  it('a job keeps the tenant it was scheduled with, even if the app switches', async () => {
    /**
     * The switch happens WHILE the job is in flight. The job was started for
     * tenant A and must still be acting for A when it resumes — the whole
     * reason the principal is captured at schedule time rather than resolved
     * inside the work.
     */
    let uiScope: TenantScope | null = A;
    const principal = tenantPrincipal({ jobId: 'slow-job', scope: uiScope })!;

    const result = await runAsPrincipal(principal, async () => {
      await tick(5);
      uiScope = B; // the user switches organizations mid-run
      await tick(5);
      return principalScope()?.tenantId;
    });

    expect(result).toBe('org-a');
    expect(uiScope).toBe(B); // the UI really did move
  });

  it('nested work inherits the principal; a nested job may narrow it', async () => {
    const outer = tenantPrincipal({ jobId: 'outer', scope: A })!;
    await runAsPrincipal(outer, async () => {
      await tick(1);
      expect(principalScope()?.tenantId).toBe('org-a');

      const inner = tenantPrincipal({ jobId: 'inner', scope: A, workspaceScoped: true })!;
      runAsPrincipal(inner, () => {
        expect(currentPrincipal()?.principalType).toBe('workspace');
        expect(principalScope()?.workspaceId).toBe('ws-a');
      });

      // …and the outer principal is intact afterwards.
      expect(currentPrincipal()?.principalType).toBe('tenant');
    });
  });

  /* ── Phase 4: the shape of the principal ──────────────────────────────── */

  it('a tenant-level job acts for the organization, not from inside a workspace', () => {
    const p = tenantPrincipal({ jobId: 'reproject', scope: A })!;
    expect(p.workspaceId).toBeNull();
    // An empty workspace means `recordInScope` matches tenant-level records and
    // refuses workspace-scoped ones — the honest reading of a tenant-wide job.
    expect(principalScope.call(null)).toBeNull(); // outside the run, still nothing
    runAsPrincipal(p, () => {
      expect(principalScope()).toEqual({ tenantId: 'org-a', workspaceId: '' });
    });
  });

  it('every run gets its own requestId, and the jobId is stable across runs', () => {
    const one = tenantPrincipal({ jobId: 'sync', scope: A })!;
    const two = tenantPrincipal({ jobId: 'sync', scope: A })!;
    expect(one.jobId).toBe(two.jobId);
    expect(one.principalId).toBe('job:sync');
    expect(one.requestId).not.toBe(two.requestId);
  });
});
