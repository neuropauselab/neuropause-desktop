/**
 * PROGRAM 13C ROUND 5 — F10. TWO ID SPACES, AND THE MAPPING BETWEEN THEM.
 *
 * THE FINDING WAS NOT ONLY A DISCLOSURE.
 *
 * `cloud/index.ts` had a helper called `callerTenantId()` that returned the
 * ORGANIZATION id (`org_…`). Every call site passed it into `TenancyStore`,
 * which keys cloud tenants as `tnt_…`. The two spaces never intersect, so:
 *
 *   listProjects / listTeams / listWorkers   always returned []
 *   createProject / createTeam / setTenantStatus   always failed
 *
 * Fail-closed, so nothing broke visibly. And dead code — which is the part that
 * matters here: **the isolation those call sites appear to enforce had never
 * actually run.** A test asserting "B cannot read A's project" passed because
 * nobody could read any project, including their own.
 *
 * That is why this file exists and why every test below creates real data first
 * and asserts the OWNER can reach it. A denial test that does not also prove
 * reachability is indistinguishable from a broken feature.
 *
 * Meanwhile the accessors that DID return data — `listTenants`, `listIsolation`
 * — were install-wide on `cloud:read`: every organization's name, region,
 * storage namespace and encryption key id.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TenantScope } from '@neuropause/shared';
import { TenancyStore } from '../../cloud/tenancy/tenancyStore';

const A: TenantScope = { tenantId: 'org-alpha', workspaceId: 'ws-a' };
const B: TenantScope = { tenantId: 'org-bravo', workspaceId: 'ws-b' };
const C: TenantScope = { tenantId: 'org-charlie', workspaceId: 'ws-c' };

let scope: TenantScope | null = A;
let dir: string;
let store: TenancyStore;

beforeEach(async () => {
  dir = join(tmpdir(), `np-cloudid-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  store = new TenancyStore(join(dir, 'tenancy.json'), A.tenantId, 'Alpha').bindScope(() => scope);
  await store.load();
  scope = A;
});
afterEach(async () => {
  await store.flush().catch(() => {});
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
});

/** Provision a cloud tenant for `who` and return its `tnt_` id. */
function provision(who: TenantScope, name: string): string {
  scope = who;
  return store.createTenant({ name, regionId: 'us-east', tier: 'business' }).id;
}

/* ── The mapping is real ────────────────────────────────────────────────── */

describe('F10 — the organization → cloud-tenant mapping actually resolves', () => {
  /**
   * The load-bearing assertion of this file. If this fails, every denial test
   * below is vacuous.
   */
  it('a provisioned tenant carries the CALLER’s organization and is reachable by them', () => {
    const idB = provision(B, 'Bravo Cloud');
    scope = B;
    const mine = store.listTenants();
    expect(mine.map((t) => t.id)).toContain(idB);
    expect(mine.find((t) => t.id === idB)?.organizationId).toBe(B.tenantId);
    // And the id spaces are genuinely different, which is the whole finding.
    expect(idB.startsWith('tnt_')).toBe(true);
    expect(B.tenantId.startsWith('org')).toBe(true);
  });

  it('the seeded home tenant maps to the organization the install was seeded for', () => {
    scope = A;
    const home = store.listTenants().find((t) => t.isHome);
    expect(home?.organizationId).toBe(A.tenantId);
  });

  /**
   * `createTenant` derived `organizationId` from the display NAME. Under the new
   * mapping that would make every provisioned tenant invisible to whoever
   * provisioned it — so this is the security fix and the thing that makes the
   * feature work at the same time.
   */
  it('provisioning does not derive the organization from the display name', () => {
    const id = provision(B, 'Alpha');
    scope = B;
    expect(store.listTenants().find((t) => t.id === id)?.organizationId).toBe(B.tenantId);
    scope = A;
    expect(store.listTenants().map((t) => t.id)).not.toContain(id);
  });
});

/* ── Directory and isolation ────────────────────────────────────────────── */

