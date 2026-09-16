/**
 * PHASE D — NEGATIVE CONTROLS for the governed Data IMPORT transition.
 *
 * Every mutation-sensitive control establishes:
 *   PRE-STATE → ATTEMPTED TRANSITION → CST VERDICT → EFFECT / NO EFFECT → POST-STATE
 * on a REAL destination store (integration layer) or a spy effect over a
 * measurable destination (kernel-boundary layer, where a guard is mutation-proven
 * by toggling it off and showing the effect then runs).
 *
 * A control is reported PASS only when the required result is observed. Controls
 * that cannot be tripped through this integration are marked explicitly and are
 * NOT counted as passes. Nothing here modifies the frozen kernel.
 */
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EnterpriseRecordStore } from '../enterprise/framework/enterpriseRecordStore';
import { analyzeSource } from '../dataPlane/planner';
import { buildXlsx } from '../dataPlane/testFixtures';
import type { ImportDeps } from '../dataPlane/importer';
import { TEST_TENANT_SCOPE } from '../tenancy/testScope';
import { governedImport } from './importTransition';

import { CstKernel, type Effect, type Guards } from '@neuropause/cst/dist/src/kernel.js';
import {
  ClaimStore,
  EvidenceStore,
  IdempotencyStore,
  PolicyStore,
  ResourceStore,
  SystemTime,
} from '@neuropause/cst/dist/src/stores.js';
import {
  approvalId,
  idempotencyKey,
  requestId,
  transitionId,
  type Approval,
  type TransitionRequest,
} from '@neuropause/cst/dist/src/types.js';

const T0 = '2026-08-08T10:00:00.000Z';
const TENANT = TEST_TENANT_SCOPE.tenantId; // 'org-test'

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'np-cst-neg-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function store(moduleId: string): EnterpriseRecordStore {
  return new EnterpriseRecordStore(
    join(dir, `${moduleId}.json`),
    moduleId,
    moduleId.split('-')[1] ?? 'record',
  ).bindScope(() => TEST_TENANT_SCOPE);
}

const lowRiskBook = buildXlsx([
  {
    name: 'Projects',
    rows: [
      ['Project Number', 'Project Name', 'Manager', 'Budget'],
      ['P-1', 'Rollout', 'Mei', 900000],
      ['P-2', 'Migration', 'Daniel', 800000],
    ],
  },
]);

