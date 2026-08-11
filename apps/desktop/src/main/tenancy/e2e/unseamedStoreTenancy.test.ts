/**
 * PROGRAM 13C ROUND 5 — the six stores that had no tenant boundary.
 *
 * Five needed one. One did not, and proving that is as much work as proving the
 * other five — a `declareSystemGlobalStore` call is a CLAIM, and a claim with no
 * test behind it is exactly the "confident comment read as evidence" that let
 * federation sit unexamined for five sweeps.
 *
 * The classifications, and the single fact that decided each:
 *
 *   executionStore       TENANT — `result` is the full structured output of an
 *                        executed action. The in-memory ring was made per-tenant
 *                        in Round 2; the FILE behind it kept a flat cap.
 *   erp/approvalStore    TENANT — the primary key IS a tenant's document id.
 *   healthHistoryStore   TENANT — `overall` is a function of one organization's
 *                        headcount and licence state, and the row was keyed by
 *                        CALENDAR DAY, so tenants overwrote each other.
 *   governanceStore      TENANT — chains and rules carry an `orgId` nothing read,
 *                        and `setChainEnabled(id)` took a bare payload id.
 *   syncStateStore       WORKSPACE — a connection is a workspace object.
 *   installStore         SYSTEM-GLOBAL — publisher-authored package metadata.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TenantScope } from '@neuropause/shared';
import { ExecutionStore } from '../../executionStore';
import { ApprovalStore } from '../../erp/approvalStore';
import { HealthHistoryStore } from '../../enterprise/healthHistoryStore';
import { GovernanceStore } from '../../enterprise/governance/governanceStore';
import { InstallStore } from '../../workforce/install/installStore';

const A: TenantScope = { tenantId: 'org-alpha', workspaceId: 'ws-a' };
const B: TenantScope = { tenantId: 'org-bravo', workspaceId: 'ws-b' };

const MARK_A = 'NP-STORE-A-660214';
const MARK_B = 'NP-STORE-B-991martin'.replace('martin', '337');

let scope: TenantScope | null = A;
let dir: string;

beforeEach(async () => {
  dir = join(tmpdir(), `np-unseamed-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  scope = A;
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
});

const src = (): TenantScope | null => scope;

/* ── executionStore ─────────────────────────────────────────────────────── */

describe('executionStore — TENANT-SCOPED', () => {
  function session(tenantId: string, marker: string, startedAt: string) {
    return {
      id: `exec_${randomUUID()}`,
      tenantId,
      kind: 'task',
      label: `Task ${marker}`,
      state: 'succeeded',
      steps: [],
      currentStep: 0,
      startedAt,
      completedAt: startedAt,
      durationMs: 1,
      error: null,
      resultSummary: marker,
      result: { secret: marker },
    } as never;
  }

  /**
   * The finding was NOT a disclosure — nothing reads this file but boot
   * recovery, and the ring it feeds filters on owner. It was DESTRUCTION: a flat
   * 500-row cap, applied install-wide, so a busy tenant truncated another
   * tenant's durable execution record and a restart could not restore it.
   */
  it('a busy tenant does not evict the other tenant’s persisted sessions', async () => {
    const store = new ExecutionStore(join(dir, 'exec.json')).bindScope(src);

    scope = B;
    await store.save(session(B.tenantId, MARK_B, '2020-01-01T00:00:00.000Z')); // the oldest row

    scope = A;
    for (let i = 0; i < 600; i += 1) {
      await store.save(session(A.tenantId, MARK_A, new Date(Date.parse('2026-01-01T00:00:00.000Z') + i).toISOString()));
    }

    expect(store.ownershipCounts().assigned).toBeGreaterThan(0);
    const all = JSON.stringify(store.loadAllSync());
    expect(all).toContain(MARK_B); // B's five-year-old row survived A's 600 writes
  });
});

/* ── erp/approvalStore ──────────────────────────────────────────────────── */

