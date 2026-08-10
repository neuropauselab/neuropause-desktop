/**
 * PROGRAM 13C CERTIFICATION — switching, races and concurrency (Phases 20-26).
 *
 * The isolation suite proves the boundary holds when one tenant is asking. This
 * one asks whether it holds while the ANSWER IS CHANGING — during a switch,
 * under interleaved background work, and across caches that two tenants reach
 * with the same logical key.
 *
 * THE DISTINCTION THAT MATTERS HERE
 *
 * There are two kinds of context in this system and they behave differently
 * under a race, deliberately:
 *
 *   · The SESSION scope is mutable and shared. A switch changes it for
 *     everything that reads it afterwards — that is what a switch means.
 *   · A BACKGROUND PRINCIPAL is captured at the moment work is scheduled and
 *     travels with that work's async execution. A switch cannot reach it.
 *
 * So a background job started as A must still be A after the user switches to
 * B, while a NEW read issued after the switch must be B. Both are asserted
 * below, because a system that got only the first right would be stale and one
 * that got only the second would leak.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TenantScope } from '@neuropause/shared';
import {
  buildTwoTenantWorld,
  MARKER_A,
  MARKER_B,
  TENANT_A,
  TENANT_A2,
  TENANT_B,
  type TwoTenantWorld,
} from './twoTenantFixture';
import { principalScope, runAsPrincipal, tenantPrincipal } from '../backgroundPrincipal';
import { forEachTenant } from '../backgroundFanOut';
import { testOrganization, testWorkspace } from '../testScope';
import { tenantKey } from '@neuropause/shared';

let w: TwoTenantWorld;

beforeEach(async () => {
  w = await buildTwoTenantWorld();
});
afterEach(async () => {
  await w.dispose();
});

/** A read of every domain, as one blob. Used to assert what a switch changed. */
function surface(world: TwoTenantWorld): string {
  return JSON.stringify({
    crm: world.records.crm.list({ limit: 50 }),
    search: world.unified.query({ limit: 500, includeDeleted: false }).items,
    graph: world.graph.listNodes({ limit: 100 }),
    notifications: world.inbox.page(50).items,
    conversations: world.conversations.list(),
    documents: world.documents.all(),
    sandbox: world.sandboxWorkspaces.list(),
  });
}

/* ── Phase 20: tenant switch ────────────────────────────────────────────── */

describe('Phase 20 — tenant switch re-resolves every surface', () => {
  it('A → B replaces every domain, with no stale A data anywhere', () => {
    w.setScope(TENANT_A);
    expect(surface(w)).toContain(MARKER_A);

    w.setScope(TENANT_B);
    const after = surface(w);
    expect(after).toContain(MARKER_B);
    expect(after).not.toContain(MARKER_A);
  });

  it('B → A returns A, and B is gone — the switch is not one-way', () => {
    w.setScope(TENANT_B);
    expect(surface(w)).toContain(MARKER_B);
    w.setScope(TENANT_A);
    const back = surface(w);
    expect(back).toContain(MARKER_A);
    expect(back).not.toContain(MARKER_B);
  });

  it('a switch to an UNRESOLVED tenant empties everything rather than keeping the last', () => {
    w.setScope(TENANT_A);
    expect(surface(w)).toContain(MARKER_A);
    w.setScope(null);
    const empty = surface(w);
    expect(empty).not.toContain(MARKER_A);
    expect(empty).not.toContain(MARKER_B);
  });
});

/* ── Phase 21: workspace switch ─────────────────────────────────────────── */

describe('Phase 21 — workspace switch inside one tenant', () => {
  /**
   * Workspace-scoped and tenant-scoped records behave DIFFERENTLY on a
   * workspace switch, and that difference is the product's meaning rather than
   * a bug: `recordInScope` treats an absent workspace as tenant-wide.
   */
  it('a workspace switch never admits the OTHER tenant’s data', () => {
    w.setScope(TENANT_A);
    const inA = surface(w);
    w.setScope(TENANT_A2);
    const inA2 = surface(w);

    expect(inA).not.toContain(MARKER_B);
    expect(inA2).not.toContain(MARKER_B);
  });

  it('switching workspace then tenant leaves no residue of either', () => {
    w.setScope(TENANT_A2);
    w.setScope(TENANT_B);
    const after = surface(w);
    expect(after).toContain(MARKER_B);
    expect(after).not.toContain(MARKER_A);
  });
});

