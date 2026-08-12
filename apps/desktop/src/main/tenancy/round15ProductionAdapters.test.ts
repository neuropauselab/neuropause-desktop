/**
 * F22 PRODUCTION ADAPTERS. P13C ROUND 15.
 *
 * Round 14 proved the mechanism against fixtures. These run the SAME archive and
 * restore code against REAL production stores — `DecisionStore`,
 * `AutomationStore`, `HealthHistoryStore` — writing real files to disk, so the
 * seam, the clone, the merge and the reload are all exercised for real.
 *
 * The store-side seam (`snapshotForGrant` / `mergeForGrant`) takes a
 * `TenantReadGrant`, a branded type only `authorizeTenantRead` can mint. So
 * these are not unscoped reads that anything can call — the authority is in the
 * type, and `onlyMine` remains the seam for every ordinary caller.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TenantScope } from '@neuropause/shared';
import { DecisionStore } from '../enterprise/decisionStore';
import { AutomationStore } from '../enterprise/automationStore';
import { authorizeTenantRead } from '../tenancy/tenantOwnedStore';
import {
  createTenantArchive,
  restoreTenantArchive,
  registerTenantDomainSource,
  registeredTenantDomains,
  tenantArchiveCoverageGaps,
  TENANT_DERIVED_DOMAINS,
  __resetTenantDomainSourcesForTests,
} from '../backup/tenantArchive';
import { executiveDecisionsSource, automationRulesSource } from '../backup/tenantDomainSources';

const A = 'org-a';
const B = 'org-b';
const C = 'org-c';
const OPERATOR = { tenantId: 'org-platform', platformOperator: true };

let dir: string;
let decisions: DecisionStore;
let automation: AutomationStore;
let who: TenantScope | null = null;

const as = (t: string): TenantScope => ({ tenantId: t, workspaceId: `ws-${t}` });

beforeEach(async () => {
  dir = join(tmpdir(), `np-r15-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  decisions = new DecisionStore(join(dir, 'decisions.json')).bindScope(() => who);
  automation = new AutomationStore(join(dir, 'automations.json')).bindScope(() => who);
  __resetTenantDomainSourcesForTests();
  registerTenantDomainSource(executiveDecisionsSource(decisions));
  registerTenantDomainSource(automationRulesSource(automation));
  who = null;
});
afterEach(async () => {
  __resetTenantDomainSourcesForTests();
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
});

/** Create `n` decisions as `tenant`, through the store's ORDINARY write path. */
async function seedDecisions(tenant: string, n: number): Promise<void> {
  who = as(tenant);
  for (let i = 0; i < n; i += 1) {
    await decisions.create({
      id: `${tenant}-d${i}-${randomUUID().slice(0, 6)}`,
      title: `${tenant} decision ${i}`,
      category: 'operational',
      description: `made by ${tenant}`,
      reasoning: 'fixture',
      evidence: [],
      sourceSystems: [],
      confidence: 0.8,
      businessImpact: 'medium',
      expectedOutcome: 'fixture',
      owner: `${tenant}-owner`,
      priority: 'medium',
      status: 'pending',
      createdAt: new Date(Date.now() + i).toISOString(),
      updatedAt: new Date().toISOString(),
    } as never);
  }
  who = null;
}

describe('a real archive over real stores holds one tenant', () => {
  it('A’s archive contains A’s decisions and no B or C', async () => {
    await seedDecisions(A, 3);
    await seedDecisions(B, 5);
    await seedDecisions(C, 2);

    const archive = await createTenantArchive(authorizeTenantRead(OPERATOR, A), 'now', 'bk-a');
    const rows = archive.data['executive-decisions']!;
    expect(rows).toHaveLength(3);

    const bytes = JSON.stringify(archive);
    expect(bytes).not.toContain(B);
    expect(bytes).not.toContain(C);
    expect(bytes).not.toContain('made by org-b');
  });

  it('per-domain archive counts equal live per-tenant counts', async () => {
    await seedDecisions(A, 3);
    await seedDecisions(B, 5);
    for (const [tenant, n] of [[A, 3], [B, 5]] as Array<[string, number]>) {
      const a = await createTenantArchive(authorizeTenantRead(OPERATOR, tenant), 'now', 'bk');
      const entry = a.manifest.domains.find((d) => d.domain === 'executive-decisions')!;
      expect(entry.recordCount).toBe(n);
      who = as(tenant);
      expect(decisions.all()).toHaveLength(n);
      who = null;
    }
  });
});