describe('F10 — the cloud directory is not an install-wide listing', () => {
  it('A cannot enumerate B’s cloud tenants', () => {
    const idB = provision(B, 'Bravo Cloud');
    scope = A;
    expect(store.listTenants().map((t) => t.id)).not.toContain(idB);
    expect(store.tenant(idB)).toBeNull();
  });

  /**
   * The sharpest of the install-wide reads. A namespace and an encryption key id
   * are infrastructure identifiers for another customer's data at rest.
   */
  it('A cannot read B’s storage namespace or encryption key id', () => {
    const idB = provision(B, 'Bravo Cloud');
    scope = B;
    const theirs = store.listIsolation().find((i) => i.tenantId === idB);
    expect(theirs?.namespace).toBeTruthy();
    const namespace = theirs?.namespace as string;
    const keyId = theirs?.encryptionKeyId as string;

    scope = A;
    const blob = JSON.stringify(store.listIsolation());
    expect(blob).not.toContain(namespace);
    expect(blob).not.toContain(keyId);
  });

  it('the summary counts only the caller’s cloud footprint', () => {
    provision(B, 'Bravo Cloud');
    provision(C, 'Charlie Cloud');
    scope = A;
    expect(store.summary().tenants).toBe(1); // its own home tenant
  });

  it('an unresolved caller sees no tenants and no isolation', () => {
    provision(B, 'Bravo Cloud');
    scope = null;
    expect(store.listTenants()).toEqual([]);
    expect(store.listIsolation()).toEqual([]);
  });
});

/* ── Projects, teams, workers — reachable AND denied ────────────────────── */

describe('F10 — project authorization, proven in both directions', () => {
  /**
   * Reachability FIRST. Under the broken mapping this assertion would have
   * failed, which is exactly why the denial assertions that follow it mean
   * something now and meant nothing before.
   */
  it('B can create and read its OWN project', () => {
    const idB = provision(B, 'Bravo Cloud');
    scope = B;
    const project = store.createProject({ tenantId: idB, name: 'Platform' });
    expect(project).not.toBeNull();
    expect(store.listProjects(idB).map((p) => p.name)).toContain('Platform');
  });

  it('A cannot read B’s projects, even naming B’s cloud tenant id directly', () => {
    const idB = provision(B, 'Bravo Cloud');
    scope = B;
    store.createProject({ tenantId: idB, name: 'SECRET-PROJECT' });

    scope = A;
    expect(store.listProjects(idB)).toEqual([]);
    expect(JSON.stringify(store.listProjects(idB))).not.toContain('SECRET-PROJECT');
  });

  it('A cannot CREATE a project inside B’s cloud tenant', () => {
    const idB = provision(B, 'Bravo Cloud');
    scope = A;
    expect(store.createProject({ tenantId: idB, name: 'Hostile' })).toBeNull();
    scope = B;
    expect(store.listProjects(idB)).toEqual([]);
  });

  it('A cannot DELETE B’s project', () => {
    const idB = provision(B, 'Bravo Cloud');
    scope = B;
    const project = store.createProject({ tenantId: idB, name: 'Platform' });
    const projectId = (project as { id: string }).id;

    scope = A;
    expect(store.deleteProject(projectId)).toBe(false);
    scope = B;
    expect(store.listProjects(idB)).toHaveLength(1);
  });

  it('teams and workers follow the same rule, both ways', () => {
    const idB = provision(B, 'Bravo Cloud');
    scope = B;
    expect(store.createTeam({ tenantId: idB, name: 'Core' })).not.toBeNull();
    expect(store.listTeams(idB)).toHaveLength(1);

    scope = C;
    expect(store.createTeam({ tenantId: idB, name: 'Hostile' })).toBeNull();
    expect(store.listTeams(idB)).toEqual([]);
    expect(store.listWorkers(idB)).toEqual([]);
  });

  /** Suspending another organization's cloud tenant is a denial of service. */
  it('A cannot suspend B’s cloud tenant', () => {
    const idB = provision(B, 'Bravo Cloud');
    scope = A;
    expect(store.setTenantStatus(idB, 'suspended')).toBeNull();
    scope = B;
    expect(store.listTenants().find((t) => t.id === idB)?.status).toBe('provisioning');
  });

  it('an unresolved caller can neither read nor provision', () => {
    const idB = provision(B, 'Bravo Cloud');
    scope = null;
    expect(store.listProjects(idB)).toEqual([]);
    expect(store.createProject({ tenantId: idB, name: 'x' })).toBeNull();
    expect(() => store.createTenant({ name: 'Ghost', regionId: 'us-east', tier: 'business' })).toThrow(/no owner/i);
  });
});