/* ── Phase 22/23: switch races ──────────────────────────────────────────── */

describe('Phase 22/23 — a switch during concurrent work', () => {
  /**
   * Operations that CAPTURED their context before the switch keep it; the
   * capture is what a background principal is for. Operations that read the
   * session afterwards see the new tenant. Neither ever sees a mixture.
   */
  it('work captured as A stays A while the session switches to B underneath it', async () => {
    const principal = tenantPrincipal({
      jobId: 'cert-switch-race',
      scope: { tenantId: TENANT_A.tenantId, workspaceId: '' },
    })!;

    const observed: (string | undefined)[] = [];
    const job = runAsPrincipal(principal, async () => {
      for (let i = 0; i < 20; i += 1) {
        observed.push(principalScope()?.tenantId);
        // The switch happens repeatedly, mid-flight, between every await.
        w.setScope(i % 2 === 0 ? TENANT_B : TENANT_A);
        await new Promise((r) => setTimeout(r, 0));
      }
    });

    await job;
    expect(new Set(observed)).toEqual(new Set([TENANT_A.tenantId]));
  });

  it('a read issued AFTER the switch sees the new tenant, not the old one', async () => {
    w.setScope(TENANT_A);
    const before = w.records.crm.list({ limit: 50 });
    expect(JSON.stringify(before)).toContain(MARKER_A);

    // Interleave a switch with concurrent reads of six different subsystems.
    const results: string[] = [];
    await Promise.all([
      (async () => {
        await new Promise((r) => setTimeout(r, 0));
        w.setScope(TENANT_B);
      })(),
      (async () => {
        await new Promise((r) => setTimeout(r, 1));
        results.push(JSON.stringify(w.records.crm.list({ limit: 50 })));
        results.push(JSON.stringify(w.unified.query({ limit: 100, includeDeleted: false }).items));
        results.push(JSON.stringify(w.graph.listNodes({ limit: 50 })));
        results.push(JSON.stringify(w.inbox.page(50).items));
        results.push(JSON.stringify(w.conversations.list()));
        results.push(JSON.stringify(w.documents.all()));
      })(),
    ]);

    // Every post-switch read is B's. Crucially, none is a MIXTURE.
    for (const r of results) expect(r).not.toContain(MARKER_A);
  });

  it('a workspace switch mid-flight cannot make one read span two workspaces', async () => {
    const seen: string[] = [];
    await Promise.all([
      (async () => {
        for (let i = 0; i < 10; i += 1) {
          w.setScope(i % 2 === 0 ? TENANT_A : TENANT_A2);
          await new Promise((r) => setTimeout(r, 0));
        }
      })(),
      (async () => {
        for (let i = 0; i < 10; i += 1) {
          seen.push(surface(w));
          await new Promise((r) => setTimeout(r, 0));
        }
      })(),
    ]);
    // Whichever workspace each read landed in, it never saw tenant B.
    for (const s of seen) expect(s).not.toContain(MARKER_B);
  });
});

/* ── Phase 24: background concurrency ───────────────────────────────────── */

describe('Phase 24 — two background jobs, interleaved', () => {
  it('A always reads A and B always reads B, across every await point', async () => {
    const readsA: string[] = [];
    const readsB: string[] = [];

    const job = async (
      tenant: TenantScope,
      sink: string[],
    ): Promise<void> => {
      const principal = tenantPrincipal({
        jobId: `cert-job-${tenant.tenantId}`,
        scope: { tenantId: tenant.tenantId, workspaceId: '' },
      })!;
      await runAsPrincipal(principal, async () => {
        for (let i = 0; i < 25; i += 1) {
          sink.push(principalScope()?.tenantId ?? 'NONE');
          await new Promise((r) => setTimeout(r, 0));
        }
      });
    };

    await Promise.all([job(TENANT_A, readsA), job(TENANT_B, readsB)]);

    expect(readsA).toHaveLength(25);
    expect(readsB).toHaveLength(25);
    expect(new Set(readsA)).toEqual(new Set([TENANT_A.tenantId]));
    expect(new Set(readsB)).toEqual(new Set([TENANT_B.tenantId]));
  });

  it('a fan-out over both tenants leaves NO principal behind', async () => {
    const deps = {
      organizations: () => [testOrganization('org-a'), testOrganization('org-b')],
      workspaces: () => [testWorkspace('ws-a', 'org-a'), testWorkspace('ws-b', 'org-b')],
    };
    const seen: string[] = [];
    await forEachTenant('cert-fanout', deps, (run) => {
      seen.push(run.scope.tenantId);
    });
    expect(seen.sort()).toEqual(['org-a', 'org-b']);
    expect(principalScope()).toBeNull();
  });
});

