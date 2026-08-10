/**
 * P13C N3 — the Sandbox subsystem, two tenants.
 *
 * Before this the subsystem had NO tenant dimension: `SandboxWorkspace` carried
 * no owner, so scenarios, executions, artifacts and datasets could not be
 * scoped even in principle. `SandboxWorkspaceList` returned every workspace on
 * the install, reads took an unvalidated payload `workspaceId`, two of them
 * made it OPTIONAL so omitting it was the bypass, and creates wrote into a
 * caller-named workspace.
 *
 * These tests drive the STORES through the same binding production uses — a
 * mutable scope, read through `bindScope` — because that is how the app
 * switches tenants. Reconstructing the stores per tenant would discard the
 * other tenant's rows and make every assertion pass for the wrong reason.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TenantScope } from '@neuropause/shared';
import { SandboxWorkspaceStore } from '../sandbox/workspaceStore';
import { SandboxScenarioStore } from '../sandbox/scenarioStore';
import { SandboxExecutionStore } from '../sandbox/executionStore';
import { SandboxArtifactStore } from '../sandbox/artifactStore';
import { SandboxDatasetStore } from '../sandbox/datasetStore';
import { OTHER_TENANT_SCOPE, TEST_TENANT_SCOPE } from './testScope';

const A = TEST_TENANT_SCOPE;
const B = OTHER_TENANT_SCOPE;
const NOW = () => Date.parse('2026-08-11T00:00:00.000Z');

/** Whose call this is. Mutable — switching tenants is the thing under test. */
let scope: TenantScope | null = A;

let dir: string;
let workspaces: SandboxWorkspaceStore;
let scenarios: SandboxScenarioStore;
let executions: SandboxExecutionStore;
let artifacts: SandboxArtifactStore;
let datasets: SandboxDatasetStore;

