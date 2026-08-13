/**
 * P13C Part 3 — the background fan-out.
 *
 * These tests exist because the defect they cover is INVISIBLE on a
 * single-tenant install: with one organization, "run once under the active
 * session" and "run once per tenant under its own principal" produce identical
 * behaviour. Every assertion here therefore uses two tenants, and the ones that
 * matter most assert about the SECOND one — the tenant that, before this,
 * silently received no scheduled work at all.
 */
import { describe, expect, it } from 'vitest';
import type { Organization, TenantScope, Workspace } from '@neuropause/shared';
import {
  forEachTenant,
  principalForOwnedWork,
  tenantRuns,
  type TenantFanOutDeps,
} from './backgroundFanOut';
import { currentPrincipal, principalScope, resolveTenantScope } from './backgroundPrincipal';
import {
  OTHER_TENANT_SCOPE,
  TEST_TENANT_SCOPE,
  TWO_TENANT_FAN_OUT,
  testOrganization,
  testWorkspace,
} from './testScope';

const A = TEST_TENANT_SCOPE.tenantId;
const B = OTHER_TENANT_SCOPE.tenantId;

function deps(orgs: Organization[], workspaces: Workspace[] = []): TenantFanOutDeps {
  return { organizations: () => orgs, workspaces: () => workspaces };
}

describe('tenantRuns — who a background job runs for', () => {
  it('produces one run per operable organization', () => {
    const runs = tenantRuns('job', TWO_TENANT_FAN_OUT);
    expect(runs.map((r) => r.scope.tenantId)).toEqual([A, B].sort());
  });

  it('gives each run its OWN principal, never a shared one', () => {
    const runs = tenantRuns('job', TWO_TENANT_FAN_OUT);
    const [first, second] = runs;
    expect(first!.principal.tenantId).not.toBe(second!.principal.tenantId);
    // Distinct requestIds: one run's events must be joinable without collecting
    // the other's.
    expect(first!.principal.requestId).not.toBe(second!.principal.requestId);
  });

  it('is ordered deterministically, not by store insertion order', () => {
    const forward = tenantRuns('job', deps([testOrganization(A), testOrganization(B)]));
    const reversed = tenantRuns('job', deps([testOrganization(B), testOrganization(A)]));
    expect(forward.map((r) => r.scope.tenantId)).toEqual(reversed.map((r) => r.scope.tenantId));
  });

  /* ── Phase 8: fail-closed ─────────────────────────────────────────────── */

  it('FAILS CLOSED with no organizations — no default, no first, no active', () => {
    expect(tenantRuns('job', deps([]))).toEqual([]);
  });

  it('excludes a SUSPENDED tenant, so suspension stops background work too', () => {
    const suspended = { ...testOrganization(B), status: 'suspended' as const };
    const runs = tenantRuns('job', deps([testOrganization(A), suspended]));
    expect(runs.map((r) => r.scope.tenantId)).toEqual([A]);
  });

  it('excludes an ARCHIVED tenant', () => {
    const archived = { ...testOrganization(B), status: 'archived' as const };
    const runs = tenantRuns('job', deps([testOrganization(A), archived]));
    expect(runs.map((r) => r.scope.tenantId)).toEqual([A]);
  });

  it('skips a corrupt blank-id organization without cancelling the others', () => {
    const runs = tenantRuns('job', deps([testOrganization(''), testOrganization(A)]));
    expect(runs.map((r) => r.scope.tenantId)).toEqual([A]);
  });

  /* ── Workspace fan-out ────────────────────────────────────────────────── */

  it('a tenant-level run reports NO workspace, so it reads tenant-wide only', () => {
    const runs = tenantRuns('job', TWO_TENANT_FAN_OUT);
    expect(runs.every((r) => r.scope.workspaceId === '')).toBe(true);
    expect(runs.every((r) => r.principal.principalType === 'tenant')).toBe(true);
  });

  it('perWorkspace produces one run per workspace, each naming its own', () => {
    const runs = tenantRuns('job', TWO_TENANT_FAN_OUT, { perWorkspace: true });
    expect(runs.map((r) => `${r.scope.tenantId}/${r.scope.workspaceId}`).sort()).toEqual(
      [
        `${A}/${TEST_TENANT_SCOPE.workspaceId}`,
        `${B}/${OTHER_TENANT_SCOPE.workspaceId}`,
      ].sort(),
    );
    expect(runs.every((r) => r.principal.principalType === 'workspace')).toBe(true);
  });

  it('never emits a workspace under an organization that does not own it', () => {
    const runs = tenantRuns(
      'job',
      deps([testOrganization(A)], [testWorkspace('ws-b', B), testWorkspace('ws-a', A)]),
      { perWorkspace: true },
    );
    expect(runs.map((r) => r.scope.workspaceId)).toEqual(['ws-a']);
  });
});