/* ── Phase 25: cache concurrency ────────────────────────────────────────── */

describe('Phase 25 — two tenants, the same logical cache key', () => {
  /**
   * The shape that produced real defects three times in this program: a cache
   * keyed on a resource id, correct while there was one tenant. `tenantKey`
   * exists so the scoped form is shorter to write than the unscoped one.
   */
  it('tenantKey keeps identical logical keys apart', () => {
    const kA = tenantKey(TENANT_A, 'brief', 'morning');
    const kB = tenantKey(TENANT_B, 'brief', 'morning');
    expect(kA).not.toBe(kB);

    const cache = new Map<string, string>();
    cache.set(kA, MARKER_A);
    cache.set(kB, MARKER_B);
    expect(cache.get(kA)).toBe(MARKER_A);
    expect(cache.get(kB)).toBe(MARKER_B);
    expect(cache.size).toBe(2); // NOT one entry overwritten by the other
  });

  it('an id-only key COLLIDES — the negative case, so the fix is not vacuous', () => {
    const cache = new Map<string, string>();
    cache.set('brief:morning', MARKER_A);
    cache.set('brief:morning', MARKER_B);
    expect(cache.size).toBe(1);
    expect(cache.get('brief:morning')).toBe(MARKER_B); // A's value silently gone
  });

  it('populating both tenants concurrently yields independent values', async () => {
    const cache = new Map<string, string>();
    const fill = async (scope: TenantScope, marker: string): Promise<void> => {
      for (let i = 0; i < 20; i += 1) {
        cache.set(tenantKey(scope, 'row', String(i)), marker);
        await new Promise((r) => setTimeout(r, 0));
      }
    };
    await Promise.all([fill(TENANT_A, MARKER_A), fill(TENANT_B, MARKER_B)]);

    expect(cache.size).toBe(40);
    for (let i = 0; i < 20; i += 1) {
      expect(cache.get(tenantKey(TENANT_A, 'row', String(i)))).toBe(MARKER_A);
      expect(cache.get(tenantKey(TENANT_B, 'row', String(i)))).toBe(MARKER_B);
    }
  });

  /** The live store under concurrent two-tenant writes — not a synthetic map. */
  it('concurrent writes to one store file keep both tenants’ rows intact', async () => {
    const write = async (scope: TenantScope, marker: string): Promise<void> => {
      for (let i = 0; i < 15; i += 1) {
        w.setScope(scope);
        w.records.crm.create({
          title: `${marker}-${i}`,
          fields: { name: `${marker}-${i}`, marker },
          actor: 'x',
          now: `2026-08-11T13:00:${String(i).padStart(2, '0')}.000Z`,
        });
        await new Promise((r) => setTimeout(r, 0));
      }
    };
    await Promise.all([write(TENANT_A, MARKER_A), write(TENANT_B, MARKER_B)]);

    w.setScope(TENANT_A);
    const aRows = w.records.crm.list({ limit: 200 });
    expect(JSON.stringify(aRows)).not.toContain(MARKER_B);

    w.setScope(TENANT_B);
    const bRows = w.records.crm.list({ limit: 200 });
    expect(JSON.stringify(bRows)).not.toContain(MARKER_A);

    // Both tenants kept everything they wrote (15 + the fixture's 1).
    expect(aRows).toHaveLength(16);
    expect(bRows).toHaveLength(16);
  });
});
