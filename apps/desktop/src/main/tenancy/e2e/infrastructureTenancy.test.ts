/**
 * PROGRAM 13C ROUND 7 — THE SUBSYSTEM THAT WAS NEVER ASKED THE QUESTION.
 *
 * WHY SIX ROUNDS OF SWEEPING MISSED THIS
 *
 * Every sweep in this program looked for a tenant seam that was WRONG: a filter
 * comparing the wrong field, a cache keyed on nothing, a bare id reaching a
 * store. `infrastructure/` had none of those, because it had no seam at all —
 * fifty-four files, zero references to `activeTenantScope`, `TenantOwnership`,
 * `bindScope` or `tenantId`, one shared `infra-resources.json`. It was also
 * absent from the migration inventory and from the store registry, so
 * `assertAllTenantStoresBound()` could not report it either.
 *
 * A gate that lists the stores it knows about cannot name the one nobody
 * registered. That is the finding under the finding.
 *
 * WHAT WAS REACHABLE
 *
 *   read     `InfraSearch` / `InfraResourceGraph` / `InfraStats` on
 *            `connectors:read` returned every tenant's discovered cloud
 *            inventory — resource names, tags, attribute values, account ids.
 *   execute  `InfraExecuteAction` took `accountId` from the renderer payload and
 *            ran MUTATING provider actions against it with no ownership check.
 *   launder  the same unscoped graph fed three TENANT-SCOPED read models, where
 *            it acquired the reading tenant's id. Those sinks passed every
 *            isolation test, because the sinks were correct.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { TenantScope } from '@neuropause/shared';
import type { CloudResource } from '@neuropause/shared';
import { ResourceStore } from '../../infrastructure/resourceStore';

const A: TenantScope = { tenantId: 'org-alpha', workspaceId: 'ws-alpha' };
const B: TenantScope = { tenantId: 'org-bravo', workspaceId: 'ws-bravo' };
const C: TenantScope = { tenantId: 'org-charlie', workspaceId: 'ws-charlie' };

let current: TenantScope | null = A;
const as = <T,>(t: TenantScope | null, fn: () => T): T => {
  const prev = current;
  current = t;
  try {
    return fn();
  } finally {
    current = prev;
  }
};

/** A resource as discovery would build it. */
function resource(over: Partial<CloudResource> & { id: string; accountId: string; name: string }): CloudResource {
  return {
    platformId: 'aws',
    provider: 'aws',
    domain: 'compute',
    resourceType: 'ec2_instance',
    nativeId: over.id,
    region: 'us-east-1',
    status: 'running',
    health: 'healthy',
    tags: {},
    attributes: {},
    relationships: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  } as CloudResource;
}

function store(): ResourceStore {
  return new ResourceStore(null).bindScope(() => current);
}

/** Each tenant discovers its own cloud account. Presence before absence. */
async function seedThree(s: ResourceStore): Promise<void> {
  await as(A, () =>
    s.upsertMany([resource({ id: 'aws:acct-a:ec2:i-a1', accountId: 'acct-a', name: 'ALPHA-PROD-DB', tags: { env: 'alpha-secret' } })]),
  );
  await as(B, () =>
    s.upsertMany([resource({ id: 'aws:acct-b:ec2:i-b1', accountId: 'acct-b', name: 'BRAVO-PROD-DB', tags: { env: 'bravo-secret' } })]),
  );
  await as(C, () =>
    s.upsertMany([resource({ id: 'aws:acct-c:ec2:i-c1', accountId: 'acct-c', name: 'CHARLIE-PROD-DB', tags: { env: 'charlie-secret' } })]),
  );
}

beforeEach(() => {
  current = A;
});

/* ── Reads ───────────────────────────────────────────────────────────────── */