describe('forEachTenant — running as each tenant', () => {
  it('runs the body once per tenant, each under that tenant’s principal', async () => {
    const seen: (TenantScope | null)[] = [];
    await forEachTenant('job', TWO_TENANT_FAN_OUT, () => {
      seen.push(principalScope());
    });
    expect(seen.map((s) => s?.tenantId)).toEqual([A, B].sort());
  });

  /**
   * THE ASSERTION THE WHOLE PROGRAM RESTS ON.
   *
   * Every scoped store in this system resolves through `resolveTenantScope`. If
   * that returns the run's tenant rather than the session's, then ~106 module
   * stores, search, graph, memory and the timeline all become correct inside the
   * job with no change to any of them. So this test stands in for all of them.
   */
  it('overrides the SESSION: a job for B reads as B while A is signed in', async () => {
    const session = (): TenantScope => TEST_TENANT_SCOPE;
    const resolvedInside: (string | undefined)[] = [];
    await forEachTenant('job', TWO_TENANT_FAN_OUT, () => {
      resolvedInside.push(resolveTenantScope(session)?.tenantId);
    });
    expect(resolvedInside).toContain(B);
    // And outside the job the session is authoritative again.
    expect(resolveTenantScope(session)?.tenantId).toBe(A);
  });

  it('one tenant’s failure does not cancel the next tenant’s run', async () => {
    const ran: string[] = [];
    const outcomes = await forEachTenant('job', TWO_TENANT_FAN_OUT, (run) => {
      if (run.scope.tenantId === [A, B].sort()[0]) throw new Error('boom');
      ran.push(run.scope.tenantId);
    });
    expect(ran).toEqual([[A, B].sort()[1]]);
    expect(outcomes.filter((o) => o.ok)).toHaveLength(1);
    expect(outcomes.find((o) => !o.ok)?.error).toBe('boom');
  });

  it('leaves NO principal behind once the fan-out finishes', async () => {
    await forEachTenant('job', TWO_TENANT_FAN_OUT, () => undefined);
    expect(currentPrincipal()).toBeNull();
  });

  /* ── Phase 10: background concurrency ─────────────────────────────────── */

  /**
   * Two jobs, interleaved on purpose.
   *
   * Each body yields to the event loop between reads, so if the principal lived
   * anywhere shared the second job would overwrite the first mid-flight. Every
   * read is asserted, not just the last one: a context that is right at the
   * start and wrong after an await is the exact failure `AsyncLocalStorage` is
   * here to prevent, and only sampling repeatedly catches it.
   */
  it('keeps two concurrent jobs isolated across every await point', async () => {
    const readsA: (string | undefined)[] = [];
    const readsB: (string | undefined)[] = [];

    const job = async (only: string, sink: (string | undefined)[]): Promise<void> => {
      await forEachTenant(
        `job-${only}`,
        { organizations: () => [testOrganization(only)], workspaces: () => [] },
        async () => {
          for (let i = 0; i < 25; i += 1) {
            sink.push(principalScope()?.tenantId);
            await new Promise((r) => setTimeout(r, 0));
          }
        },
      );
    };

    await Promise.all([job(A, readsA), job(B, readsB)]);

    expect(readsA).toHaveLength(25);
    expect(readsB).toHaveLength(25);
    expect(new Set(readsA)).toEqual(new Set([A]));
    expect(new Set(readsB)).toEqual(new Set([B]));
  });
});

describe('principalForOwnedWork — work that already has an owner', () => {
  it('takes the tenant from the artefact', () => {
    const p = principalForOwnedWork({ jobId: 'j', tenantId: B, workspaceId: null });
    expect(p?.tenantId).toBe(B);
    expect(p?.principalType).toBe('tenant');
  });

  it('is workspace-scoped when the artefact names a workspace', () => {
    const p = principalForOwnedWork({ jobId: 'j', tenantId: B, workspaceId: 'ws-b' });
    expect(p?.principalType).toBe('workspace');
    expect(p?.workspaceId).toBe('ws-b');
  });

  it('REFUSES unowned work rather than choosing a tenant for it', () => {
    expect(principalForOwnedWork({ jobId: 'j', tenantId: null, workspaceId: null })).toBeNull();
    expect(principalForOwnedWork({ jobId: 'j', tenantId: '', workspaceId: null })).toBeNull();
    expect(
      principalForOwnedWork({ jobId: 'j', tenantId: undefined, workspaceId: undefined }),
    ).toBeNull();
  });

  /**
   * Phase 13 — the retry case, stated as an ordering property.
   *
   * A notification enqueued for A and delivered after the user switched to B
   * must still be A's. Because the principal is built from the ARTEFACT and not
   * from anything ambient, the switch is not an input to the answer — which is
   * why this holds without the test needing to simulate a switch at all.
   */
  it('is unaffected by whoever is active when the work is finally run', () => {
    const enqueuedForA = principalForOwnedWork({ jobId: 'j', tenantId: A, workspaceId: null });
    expect(enqueuedForA?.tenantId).toBe(A);
    expect(resolveTenantScope(() => OTHER_TENANT_SCOPE)?.tenantId).toBe(B); // B is "active"
    expect(enqueuedForA?.tenantId).toBe(A); // and the queued work is still A's
  });
});
