/**
 * P13C REMEDIATION — FINDINGS 2 & 3. Where a write lands, and what a read model
 * is allowed to describe.
 *
 * `activeOrg()` ended in `?? orgStore.defaultOrg()` and began with
 * `workspaceStore.active()`, which itself falls back to the first workspace on
 * the install. Both halves turned "no resolvable tenant" into a real
 * organization belonging to someone. It was documented as display-only and had
 * stopped being: it was stamped as `orgId` on unit, user and role CREATES, and
 * it fed the read model that returns the member list.
 *
 * The replacement resolves through `activeTenantScope()` and returns null
 * rather than a stranger. These tests assert the property that makes that
 * correct — the resolver's ORDER — and then assert the store-level consequence,
 * that a write carrying an explicit organization lands only there.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TenantScope } from '@neuropause/shared';
import { OrgStore } from '../enterprise/org/orgStore';
import { ORG_ID } from '../enterprise/org/seed';
import { resolveTenantScope, runAsPrincipal, tenantPrincipal } from './backgroundPrincipal';

const dirs: string[] = [];
const stores: OrgStore[] = [];

async function store(): Promise<OrgStore> {
  const dir = join(tmpdir(), `np-orgwrite-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  dirs.push(dir);
  const s = new OrgStore(join(dir, 'org.json'));
  await s.load();
  stores.push(s);
  return s;
}

afterEach(async () => {
  for (const s of stores.splice(0)) await s.flush().catch(() => {});
  for (const d of dirs.splice(0)) {
    await fs.rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

/**
 * The shape `activeOrgOrNull` now has: resolve a scope, then look the
 * organization up. Reproduced here rather than imported because the real one
 * lives in the Electron-bound enterprise root.
 */
function activeOrgOrNull(s: OrgStore, session: () => TenantScope | null) {
  const scope = resolveTenantScope(session);
  if (scope === null) return null;
  return s.organization(scope.tenantId);
}

describe('a write lands in the organization the caller resolved to', () => {
  it('A’s unit, user and role are all owned by A', async () => {
    const s = await store();
    const B = s.createOrganization('Northwind Health', '').id;

    const unit = s.createUnit({ orgId: ORG_ID, kind: 'team', name: 'NP-WRITE-A-9812' });
    const user = s.createUser({ orgId: ORG_ID, name: 'A Person', title: 'x' });
    const role = s.createRole({ orgId: ORG_ID, name: 'A Role', description: '', permissions: [] });

    expect(unit.orgId).toBe(ORG_ID);
    expect(user.orgId).toBe(ORG_ID);
    expect(role.orgId).toBe(ORG_ID);

    expect(s.unitsFor(B).map((u) => u.name)).not.toContain('NP-WRITE-A-9812');
    expect(s.usersFor(B).map((u) => u.name)).not.toContain('A Person');
    expect(s.rolesFor(B).map((r) => r.name)).not.toContain('A Role');
  });

  it('B’s writes are equally invisible to A — the boundary is symmetric', async () => {
    const s = await store();
    const B = s.createOrganization('Northwind Health', '').id;

    s.createUnit({ orgId: B, kind: 'team', name: 'NP-WRITE-B-4721' });
    s.createUser({ orgId: B, name: 'B Person', title: 'x' });

    expect(s.unitsFor(ORG_ID).map((u) => u.name)).not.toContain('NP-WRITE-B-4721');
    expect(s.usersFor(ORG_ID).map((u) => u.name)).not.toContain('B Person');
  });
});

describe('resolving the acting organization', () => {
  it('is the SESSION’s organization on an interactive call', async () => {
    const s = await store();
    const org = activeOrgOrNull(s, () => ({ tenantId: ORG_ID, workspaceId: 'ws' }));
    expect(org?.id).toBe(ORG_ID);
  });

  /**
   * The property that matters for background writes: inside a job the answer is
   * the job's tenant, not whatever is on screen.
   */
  it('is the PRINCIPAL’s organization inside a background job', async () => {
    const s = await store();
    const B = s.createOrganization('Northwind Health', '').id;
    const principal = tenantPrincipal({ jobId: 'j', scope: { tenantId: B, workspaceId: '' } });
    expect(principal).not.toBeNull();

    const seen = runAsPrincipal(principal!, () =>
      activeOrgOrNull(s, () => ({ tenantId: ORG_ID, workspaceId: 'ws' })),
    );
    expect(seen?.id).toBe(B);
  });

  /* ── The fallbacks that used to exist ─────────────────────────────────── */

  it('is NULL when nothing resolves — not the first organization', async () => {
    const s = await store();
    // Two organizations exist and one of them is first. Neither is the answer.
    s.createOrganization('Northwind Health', '');
    expect(activeOrgOrNull(s, () => null)).toBeNull();
  });

  it('is NULL for an unknown tenant id — not the seeded organization', async () => {
    const s = await store();
    const org = activeOrgOrNull(s, () => ({ tenantId: 'org-ghost', workspaceId: 'ws' }));
    expect(org).toBeNull();
  });

  /**
   * A SYSTEM principal carries no tenant, and the precedence rule says a present
   * principal wins even when its scope is null. Without that, a global
   * maintenance job would fall through to the session and start acting inside
   * whichever organization the user had open.
   */
  it('is NULL inside a SYSTEM job, even with a session present', async () => {
    const s = await store();
    const system = {
      principalId: 'job:x',
      principalType: 'system' as const,
      tenantId: null,
      workspaceId: null,
      permissions: [],
      jobId: 'x',
      requestId: 'r',
    };
    const seen = runAsPrincipal(system, () =>
      activeOrgOrNull(s, () => ({ tenantId: ORG_ID, workspaceId: 'ws' })),
    );
    expect(seen).toBeNull();
  });
});

describe('read models describe one organization', () => {
  it('member and unit lists never span organizations', async () => {
    const s = await store();
    const B = s.createOrganization('Northwind Health', '').id;
    s.createUser({ orgId: ORG_ID, name: 'NP-READMODEL-A-9812', title: 'x' });
    s.createUser({ orgId: B, name: 'NP-READMODEL-B-4721', title: 'x' });

    const aNames = s.usersFor(ORG_ID).map((u) => u.name);
    const bNames = s.usersFor(B).map((u) => u.name);

    expect(aNames).toContain('NP-READMODEL-A-9812');
    expect(aNames).not.toContain('NP-READMODEL-B-4721');
    expect(bNames).toContain('NP-READMODEL-B-4721');
    expect(bNames).not.toContain('NP-READMODEL-A-9812');
  });

  it('a headcount is per organization, never an install total', async () => {
    const s = await store();
    const B = s.createOrganization('Northwind Health', '').id;
    const before = s.usersFor(ORG_ID).length;
    s.createUser({ orgId: B, name: 'B1', title: 'x' });
    s.createUser({ orgId: B, name: 'B2', title: 'x' });

    expect(s.usersFor(ORG_ID)).toHaveLength(before);
    expect(s.usersFor(B)).toHaveLength(2);
  });
});