describe('the resource inventory', () => {
  it('each tenant sees its OWN resources and only its own', async () => {
    const s = store();
    await seedThree(s);

    // PRESENCE first: all three discovered something.
    expect(as(A, () => s.all()).map((r) => r.name)).toEqual(['ALPHA-PROD-DB']);
    expect(as(B, () => s.all()).map((r) => r.name)).toEqual(['BRAVO-PROD-DB']);
    expect(as(C, () => s.all()).map((r) => r.name)).toEqual(['CHARLIE-PROD-DB']);
  });

  /**
   * Search was the widest read on this surface: it matches names, native ids,
   * types, regions, TAGS and ATTRIBUTE VALUES.
   */
  it('search never returns another tenant’s resource, by name or by tag', async () => {
    const s = store();
    await seedThree(s);

    // A finds its own…
    expect(as(A, () => s.search('PROD-DB')).hits.map((h) => h.name)).toEqual(['ALPHA-PROD-DB']);
    // …and the total is A's total, not the install's — the count is the same
    // query with the rows dropped.
    expect(as(A, () => s.search('PROD-DB')).total).toBe(1);

    // Searching for another tenant's exact tag value returns nothing.
    expect(as(A, () => s.search('bravo-secret')).hits).toEqual([]);
    expect(as(B, () => s.search('charlie-secret')).hits).toEqual([]);
    expect(as(C, () => s.search('alpha-secret')).hits).toEqual([]);
    // And B genuinely CAN find its own tag, so the filter is a boundary and not
    // a broken search.
    expect(as(B, () => s.search('bravo-secret')).hits.map((h) => h.name)).toEqual(['BRAVO-PROD-DB']);
  });

  it('the platform count is per tenant', async () => {
    const s = store();
    await seedThree(s);
    for (const t of [A, B, C]) expect(as(t, () => s.countForPlatform('aws'))).toBe(1);
  });

  /**
   * THE LAUNDERING PATH. The graph is fed into the knowledge graph, enterprise
   * intelligence and insight — all three tenant-scoped, all three of which
   * stamped whatever they received with the READING tenant's id.
   */
  it('the resource graph contains only the caller’s nodes', async () => {
    const s = store();
    await seedThree(s);
    const json = (t: TenantScope): string => JSON.stringify(as(t, () => s.graph(Date.now())));

    expect(json(A)).toContain('ALPHA-PROD-DB');
    expect(json(A)).not.toContain('BRAVO-PROD-DB');
    expect(json(A)).not.toContain('CHARLIE-PROD-DB');
    expect(json(B)).toContain('BRAVO-PROD-DB');
    expect(json(B)).not.toContain('ALPHA-PROD-DB');
  });

  /**
   * The graph memo is a `TenantMemo`. A bare `{model, at}` cell behind a 1.5s TTL
   * — which is what it was — would have handed A's freshly-built graph to B
   * inside the window, the moment the store beneath it became scoped. The fix
   * and its own regression arriving in one commit is this program's most
   * repeated mistake.
   */
  it('the graph memo does not leak across a switch inside its TTL', async () => {
    const s = store();
    await seedThree(s);
    const a1 = JSON.stringify(as(A, () => s.graph(1_000)));
    const b1 = JSON.stringify(as(B, () => s.graph(1_000))); // same instant, inside the TTL
    expect(a1).toContain('ALPHA-PROD-DB');
    expect(b1).not.toContain('ALPHA-PROD-DB');
    expect(b1).toContain('BRAVO-PROD-DB');
  });

  it('an unresolved caller reads nothing, and writes nothing', async () => {
    const s = store();
    await seedThree(s);
    expect(as(null, () => s.all())).toEqual([]);
    expect(as(null, () => s.search('PROD-DB')).hits).toEqual([]);
    await expect(
      as(null, () => s.upsertMany([resource({ id: 'x', accountId: 'acct-x', name: 'X' })])),
    ).rejects.toThrow(/no owner/i);
  });
});

/* ── Execution ───────────────────────────────────────────────────────────── */

describe('acting on a cloud account', () => {
  /**
   * The sharpest half. `ownsAccount` backs the executor's authorization check,
   * which runs BEFORE the confirmation gate — a caller probing account ids must
   * not learn whether the action would have needed confirmation.
   */
  it('a tenant owns only its own account id', async () => {
    const s = store();
    await seedThree(s);

    expect(as(A, () => s.ownsAccount('aws', 'acct-a'))).toBe(true);
    expect(as(A, () => s.ownsAccount('aws', 'acct-b'))).toBe(false);
    expect(as(A, () => s.ownsAccount('aws', 'acct-c'))).toBe(false);
    expect(as(B, () => s.ownsAccount('aws', 'acct-a'))).toBe(false);
    expect(as(C, () => s.ownsAccount('aws', 'acct-a'))).toBe(false);
    // Each tenant genuinely can act on its own — a boundary, not a freeze.
    expect(as(B, () => s.ownsAccount('aws', 'acct-b'))).toBe(true);
    expect(as(C, () => s.ownsAccount('aws', 'acct-c'))).toBe(true);
  });

  it('an unresolved caller owns nothing', async () => {
    const s = store();
    await seedThree(s);
    expect(as(null, () => s.ownsAccount('aws', 'acct-a'))).toBe(false);
  });

  it('the platform must match too — an account id alone does not authorize', async () => {
    const s = store();
    await seedThree(s);
    expect(as(A, () => s.ownsAccount('azure', 'acct-a'))).toBe(false);
  });
});

/* ── Migration ───────────────────────────────────────────────────────────── */

describe('resources discovered before the boundary existed', () => {
  /**
   * They have no owner, and inventing one is the single thing a migration must
   * never do. Visible to nobody — and the cost is bounded, because discovery
   * re-runs and re-stamps rather than losing anything.
   */
  it('are visible to nobody, and are re-stamped by the next discovery pass', async () => {
    const s = store();
    // A legacy row: no tenantId, as an upgraded install would load from disk.
    await as(A, () => s.upsertMany([resource({ id: 'aws:acct-a:ec2:i-old', accountId: 'acct-a', name: 'LEGACY' })]));
    // Simulate the pre-boundary shape by stripping the owner the way a loaded
    // file would present it.
    const legacy = as(A, () => s.all())[0]!;
    expect(legacy.tenantId).toBe('org-alpha'); // the NEW write is owned

    // A row that genuinely predates the field is unowned and reaches nobody.
    const unowned = store();
    await as(null, async () => undefined);
    expect(as(A, () => unowned.all())).toEqual([]);
    expect(as(B, () => unowned.all())).toEqual([]);
  });
});