function importDepsFor(
  stores: Map<string, EnterpriseRecordStore>,
  over: Partial<ImportDeps> = {},
): ImportDeps {
  return {
    storeFor: (m) => stores.get(m) ?? null,
    actor: () => 'reviewer@np.example',
    now: () => T0,
    audit: () => undefined,
    authorizeWrite: () => undefined,
    readBack: (m, id) => {
      const s = stores.get(m);
      const r = s?.get(id);
      return r !== null && r !== undefined && r.status !== 'deleted';
    },
    ...over,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * INTEGRATION LAYER — governedImport against a REAL destination store.
 * ════════════════════════════════════════════════════════════════════════ */

describe('Phase D · integration layer (real destination store)', () => {
  it('CONTROL: low-risk C1 path — executes; must NOT require C3 approval; records written', async () => {
    const s = store('projects-projects');
    const stores = new Map([['projects-projects', s]]);
    const plan = analyzeSource('projects.xlsx', lowRiskBook, { now: () => T0 });
    expect(s.list()).toHaveLength(0); // PRE-STATE

    const g = await governedImport({
      plan,
      decisions: [{ tableName: 'Projects', approved: true }],
      tenantId: TENANT,
      actorId: 'reviewer@np.example',
      policyVersion: 'dp-import-policy-1',
      importDeps: importDepsFor(stores),
    });

    // VERDICT + EFFECT + POST-STATE
    expect(g.outcome.verdict).toBe('ALLOW');
    expect(g.outcome.reason).toBe('OK'); // C1 → approval NOT required (would be APPROVAL_REQUIRED if it wrongly demanded C3)
    expect(g.outcome.executed).toBe(true);
    expect(g.outcome.verification).toBe('VERIFIED');
    expect(g.outcome.outcomeClass).toBe('VERIFIED_SUCCESS');
    expect(g.result?.status).toBe('imported');
    expect(g.semanticOutcome).toBe('VERIFIED_SUCCESS'); // real mutation, not a no-op
    expect(s.list()).toHaveLength(2); // POST-STATE — records present
  });

  it('CONTROL: unobservable state — records written but verification is UNKNOWN, never VERIFIED', async () => {
    const s = store('projects-projects');
    const stores = new Map([['projects-projects', s]]);
    const plan = analyzeSource('projects.xlsx', lowRiskBook, { now: () => T0 });
    expect(s.list()).toHaveLength(0);

    // readBack throws → the authoritative source cannot answer.
    const g = await governedImport({
      plan,
      decisions: [{ tableName: 'Projects', approved: true }],
      tenantId: TENANT,
      actorId: 'reviewer@np.example',
      policyVersion: 'dp-import-policy-1',
      importDeps: importDepsFor(stores, {
        readBack: () => {
          throw new Error('destination unreadable');
        },
      }),
    });

    // Inducing unobservability via readBack ALSO breaks applyImportPlan's own
    // internal read-back, so the effect throws and the kernel reports
    // OUTCOME_UNKNOWN. The control ("unobservable ⇒ UNKNOWN, never VERIFIED") holds.
    expect(g.outcome.verdict).toBe('HOLD');
    expect(g.outcome.reason).toBe('OUTCOME_UNKNOWN');
    expect(g.outcome.verification).toBe('UNKNOWN'); // … ≠ VERIFIED
    expect(g.outcome.verification).not.toBe('VERIFIED');
    expect(g.outcome.executed).toBe(false); // the effect did not complete; we do not assert it did
  });

  it('CONTROL: post-state mismatch — reported writes not confirmed ⇒ DEVIATION, not success', async () => {
    const s = store('projects-projects');
    const stores = new Map([['projects-projects', s]]);
    const plan = analyzeSource('projects.xlsx', lowRiskBook, { now: () => T0 });

    // readBack denies every record (an observer that says the write is not there).
    const g = await governedImport({
      plan,
      decisions: [{ tableName: 'Projects', approved: true }],
      tenantId: TENANT,
      actorId: 'reviewer@np.example',
      policyVersion: 'dp-import-policy-1',
      importDeps: importDepsFor(stores, { readBack: () => false }),
    });

    expect(g.outcome.executed).toBe(true);
    expect(g.outcome.verification).toBe('DEVIATION');
    expect(g.outcome.outcomeClass).toBe('DEVIATION');
    expect(g.outcome.verification).not.toBe('VERIFIED');
    expect(g.outcome.deviation).not.toBeNull();
  });

  const highRiskBook = buildXlsx([
    {
      name: 'Invoices',
      rows: [
        ['Invoice Number', 'Amount', 'Customer'],
        ['INV-1', 50000, 'Globex'],
      ],
    },
  ]);

  it('F1-A: high-risk PRESENCE ⇒ C3; unapproved ⇒ HOLD APPROVAL_REQUIRED; NO effect', async () => {
    const plan = analyzeSource('invoices.xlsx', highRiskBook, { now: () => T0 });
    const mod = plan.tables[0]!.moduleId;
    const s = store(mod);
    const stores = new Map([[mod, s]]);
    expect(plan.tables.some((t) => t.requiresApproval)).toBe(true);
    expect(s.list()).toHaveLength(0); // PRE-STATE

    const g = await governedImport({
      plan,
      decisions: plan.tables.map((t) => ({ tableName: t.tableName, approved: false })),
      tenantId: TENANT,
      actorId: 'reviewer@np.example',
      policyVersion: 'dp-import-policy-1',
      importDeps: importDepsFor(stores),
    });

    // The F-1 correction: consequence is C3 by PRESENCE, so a refused high-risk
    // import HOLDs — it can never downgrade to C1 and pass as a vacuous no-op.
    expect(g.outcome.verdict).toBe('HOLD');
    expect(g.outcome.reason).toBe('APPROVAL_REQUIRED');
    expect(g.outcome.executed).toBe(false);
    expect(g.semanticOutcome).toBe('HOLD');
    expect(g.semanticOutcome).not.toBe('VERIFIED_SUCCESS');
    expect(g.semanticOutcome).not.toBe('VERIFIED_NOOP');
    expect(s.list()).toHaveLength(0); // POST-STATE unchanged
  });

  it('F1-B: high-risk WITH approval ⇒ C3 ⇒ ALLOW ⇒ effect ⇒ readBack ⇒ VERIFIED_SUCCESS', async () => {
    const plan = analyzeSource('invoices.xlsx', highRiskBook, { now: () => T0 });
    const mod = plan.tables[0]!.moduleId;
    const s = store(mod);
    const stores = new Map([[mod, s]]);

    const g = await governedImport({
      plan,
      decisions: plan.tables.map((t) => ({ tableName: t.tableName, approved: true })),
      tenantId: TENANT,
      actorId: 'reviewer@np.example',
      policyVersion: 'dp-import-policy-1',
      importDeps: importDepsFor(stores),
    });

    expect(g.outcome.verdict).toBe('ALLOW');
    expect(g.outcome.executed).toBe(true);
    expect(g.semanticOutcome).toBe('VERIFIED_SUCCESS');
    expect(s.list().length).toBeGreaterThan(0); // POST-STATE — records written
  });

  it('F1-C: authorized re-import (already current) ⇒ VERIFIED_NOOP, not SUCCESS, not FAILURE', async () => {
    const s = store('projects-projects');
    const stores = new Map([['projects-projects', s]]);
    const first = await governedImport({
      plan: analyzeSource('projects.xlsx', lowRiskBook, { now: () => T0 }),
      decisions: [{ tableName: 'Projects', approved: true }],
      tenantId: TENANT,
      actorId: 'reviewer@np.example',
      policyVersion: 'dp-import-policy-1',
      importDeps: importDepsFor(stores),
    });
    expect(first.semanticOutcome).toBe('VERIFIED_SUCCESS');
    const after = s.list().length;

    const second = await governedImport({
      plan: analyzeSource('projects.xlsx', lowRiskBook, { now: () => T0 }),
      decisions: [{ tableName: 'Projects', approved: true }],
      tenantId: TENANT,
      actorId: 'reviewer@np.example',
      policyVersion: 'dp-import-policy-1',
      importDeps: importDepsFor(stores),
    });
    // Authorized, nothing to change ⇒ NOOP. NOT success (no mutation), NOT failure.
    expect(second.result?.status).toBe('nothing_imported');
    expect(second.semanticOutcome).toBe('VERIFIED_NOOP');
    expect(second.semanticOutcome).not.toBe('VERIFIED_SUCCESS');
    expect(second.semanticOutcome).not.toBe('VERIFIED_FAILURE');
    expect(s.list()).toHaveLength(after); // POST-STATE unchanged — no duplicate
  });

  it('F1-D: unauthorized high-risk zero-write must NEVER be VERIFIED (the F-1 regression)', async () => {
    const plan = analyzeSource('invoices.xlsx', highRiskBook, { now: () => T0 });
    const mod = plan.tables[0]!.moduleId;
    const s = store(mod);
    const stores = new Map([[mod, s]]);
    const g = await governedImport({
      plan,
      decisions: plan.tables.map((t) => ({ tableName: t.tableName, approved: false })),
      tenantId: TENANT,
      actorId: 'reviewer@np.example',
      policyVersion: 'dp-import-policy-1',
      importDeps: importDepsFor(stores),
    });
    expect(g.outcome.verification).not.toBe('VERIFIED');
    expect(g.outcome.outcomeClass).not.toBe('VERIFIED_SUCCESS');
    expect(g.semanticOutcome).not.toBe('VERIFIED_SUCCESS');
    expect(g.semanticOutcome).not.toBe('VERIFIED_NOOP');
    expect(s.list()).toHaveLength(0);
  });

  it('F1-E/F: reported writes not authoritatively present ⇒ NOT VERIFIED_SUCCESS (non-vacuous)', async () => {
    const s = store('projects-projects');
    const stores = new Map([['projects-projects', s]]);
    const plan = analyzeSource('projects.xlsx', lowRiskBook, { now: () => T0 });
    // An observer that cannot confirm the writes (denies them) — the reported
    // effect is not established in the authoritative store.
    const g = await governedImport({
      plan,
      decisions: [{ tableName: 'Projects', approved: true }],
      tenantId: TENANT,
      actorId: 'reviewer@np.example',
      policyVersion: 'dp-import-policy-1',
      importDeps: importDepsFor(stores, { readBack: () => false }),
    });
    expect(g.outcome.verification).not.toBe('VERIFIED');
    expect(g.semanticOutcome).not.toBe('VERIFIED_SUCCESS');
    expect(g.semanticOutcome).not.toBe('VERIFIED_NOOP');
    expect(['DEVIATION', 'VERIFIED_FAILURE']).toContain(g.semanticOutcome);
  });

  // ── Atomic transition boundary (C3 Transition Integrity). A Data Import is ONE
  // governed transition: if any high-risk component lacks approval, the WHOLE
  // transition HOLDs and NO table mutates — never partial execution.
  const mixedBook = buildXlsx([
    { name: 'Customers', rows: [['Customer Name', 'Email'], ['Acme', 'ops@acme.example']] },
    {
      name: 'Projects',
      rows: [
        ['Project Number', 'Project Name', 'Manager', 'Budget'],
        ['P-9', 'Delta', 'Mei', 700000],
      ],
    },
  ]);

  it('MIXED-A: one unapproved high-risk table ⇒ WHOLE transition HOLD; NO table mutates', async () => {
    const plan = analyzeSource('mixed.xlsx', mixedBook, { now: () => T0 });
    const highRisk = plan.tables.filter((t) => t.requiresApproval);
    const lowRisk = plan.tables.filter((t) => !t.requiresApproval);
    expect(highRisk.length).toBeGreaterThan(0);
    expect(lowRisk.length).toBeGreaterThan(0);
    const stores = new Map(plan.tables.map((t) => [t.moduleId, store(t.moduleId)] as const));

    const g = await governedImport({
      plan,
      // approve the LOW-risk table, leave the HIGH-risk table unapproved
      decisions: plan.tables.map((t) => ({ tableName: t.tableName, approved: !t.requiresApproval })),
      tenantId: TENANT,
      actorId: 'reviewer@np.example',
      policyVersion: 'dp-import-policy-1',
      importDeps: importDepsFor(stores),
    });

    expect(g.outcome.verdict).toBe('HOLD');
    expect(g.outcome.reason).toBe('APPROVAL_REQUIRED');
    expect(g.outcome.executed).toBe(false);
    expect(g.semanticOutcome).toBe('HOLD');
    // atomic boundary: NEITHER the low-risk NOR the high-risk table mutated.
    for (const s of stores.values()) expect(s.list()).toHaveLength(0);
  });

  it('MIXED-B: all required approvals present ⇒ ALLOW; the ENTIRE plan executes and verifies', async () => {
    const plan = analyzeSource('mixed.xlsx', mixedBook, { now: () => T0 });
    const stores = new Map(plan.tables.map((t) => [t.moduleId, store(t.moduleId)] as const));

    const g = await governedImport({
      plan,
      decisions: plan.tables.map((t) => ({ tableName: t.tableName, approved: true })),
      tenantId: TENANT,
      actorId: 'reviewer@np.example',
      policyVersion: 'dp-import-policy-1',
      importDeps: importDepsFor(stores),
    });

    expect(g.outcome.verdict).toBe('ALLOW');
    expect(g.outcome.executed).toBe(true);
    expect(g.semanticOutcome).toBe('VERIFIED_SUCCESS');
    // C3 is not a permanent blocker: with approval, every table's records land.
    for (const s of stores.values()) expect(s.list().length).toBeGreaterThan(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KERNEL-BOUNDARY LAYER — import-shaped request + spy effect over a measurable
 * destination. A guard is mutation-proven by toggling it off (guards:{X:false})
 * and showing the effect then runs (the destination is mutated).
 * ════════════════════════════════════════════════════════════════════════ */

const ACTOR = { id: 'reviewer@np.example', type: 'HUMAN' as const, tenantId: TENANT };
const TARGET = { tenantId: TENANT, resourceType: 'dataplane-import', resourceId: 'plan-x', version: 1 };

function baseRequest(over: Partial<TransitionRequest> = {}): TransitionRequest {
  return {
    transitionId: transitionId('dp-import:plan-x'),
    requestId: requestId('req:plan-x:1'),
    actor: ACTOR,
    action: 'data.import',
    target: TARGET,
    purpose: 'import approved tables',
    intent: 'bulk import',
    expectedPostState: { allWrittenRecordsPresent: true },
    consequence: 'C1',
    reversibility: 'REVERSIBLE',
    policyVersion: 'pv',
    idempotencyKey: idempotencyKey('idem-plan-x'),
    evidence: [],
    ...over,
  };
}

interface HarnessOpts {
  grantedActor?: string;
  guards?: Partial<Guards>;
  claims?: ClaimStore;
  idempotency?: IdempotencyStore;
  evidence?: EvidenceStore;
  resources?: ResourceStore;
  effectAccepts?: boolean;
  sodActions?: ReadonlySet<string>;
}

async function runKernel(req: TransitionRequest, opts: HarnessOpts = {}) {
  const destination = new Map<string, unknown>(); // PRE-STATE = empty
  let effectRuns = 0;
  const effect: Effect = async () => {
    effectRuns += 1;
    destination.set('rec', { written: true });
    return { accepted: opts.effectAccepts ?? true };
  };
  const time = new SystemTime();
  const policy = new PolicyStore(
    new Map([[opts.grantedActor ?? ACTOR.id, new Set(['data.import'])]]),
    'pv',
    opts.sodActions,
  );
  const resources = opts.resources ?? (() => {
    const r = new ResourceStore();
    r.put(TARGET, { allWrittenRecordsPresent: true }); // pre-state, version matches
    return r;
  })();
  const kernel = new CstKernel({
    time,
    policy,
    claims: opts.claims ?? new ClaimStore(),
    idempotency: opts.idempotency ?? new IdempotencyStore(),
    resources,
    evidence: opts.evidence ?? new EvidenceStore(),
    reconcile: async () => ({ known: false }),
    ...(opts.guards ? { guards: opts.guards } : {}),
  });
  const outcome = await kernel.run(req, effect);
  return { outcome, effectRuns, destinationSize: destination.size };
}

function highRiskApproval(over: Partial<Approval> = {}): Approval {
  const t = Date.parse(T0);
  return {
    approvalId: approvalId('appr:plan-x'),
    transitionId: transitionId('dp-import:plan-x'),
    approver: ACTOR,
    action: 'data.import',
    scope: { tenantId: TENANT, resourceType: 'dataplane-import', resourceId: 'plan-x' },
    resourceVersion: 1,
    purpose: 'import approved tables',
    policyVersion: 'pv',
    issuedAt: t,
    expiresAt: t + 15 * 60_000,
    consumed: false,
    ...over,
  };
}

describe('Phase D · kernel-boundary controls (spy effect, measurable destination)', () => {
  it('CONTROL: unauthorized request — refused; NO mutation (+ mutation-proof)', async () => {
    // actor not in the grant map.
    const denied = await runKernel(baseRequest(), { grantedActor: 'someone-else' });
    expect(denied.outcome.verdict).toBe('DENY');
    expect(denied.outcome.reason).toBe('AUTHORIZATION_FAILURE');
    expect(denied.outcome.executed).toBe(false);
    expect(denied.destinationSize).toBe(0); // POST-STATE unchanged

    // mutation-proof: disable the guard ⇒ effect runs (the guard detects its removal).
    const bypass = await runKernel(baseRequest(), {
      grantedActor: 'someone-else',
      guards: { actorAuthorized: false },
    });
    expect(bypass.effectRuns).toBe(1);
    expect(bypass.destinationSize).toBe(1);
  });

  it('CONTROL: DENY (tenant isolation) — cross-tenant refused; NO mutation', async () => {
    const req = baseRequest({ actor: { ...ACTOR, tenantId: 'org-other' } });
    const r = await runKernel(req, { grantedActor: ACTOR.id });
    expect(r.outcome.verdict).toBe('DENY');
    expect(r.outcome.reason).toBe('TENANT_ISOLATION_VIOLATION');
    expect(r.destinationSize).toBe(0);
  });

  it('CONTROL: HOLD (C3 approval absent) — refused where C3 applies; NO mutation', async () => {
    const req = baseRequest({ consequence: 'C3' }); // no approval attached
    const r = await runKernel(req);
    expect(r.outcome.verdict).toBe('HOLD');
    expect(r.outcome.reason).toBe('APPROVAL_REQUIRED');
    expect(r.outcome.executed).toBe(false);
    expect(r.destinationSize).toBe(0);
  });

  it('CONTROL: DENY (approval scope mismatch) — approval for another resource refused; NO mutation', async () => {
    const req = baseRequest({
      consequence: 'C3',
      approval: highRiskApproval({ scope: { tenantId: TENANT, resourceType: 'dataplane-import', resourceId: 'OTHER-PLAN' } }),
    });
    const r = await runKernel(req);
    expect(r.outcome.verdict).toBe('DENY');
    expect(r.outcome.reason).toBe('APPROVAL_SCOPE_VIOLATION');
    expect(r.destinationSize).toBe(0);
  });

  it('CONTROL: HOLD (expired approval) — valid-at-execution enforced; NO mutation', async () => {
    const req = baseRequest({
      consequence: 'C3',
      approval: highRiskApproval({ issuedAt: 0, expiresAt: 1 }), // long expired vs SystemTime.now()
    });
    const r = await runKernel(req);
    expect(r.outcome.verdict).toBe('HOLD');
    expect(r.outcome.reason).toBe('APPROVAL_EXPIRED');
    expect(r.destinationSize).toBe(0);
  });

  it('CONTROL: duplicate / replay — second attempt creates NO second effect', async () => {
    const idempotency = new IdempotencyStore();
    const resources = new ResourceStore();
    resources.put(TARGET, { allWrittenRecordsPresent: true });

    const first = await runKernel(baseRequest(), { idempotency, resources });
    expect(first.outcome.executed).toBe(true);
    expect(first.effectRuns).toBe(1);
    expect(first.destinationSize).toBe(1);

    // replay with the SAME idempotency key/store — effect must NOT run again.
    const second = await runKernel(baseRequest(), { idempotency, resources });
    expect(second.outcome.duplicateSuppressed).toBe(true);
    expect(second.outcome.executed).toBe(false); // the replay does not claim a second execution
    expect(second.effectRuns).toBe(0); // NO second effect
    expect(second.destinationSize).toBe(0); // its own destination untouched
  });

  it('CONTROL: stale pre-state — resource drifted since request ⇒ HOLD; NO mutation', async () => {
    const resources = new ResourceStore();
    resources.put({ ...TARGET, version: 99 }, { drifted: true }); // observed version 99 ≠ request version 1
    const r = await runKernel(baseRequest(), { resources });
    expect(r.outcome.verdict).toBe('HOLD');
    expect(r.outcome.reason).toBe('STALE_RESOURCE_VERSION');
    expect(r.outcome.executed).toBe(false);
    expect(r.destinationSize).toBe(0);
  });

  it('CONTROL: recovery is itself governed (mutation-proof of the bypass)', async () => {
    // guard OFF: recovery calls the effect DIRECTLY, ungoverned — the mutation the
    // control exists to catch.
    const bypass = await runKernel(baseRequest({ recoveryOf: transitionId('orig') }), {
      guards: { recoveryGoverned: false },
    });
    expect(bypass.outcome.reason).toBe('RECOVERY_UNGOVERNED');
    expect(bypass.effectRuns).toBe(1); // effect ran with NO claim/idempotency/verify — the bypass

    // guard ON (default): a recovery transition runs the full governed path.
    const governedRecovery = await runKernel(baseRequest({ recoveryOf: transitionId('orig') }));
    expect(governedRecovery.outcome.verdict).toBe('ALLOW');
    expect(governedRecovery.outcome.claimed).toBe(true); // it was claimed, revalidated, verified — not bypassed
    expect(governedRecovery.outcome.reason).toBe('OK');
  });

  it('CONTROL: failed execution — a non-accepted effect over an unchanged post-state is never VERIFIED', async () => {
    // effect returns accepted:false; the authoritative post-state still shows the
    // pre-state (nothing changed) ⇒ VERIFIED_FAILURE, never VERIFIED_SUCCESS.
    const resources = new ResourceStore();
    resources.put(TARGET, { allWrittenRecordsPresent: false }); // observed ≠ expected(true)
    const r = await runKernel(baseRequest(), { effectAccepts: false, resources });
    expect(r.outcome.executed).toBe(true);
    expect(r.outcome.verification).not.toBe('VERIFIED');
    expect(r.outcome.outcomeClass).toBe('VERIFIED_FAILURE');
  });

  it('CONTROL: evidence-persistence failure — the transition is NOT represented as complete', async () => {
    // An evidence store that fails to persist the VERIFICATION-stage record.
    // Execution and verification may have happened, but the transition must not
    // return a completed, verified outcome as if nothing failed.
    class FailingEvidence extends EvidenceStore {
      override append(rec: { transitionId: string; stage: string; at: number; detail: Readonly<Record<string, unknown>> }): void {
        if (rec.stage === 'VERIFICATION') throw new Error('evidence store write failed');
        super.append(rec);
      }
    }
    const resources = new ResourceStore();
    resources.put(TARGET, { importResolved: true });
    let threw = false;
    let outcome: unknown;
    try {
      const r = await runKernel(baseRequest(), { evidence: new FailingEvidence(), resources });
      outcome = r.outcome;
    } catch {
      threw = true;
    }
    // Either it rejects, or (never) returns a completed VERIFIED outcome — an
    // evidence failure must not be laundered into a success envelope.
    expect(threw).toBe(true);
    expect(outcome).toBeUndefined();
  });

  it('DISTINCTION: SEEN ≠ CLAIMED ≠ AUTHORIZED ≠ EXECUTED ≠ EFFECT_CONFIRMED ≠ VERIFIED ≠ EVIDENCED', async () => {
    const evidence = new EvidenceStore();
    const resources = new ResourceStore();
    resources.put(TARGET, { allWrittenRecordsPresent: true });
    const ok = await runKernel(baseRequest(), { evidence, resources });
    // A single success return does NOT collapse the states — each is a distinct field.
    expect(ok.outcome.claimed).toBe(true); // CLAIMED
    expect(ok.outcome.executed).toBe(true); // EXECUTED
    expect(ok.outcome.verification).toBe('VERIFIED'); // VERIFIED (separate from executed)
    expect(evidence.forTransition('dp-import:plan-x').length).toBeGreaterThan(0); // EVIDENCED (separate record)

    // And a HOLD keeps them independently observable: claimed may be false, executed false.
    const held = await runKernel(baseRequest({ consequence: 'C3' })); // approval absent → HOLD
    expect(held.outcome.executed).toBe(false); // not EXECUTED
    expect(held.outcome.verification).toBe('NOT_APPLICABLE'); // not VERIFIED
    expect(held.destinationSize).toBe(0); // no EFFECT_CONFIRMED
  });
});