beforeEach(async () => {
  dir = join(tmpdir(), `np-sbx-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  const src = (): TenantScope | null => scope;
  workspaces = new SandboxWorkspaceStore(join(dir, 'w.json'), NOW).bindScope(src);
  scenarios = new SandboxScenarioStore(join(dir, 's.json'), NOW).bindScope(src);
  executions = new SandboxExecutionStore(join(dir, 'e.json'), NOW).bindScope(src);
  artifacts = new SandboxArtifactStore(join(dir, 'a.json'), NOW).bindScope(src);
  datasets = new SandboxDatasetStore(join(dir, 'd.json'), NOW).bindScope(src);
  await Promise.all([
    workspaces.load(),
    scenarios.load(),
    executions.load(),
    artifacts.load(),
    datasets.load(),
  ]);
  scope = A;
});

afterEach(async () => {
  for (const s of [workspaces, scenarios, executions, artifacts, datasets]) {
    await s.flush().catch(() => {});
  }
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
});

/** Build one tenant's full sandbox tree, with markers unique to that tenant. */
function buildTree(tenant: TenantScope, marker: string) {
  scope = tenant;
  const ws = workspaces.create({ name: `Sandbox ${marker}` });
  const sc = scenarios.create({ workspaceId: ws.id, key: `key-${marker}`, name: `Scenario ${marker}` });
  const version = scenarios.createVersion(sc.id, { secret: marker }, 'v1');
  const ex = executions.create({
    workspaceId: ws.id,
    scenarioId: sc.id,
    scenarioVersion: version!.version,
    trigger: 'manual',
    priority: 'normal',
  });
  const art = artifacts.add({
    executionId: ex.id,
    workspaceId: ws.id,
    kind: 'log',
    name: `${marker}.log`,
    inline: `CONFIDENTIAL-${marker}`,
  });
  const ds = datasets.create({ workspaceId: ws.id, name: `Dataset ${marker}` });
  return { ws, sc, version: version!, ex, art, ds };
}

const MARK_A = 'NP-SANDBOX-A-9812';
const MARK_B = 'NP-SANDBOX-B-4721';

describe('Phase 6 — sandbox reads are per tenant', () => {
  it('A lists only A’s workspaces and B only B’s', () => {
    const a = buildTree(A, MARK_A);
    const b = buildTree(B, MARK_B);

    scope = A;
    expect(workspaces.list().map((w) => w.id)).toEqual([a.ws.id]);
    scope = B;
    expect(workspaces.list().map((w) => w.id)).toEqual([b.ws.id]);
  });

  it('scenarios, executions, artifacts and datasets are all scoped', () => {
    buildTree(A, MARK_A);
    const b = buildTree(B, MARK_B);

    scope = A;
    expect(scenarios.list().map((s) => s.name)).toEqual([`Scenario ${MARK_A}`]);
    expect(executions.all()).toHaveLength(1);
    expect(artifacts.all().map((x) => x.name)).toEqual([`${MARK_A}.log`]);
    expect(datasets.list().map((d) => d.name)).toEqual([`Dataset ${MARK_A}`]);

    // Nothing of B's leaked into any of A's four lists.
    const blob = JSON.stringify([scenarios.list(), executions.all(), artifacts.all(), datasets.list()]);
    expect(blob).not.toContain(MARK_B);
    expect(blob).not.toContain(b.ws.id);
  });

  it('counts are per tenant, never install-wide', () => {
    buildTree(A, MARK_A);
    buildTree(B, MARK_B);
    scope = A;
    expect(workspaces.count()).toBe(1);
    expect(executions.count()).toBe(1);
    expect(artifacts.count()).toBe(1);
  });
});

/* ── Phase 17: malicious cross-tenant ids ───────────────────────────────── */

describe('Phase 17 — a direct id from another tenant is refused', () => {
  it('A cannot get B’s workspace, scenario, execution, artifact or dataset', () => {
    buildTree(A, MARK_A);
    const b = buildTree(B, MARK_B);

    scope = A;
    expect(workspaces.get(b.ws.id)).toBeNull();
    expect(scenarios.get(b.sc.id)).toBeNull();
    expect(executions.get(b.ex.id)).toBeNull();
    expect(artifacts.get(b.art.id)).toBeNull();
    expect(datasets.get(b.ds.id)).toBeNull();
  });

  it('is symmetric — B cannot reach A’s objects either', () => {
    const a = buildTree(A, MARK_A);
    buildTree(B, MARK_B);

    scope = B;
    expect(workspaces.get(a.ws.id)).toBeNull();
    expect(scenarios.get(a.sc.id)).toBeNull();
    expect(executions.get(a.ex.id)).toBeNull();
    expect(artifacts.get(a.art.id)).toBeNull();
    expect(datasets.get(a.ds.id)).toBeNull();
  });

  /**
   * The sharpest read in the subsystem: `inline` carries the complete result
   * and report JSON of a run. An artifact id alone used to return it.
   */
  it('never returns another tenant’s artifact CONTENT', () => {
    const a = buildTree(A, MARK_A);
    scope = B;
    expect(artifacts.get(a.art.id)).toBeNull();
    expect(JSON.stringify(artifacts.all())).not.toContain(`CONFIDENTIAL-${MARK_A}`);
  });

  it('never returns another tenant’s scenario SPEC through versions', () => {
    const a = buildTree(A, MARK_A);
    scope = B;
    expect(scenarios.versions(a.sc.id)).toEqual([]);
    expect(scenarios.latestVersion(a.sc.id)).toBeNull();
    expect(scenarios.getVersion(a.sc.id, 1)).toBeNull();
  });

  it('never returns another tenant’s execution TIMELINE', () => {
    const a = buildTree(A, MARK_A);
    executions.appendTimeline(a.ex.id, 'log', 'info', `step for ${MARK_A}`);
    scope = B;
    expect(executions.timelineFor(a.ex.id)).toEqual([]);
  });

  it('artifact listing by a foreign executionId returns nothing', () => {
    const a = buildTree(A, MARK_A);
    scope = B;
    expect(artifacts.list(a.ex.id)).toEqual([]);
    expect(artifacts.getResult(a.ex.id)).toBeNull();
    expect(artifacts.getReport(a.ex.id)).toBeNull();
  });
});

/* ── Phases 8 & 9: update and delete ────────────────────────────────────── */

describe('Phase 8/9 — a foreign id cannot be updated or deleted', () => {
  it('A cannot update or delete B’s workspace', () => {
    buildTree(A, MARK_A);
    const b = buildTree(B, MARK_B);

    scope = A;
    expect(workspaces.update(b.ws.id, { name: 'HIJACKED' })).toBeNull();
    expect(workspaces.delete(b.ws.id)).toBe(false);

    scope = B;
    expect(workspaces.get(b.ws.id)?.name).toBe(`Sandbox ${MARK_B}`);
  });

  it('A cannot update or archive B’s scenario, or add a version to it', () => {
    buildTree(A, MARK_A);
    const b = buildTree(B, MARK_B);

    scope = A;
    expect(scenarios.update(b.sc.id, { name: 'HIJACKED' })).toBeNull();
    expect(scenarios.archive(b.sc.id, true)).toBeNull();
    expect(scenarios.createVersion(b.sc.id, { evil: true }, 'x')).toBeNull();

    scope = B;
    expect(scenarios.get(b.sc.id)?.name).toBe(`Scenario ${MARK_B}`);
    expect(scenarios.get(b.sc.id)?.archived).toBe(false);
    expect(scenarios.versions(b.sc.id)).toHaveLength(1);
  });

  it('A cannot delete B’s dataset', () => {
    buildTree(A, MARK_A);
    const b = buildTree(B, MARK_B);
    scope = A;
    expect(datasets.delete(b.ds.id)).toBe(false);
    scope = B;
    expect(datasets.get(b.ds.id)).not.toBeNull();
  });

  /** "delete all" means all of MINE. Deleting A's tree leaves B's whole. */
  it('deleting A’s objects leaves B’s intact', () => {
    const a = buildTree(A, MARK_A);
    const b = buildTree(B, MARK_B);

    scope = A;
    expect(workspaces.delete(a.ws.id)).toBe(true);
    expect(datasets.delete(a.ds.id)).toBe(true);

    scope = B;
    expect(workspaces.get(b.ws.id)).not.toBeNull();
    expect(datasets.get(b.ds.id)).not.toBeNull();
  });
});

/* ── Phase 7: the optional-workspaceId bypass ───────────────────────────── */

describe('Phase 7 — an omitted workspaceId narrows, it never widens', () => {
  it('scenarios.list() with no workspaceId returns only MY scenarios', () => {
    buildTree(A, MARK_A);
    buildTree(B, MARK_B);
    scope = A;
    const all = scenarios.list(); // the payload field omitted entirely
    expect(all).toHaveLength(1);
    expect(all[0]!.name).toBe(`Scenario ${MARK_A}`);
  });

  it('datasets.list() with no workspaceId returns only MY datasets', () => {
    buildTree(A, MARK_A);
    buildTree(B, MARK_B);
    scope = B;
    expect(datasets.list().map((d) => d.name)).toEqual([`Dataset ${MARK_B}`]);
  });

  it('executions.history({}) returns only MY runs, and a scoped total', () => {
    buildTree(A, MARK_A);
    buildTree(B, MARK_B);
    scope = A;
    const page = executions.history({});
    expect(page.executions).toHaveLength(1);
    expect(page.total).toBe(1); // was an install-wide count
  });

  it('naming ANOTHER tenant’s workspaceId returns nothing, not that workspace', () => {
    buildTree(A, MARK_A);
    const b = buildTree(B, MARK_B);
    scope = A;
    expect(scenarios.list({ workspaceId: b.ws.id })).toEqual([]);
    expect(datasets.list(b.ws.id)).toEqual([]);
    expect(executions.history({ workspaceId: b.ws.id }).executions).toEqual([]);
  });
});

/* ── Fail-closed ────────────────────────────────────────────────────────── */

describe('fail-closed', () => {
  it('an unresolved tenant reads NOTHING', () => {
    buildTree(A, MARK_A);
    scope = null;
    expect(workspaces.list()).toEqual([]);
    expect(scenarios.list()).toEqual([]);
    expect(executions.all()).toEqual([]);
    expect(artifacts.all()).toEqual([]);
    expect(datasets.list()).toEqual([]);
  });

  it('an unresolved tenant cannot WRITE — it refuses rather than creating unowned', () => {
    scope = null;
    expect(() => workspaces.create({ name: 'orphan' })).toThrow(/no owner/i);
    expect(() => datasets.create({ workspaceId: 'sbw_x', name: 'orphan' })).toThrow(/no owner/i);
  });

  it('an UNBOUND store denies, so a forgotten binding fails closed', async () => {
    const unbound = new SandboxWorkspaceStore(join(dir, 'u.json'), NOW);
    await unbound.load();
    expect(unbound.hasScope()).toBe(false);
    expect(unbound.list()).toEqual([]);
    expect(() => unbound.create({ name: 'x' })).toThrow(/no owner/i);
  });

  /**
   * `ensureDefault()` returned THE FIRST WORKSPACE ON THE INSTALL — the
   * `organizations[0]` fallback in another costume. Every tenant's "default"
   * sandbox was whichever tenant created one first.
   */
  it('ensureDefault gives each tenant their OWN default, never the first install-wide', () => {
    scope = A;
    const aDefault = workspaces.ensureDefault();
    scope = B;
    const bDefault = workspaces.ensureDefault();

    expect(bDefault.id).not.toBe(aDefault.id);
    expect(bDefault.tenantId).toBe(B.tenantId);
    scope = A;
    expect(workspaces.ensureDefault().id).toBe(aDefault.id); // stable for A
  });

  /** Rows written before P13C carry no owner and belong to nobody. */
  it('a pre-P13C unowned row is visible to NEITHER tenant', async () => {
    const legacy = join(dir, 'legacy.json');
    await fs.writeFile(
      legacy,
      JSON.stringify({
        workspaces: [
          {
            id: 'sbw_legacy',
            name: 'Pre-P13C',
            description: '',
            settings: { defaultTimeoutMs: 1, maxConcurrency: 1, retentionDays: 1 },
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      }),
    );
    const store = new SandboxWorkspaceStore(legacy, NOW).bindScope(() => scope);
    await store.load();

    scope = A;
    expect(store.list()).toEqual([]);
    expect(store.get('sbw_legacy')).toBeNull();
    scope = B;
    expect(store.get('sbw_legacy')).toBeNull();

    // …but it is still THERE, counted as unresolved rather than destroyed.
    expect(store.ownershipCounts()).toEqual({ total: 1, assigned: 0, unresolved: 1 });
  });
});