describe('erp/approvalStore — TENANT-SCOPED', () => {
  const decision = (marker: string) => [{ stepId: 's1', userId: 'u1', decision: 'approved' as const, at: '2026-01-01T00:00:00.000Z', note: marker }];

  /**
   * Its safety was entirely BORROWED from the module registry resolving the
   * record through a scoped store first. That closes the reachable path and
   * leaves the store one new caller away from a disclosure.
   */
  it('A cannot read B’s approvals, even on the same module and document id', async () => {
    const store = new ApprovalStore(join(dir, 'appr.json')).bindScope(src);
    await store.load();

    scope = B;
    store.replace('invoices', 'doc-1', decision(MARK_B));

    scope = A;
    expect(store.forDocument('invoices', 'doc-1')).toEqual([]);
    expect(JSON.stringify(store.forDocument('invoices', 'doc-1'))).not.toContain(MARK_B);
  });

  it('two tenants may hold the same document id without colliding', async () => {
    const store = new ApprovalStore(join(dir, 'appr.json')).bindScope(src);
    await store.load();

    scope = A;
    store.replace('invoices', 'doc-1', decision(MARK_A));
    scope = B;
    store.replace('invoices', 'doc-1', decision(MARK_B));

    scope = A;
    expect(store.forDocument('invoices', 'doc-1')[0]?.note).toBe(MARK_A);
    scope = B;
    expect(store.forDocument('invoices', 'doc-1')[0]?.note).toBe(MARK_B);
  });

  it('an unresolved caller reads nothing and writes nothing', async () => {
    const store = new ApprovalStore(join(dir, 'appr.json')).bindScope(src);
    await store.load();
    scope = A;
    store.replace('invoices', 'doc-1', decision(MARK_A));

    scope = null;
    expect(store.forDocument('invoices', 'doc-1')).toEqual([]);
    store.replace('invoices', 'doc-2', decision('ORPHAN'));
    scope = A;
    expect(store.forDocument('invoices', 'doc-2')).toEqual([]);
  });
});

/* ── healthHistoryStore ─────────────────────────────────────────────────── */

describe('healthHistoryStore — TENANT-SCOPED', () => {
  /**
   * THE ONE THAT LOOKED GLOBAL. `HealthPoint` is `{ day, overall, engineering }`
   * — three primitives, no ids, no text — which is exactly why it read as
   * install telemetry. But `overall` is derived from one organization's
   * headcount, licence runway and connector fleet.
   */
  it('A and B keep separate series for the SAME calendar day', async () => {
    const store = new HealthHistoryStore(join(dir, 'health.json')).bindScope(src);
    const day = Date.parse('2026-03-01T12:00:00.000Z');

    scope = A;
    await store.record(90, 65, day);
    scope = B;
    await store.record(20, 65, day);

    scope = A;
    expect(store.all().map((p) => p.overall)).toEqual([90]);
    scope = B;
    expect(store.all().map((p) => p.overall)).toEqual([20]);
  });

  /**
   * The mechanism was worse than a read leak: one row per day for the whole
   * install, last-write-wins, so whichever tenant opened the Executive Center
   * last that day DESTROYED the other's datapoint — and six subsystems then
   * drew trend lines and forecasts from whoever wrote last.
   */
  it('B writing does not destroy A’s datapoint for that day', async () => {
    const store = new HealthHistoryStore(join(dir, 'health.json')).bindScope(src);
    const day = Date.parse('2026-03-01T12:00:00.000Z');

    scope = A;
    await store.record(90, 65, day);
    scope = B;
    await store.record(20, 65, day);

    scope = A;
    expect(store.windowStats(30, 'overall', day)?.current).toBe(90);
  });

  it('an unresolved caller reads nothing and cannot record', async () => {
    const store = new HealthHistoryStore(join(dir, 'health.json')).bindScope(src);
    scope = A;
    await store.record(90, 65, Date.parse('2026-03-01T12:00:00.000Z'));
    scope = null;
    expect(store.all()).toEqual([]);
    await expect(store.record(50, 50)).rejects.toThrow(/no owner/i);
  });
});

/* ── governanceStore ────────────────────────────────────────────────────── */