describe('restore against a real store preserves the other tenants', () => {
  it('A is restored from disk state; B and C are untouched', async () => {
    await seedDecisions(A, 2);
    await seedDecisions(B, 3);
    await seedDecisions(C, 1);

    const grantA = authorizeTenantRead(OPERATOR, A);
    const archive = await createTenantArchive(grantA, 'now', 'bk-a');

    // A drifts: add a decision that is not in the archive.
    await seedDecisions(A, 2);
    who = as(A);
    expect(decisions.all()).toHaveLength(4);
    who = null;

    const res = await restoreTenantArchive(grantA, archive);
    expect(res.ok).toBe(true);
    expect(res.requiresRestart).toBe(true);

    who = as(A);
    expect(decisions.all()).toHaveLength(2);
    who = as(B);
    expect(decisions.all()).toHaveLength(3);
    who = as(C);
    expect(decisions.all()).toHaveLength(1);
    who = null;
  });

  it('the merge reaches DISK, not just memory', async () => {
    await seedDecisions(A, 2);
    await seedDecisions(B, 3);
    const grantA = authorizeTenantRead(OPERATOR, A);
    const archive = await createTenantArchive(grantA, 'now', 'bk-a');
    await seedDecisions(A, 2);
    await restoreTenantArchive(grantA, archive);

    // A fresh store over the same file sees the merged result.
    const reopened = new DecisionStore(join(dir, 'decisions.json')).bindScope(() => who);
    who = as(A);
    expect(reopened.all()).toHaveLength(2);
    who = as(B);
    expect(reopened.all()).toHaveLength(3);
    who = null;
  });
});

describe('the production adapter refuses what the fixture adapter refused', () => {
  it('a relabelled manifest is caught by the row owner', async () => {
    await seedDecisions(A, 1);
    await seedDecisions(B, 2);
    const bArchive = await createTenantArchive(authorizeTenantRead(OPERATOR, B), 'now', 'bk-b');
    bArchive.manifest.tenantId = A;
    const res = await restoreTenantArchive(authorizeTenantRead(OPERATOR, A), bArchive);
    expect(res.refusal).toBe('ROW_OWNER_MISMATCH');
    who = as(B);
    expect(decisions.all()).toHaveLength(2);
    who = null;
  });

  it('two domains, one corrupted — nothing is written', async () => {
    await seedDecisions(A, 2);
    who = as(A);
    await automation.save({
      id: `a-rule-${randomUUID().slice(0, 6)}`,
      name: 'A rule',
      description: 'fixture',
      status: 'active',
      trigger: { kind: 'manual' },
      conditions: [],
      actions: [{ kind: 'notify', config: {} }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as never);
    who = null;

    const grantA = authorizeTenantRead(OPERATOR, A);
    const archive = await createTenantArchive(grantA, 'now', 'bk-a');
    await seedDecisions(A, 1); // A now has 3
    (archive.data['automation-rules'] as Array<Record<string, unknown>>)[0]!.name = 'INJECTED';

    expect((await restoreTenantArchive(grantA, archive)).refusal).toBe('INTEGRITY_MISMATCH');
    who = as(A);
    expect(decisions.all()).toHaveLength(3); // untouched by the aborted restore
    who = null;
  });
});

describe('coverage is advancing and still honestly reported', () => {
  it('the registered domains are real ones, and gaps are named', async () => {
    expect(registeredTenantDomains()).toEqual(['automation-rules', 'executive-decisions']);
    const gaps = tenantArchiveCoverageGaps();
    expect(gaps).toContain('ai-memory-store');
    expect(gaps).toContain('workforce-governance-audit');
    expect(registeredTenantDomains().length + gaps.length).toBe(TENANT_DERIVED_DOMAINS.length);
  });

  it('an archive still declares itself incomplete', async () => {
    await seedDecisions(A, 1);
    const a = await createTenantArchive(authorizeTenantRead(OPERATOR, A), 'now', 'bk');
    expect(a.manifest.complete).toBe(false);
    expect(a.manifest.uncoveredDomains.length).toBe(TENANT_DERIVED_DOMAINS.length - 2);
  });
});