describe('governanceStore — TENANT-SCOPED', () => {
  async function open(): Promise<GovernanceStore> {
    const g = new GovernanceStore(join(dir, 'gov.json')).bindScope(src);
    await g.load();
    return g;
  }

  /**
   * The default was the defect: the scope parameter was optional and
   * `undefined` meant EVERY WORKSPACE. Two callers omitted it, so an
   * install-wide count of a trail naming a tenant's record ids and titles
   * surfaced through `commercial:read`.
   */
  it('an OMITTED scope narrows to the caller instead of widening to the install', async () => {
    const gov = await open();
    gov.record({ actor: 'u', action: 'a', target: 't', summary: MARK_A, workspaceId: A.workspaceId });
    gov.record({ actor: 'u', action: 'a', target: 't', summary: MARK_B, workspaceId: B.workspaceId });

    scope = A;
    expect(gov.auditCount()).toBe(1);
    expect(JSON.stringify(gov.auditEntries())).not.toContain(MARK_B);
    scope = B;
    expect(gov.auditCount()).toBe(1);
  });

  it('an explicit null still denies — an intentional "no tenant" is honoured', async () => {
    const gov = await open();
    gov.record({ actor: 'u', action: 'a', target: 't', summary: MARK_A, workspaceId: A.workspaceId });
    scope = A;
    expect(gov.auditCount(null)).toBe(0);
    expect(gov.auditEntries(100, null)).toEqual([]);
  });

  /**
   * The sharpest write: an approval chain is what gates a tenant's documents, so
   * disabling another organization's chain removes a control they rely on.
   */
  /**
   * P13C ROUND 5, SECOND PASS. The first version of this test asserted that a
   * non-seeded organization had NO chains and NO rules, and read that emptiness
   * as isolation working.
   *
   * It was the breakage. The seeded defaults stamp the literal `ORG_ID`, so once
   * `chains()`/`rules()` began filtering on `orgId`, every organization except
   * the seeded one became UNGOVERNED — the autonomous-ops veto reads an empty
   * chain list as "ungoverned" and the compliance score computes
   * `passed/evaluated` with zero evaluated as a perfect 100%.
   *
   * A test that asserts an empty list is a weak test twice over: it passes when
   * isolation works and it passes when the feature is broken. This one now
   * asserts BOTH — that A has its own governance, and that it cannot touch B's.
   */
  it('each organization gets its own default governance, and cannot touch another’s', async () => {
    const gov = await open();

    scope = A;
    const aChains = gov.chains();
    const aRules = gov.rules();
    expect(aChains.length).toBeGreaterThan(0);
    expect(aRules.length).toBeGreaterThan(0);
    expect(aChains.every((c) => c.orgId === A.tenantId)).toBe(true);

    scope = B;
    const bChains = gov.chains();
    expect(bChains.length).toBeGreaterThan(0);
    expect(bChains.every((c) => c.orgId === B.tenantId)).toBe(true);

    // B's ids are distinct from A's, and neither can enable/disable the other's.
    const aChainId = aChains[0]?.id as string;
    expect(bChains.map((c) => c.id)).not.toContain(aChainId);
    expect(gov.setChainEnabled(aChainId, false)).toBeNull();

    scope = A;
    expect(gov.chains().find((c) => c.id === aChainId)?.enabled).toBe(true);
    // ...and A CAN disable its own — the gate is not simply "no".
    expect(gov.setChainEnabled(aChainId, false)?.enabled).toBe(false);
  });

  /** The chain is install-wide on purpose — it is a statement about the chain. */
  it('scoping the audit output does not break the tamper-evident chain', async () => {
    const gov = await open();
    gov.record({ actor: 'u', action: 'a', target: 't', summary: MARK_A, workspaceId: A.workspaceId });
    gov.record({ actor: 'u', action: 'a', target: 't', summary: MARK_B, workspaceId: B.workspaceId });
    expect(gov.verifyAuditIntegrity().ok).toBe(true);
    expect(gov.totalAudit()).toBe(2);
  });
});

/* ── installStore: the system-global CLAIM, tested ──────────────────────── */

describe('installStore — SYSTEM-GLOBAL, and here is why that is true', () => {
  /**
   * A `declareSystemGlobalStore` call exempts a store from the startup gate. That
   * exemption is only as good as the reason behind it, so the reason is asserted
   * rather than trusted: the records must contain no tenant-derived field.
   */
  it('a stored install record contains only publisher-authored package metadata', async () => {
    const store = new InstallStore(join(dir, 'installs.json'));
    await store.load();

    const manifest = {
      id: 'pkg.demo',
      name: 'Demo Worker',
      version: '1.0.0',
      author: 'Publisher Inc',
      description: 'A worker.',
      role: 'operations',
      goals: [],
      capabilities: [],
      permissions: [],
      skills: [],
      dependencies: [],
      engine: '1.x',
    } as never;

    store.put({
      id: 'pkg.demo',
      version: '1.0.0',
      state: 'enabled',
      manifest,
      checksum: 'abc',
      signatureKeyId: null,
      signature: null,
      previous: null,
      installedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as never);

    const row = store.get('pkg.demo');
    expect(row).not.toBeNull();

    /**
     * The load-bearing assertion. Every key on the record is package metadata,
     * a checksum, a signature or a timestamp — no tenant id, no organization,
     * no workspace, no record id, no customer text.
     */
    const keys = Object.keys(row as object);
    expect(keys).toEqual(
      expect.arrayContaining(['id', 'version', 'state', 'manifest', 'checksum', 'installedAt']),
    );
    for (const forbidden of ['tenantId', 'orgId', 'organizationId', 'workspaceId']) {
      expect(keys).not.toContain(forbidden);
      expect(Object.keys((row as { manifest: object }).manifest)).not.toContain(forbidden);
    }
  });

  /**
   * The declaration's stated COST, asserted so it stays true: the install
   * lifecycle is a shared administration surface. This is the same property as
   * uninstalling a plugin, which is why the permission is Admin/Owner only —
   * but it is a property, not an accident, and a test is where that distinction
   * survives.
   */
  it('the install set is genuinely shared — which is the declared trade, not a leak', async () => {
    const store = new InstallStore(join(dir, 'installs.json'));
    await store.load();
    expect(store.all()).toEqual([]);
    // No scope is bindable on this store at all: there is no `bindScope` to call.
    expect((store as unknown as { bindScope?: unknown }).bindScope).toBeUndefined();
  });
});
