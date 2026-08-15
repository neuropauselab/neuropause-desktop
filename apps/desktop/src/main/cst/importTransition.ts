/**
 * P13C — the ONE CST boundary for the Data IMPORT consequential action.
 *
 * Frozen `@neuropause/cst 1.3.0` is the authoritative kernel. This module is the
 * single adapter between the Desktop's existing `applyImportPlan` effect and
 * `CstKernel.run(request, effect)`. The effect is PRESERVED; the kernel governs
 * the transition around it. There is exactly one governance verdict — the
 * kernel's — and the existing secure-IPC permission chain is admission control
 * in front of it, never a second, disagreeing verdict.
 *
 * We import the specific submodules (not the package barrel): the barrel pulls in
 * `durable.js` → `node:sqlite` (Node ≥22), and `package.json main` points at a
 * non-existent `dist/index.js`. Both are recorded as frozen-package defects in
 * `certification/source-update/CST-1.3.0-DEFECTS-FOUND.md` — NOT edited. Using
 * the submodules is consumption, not modification, and keeps us on the in-memory
 * stores (a declared, single-process durability gap, mirroring source O-6).
 */
import { createHash } from 'node:crypto';
import { CstKernel } from '@neuropause/cst/dist/src/kernel.js';
import {
  ClaimStore,
  EvidenceStore,
  IdempotencyStore,
  PolicyStore,
  ResourceStore,
  SystemTime,
} from '@neuropause/cst/dist/src/stores.js';
import {
  approvalId as brandApprovalId,
  idempotencyKey as brandIdempotencyKey,
  requestId as brandRequestId,
  transitionId as brandTransitionId,
  UNOBSERVABLE,
  type Actor,
  type Approval,
  type Consequence,
  type TransitionOutcome,
  type TransitionRequest,
} from '@neuropause/cst/dist/src/types.js';
import {
  applyImportPlan,
  type ImportDecision,
  type ImportDeps,
  type ImportResult,
  type ProvenanceRecord,
} from '../dataPlane/importer';
import type { ImportPlan } from '../dataPlane/planner';

/** How long a data-import approval is valid after issue. */
const APPROVAL_TTL_MS = 15 * 60_000;
const RESOURCE_TYPE = 'dataplane-import';

export interface GovernedImportArgs {
  readonly plan: ImportPlan;
  readonly decisions: readonly ImportDecision[];
  readonly tenantId: string;
  readonly actorId: string;
  readonly policyVersion: string;
  /** The exact deps the handler builds for `applyImportPlan` — the effect is unchanged. */
  readonly importDeps: ImportDeps;
}

/**
 * The domain-level outcome for an import transition. The kernel's own
 * `outcomeClass` is a narrow enum (VERIFIED_SUCCESS / VERIFIED_FAILURE /
 * DEVIATION / UNKNOWN / NOT_ATTEMPTED); this refines it WITHOUT touching the
 * kernel, so the four cases the F-1 review requires stay distinct:
 *   • VERIFIED_SUCCESS — authorized, ≥1 record actually written and confirmed
 *   • VERIFIED_NOOP    — authorized, legitimately nothing to change (0 writes,
 *                        0 failures) — NOT a failure and NOT a success
 *   • VERIFIED_FAILURE — the import reported failure and the post-state confirms it
 *   • DEVIATION        — a reported write is not authoritatively present
 *   • UNKNOWN          — the authoritative source could not answer
 *   • HOLD / DENY      — governance refused; the effect never ran
 */
export type ImportSemanticOutcome =
  | 'VERIFIED_SUCCESS'
  | 'VERIFIED_NOOP'
  | 'VERIFIED_FAILURE'
  | 'DEVIATION'
  | 'UNKNOWN'
  | 'HOLD'
  | 'DENY'
  | 'ESCALATE';

export interface GovernedImportResult {
  /** The full CST envelope — the transition's evidence of record. */
  readonly outcome: TransitionOutcome;
  /** The refined domain outcome (adds VERIFIED_NOOP; see the type). */
  readonly semanticOutcome: ImportSemanticOutcome;
  /** Present ONLY when the kernel authorized and the effect executed. */
  readonly result?: ImportResult;
  readonly provenance?: ProvenanceRecord[];
}

/**
 * Authoritative post-state observation — NP-CST-39 / NP-NC-10. A verdict ABOUT
 * the destination store, never the effect's own counters. NON-VACUOUS (F-1):
 * `{ importResolved: true }` requires BOTH that every reported write reads back
 * present AND that the run did not report failure — so a `failed` run cannot
 * pass verification merely because it wrote nothing (empty-set vacuity).
 *   • a reported write is not present     → { importResolved: false } → DEVIATION/FAILURE
 *   • the run reported failure            → { importResolved: false } → DEVIATION/FAILURE
 *   • the store cannot answer             → UNOBSERVABLE → UNKNOWN (never DEVIATION)
 *   • all reported writes present, not failed → { importResolved: true } → VERIFIED
 *     (the adapter then splits SUCCESS vs NOOP by whether any record was written)
 */
function observeImportState(
  result: ImportResult,
  provenance: readonly ProvenanceRecord[],
  deps: ImportDeps,
): unknown {
  if (deps.readBack === undefined) return UNOBSERVABLE;
  for (const rec of provenance) {
    let present: boolean;
    try {
      present = deps.readBack(rec.moduleId, rec.recordId);
    } catch {
      return UNOBSERVABLE; // an unreadable authoritative source is UNKNOWN, not proof of anything
    }
    if (present !== true) return { importResolved: false };
  }
  if (result.status === 'failed') return { importResolved: false };
  return { importResolved: true };
}

/**
 * Run a data import as a governed Consequential State Transition.
 *
 * Consequence is C3 (approval-bound) ONLY when an approved table is high-risk —
 * exactly where the Desktop already requires the distinct `data:approve` right,
 * so the CST Approval represents a real, separate authorization rather than a
 * rubber stamp. A purely low-risk import is C1 and carries no approval.
 */
export async function governedImport(args: GovernedImportArgs): Promise<GovernedImportResult> {
  const { plan, decisions, tenantId, actorId, policyVersion, importDeps } = args;

  const actor: Actor = { id: actorId, type: 'HUMAN', tenantId };
  const target = {
    tenantId,
    resourceType: RESOURCE_TYPE,
    resourceId: plan.planId,
    version: 1,
  };

  // F-1 INVARIANT: consequence is determined by the REQUESTED transition's
  // declared risk (does the submitted plan involve a high-risk table?), NOT by
  // whether authorization has already been granted. So an UNAPPROVED high-risk
  // import is C3 and HOLDs for approval — it can never downgrade to C1 and pass
  // as a vacuous no-op.
  const highRiskTables = plan.tables.filter((t) => t.requiresApproval === true);
  const hasHighRisk = highRiskTables.length > 0;
  const allHighRiskApproved =
    hasHighRisk &&
    highRiskTables.every(
      (t) => decisions.find((d) => d.tableName === t.tableName)?.approved === true,
    );
  const consequence: Consequence = hasHighRisk ? 'C3' : 'C1';

  // NP-CST-35 — the postcondition is DECLARED here, before anything runs, and is
  // never derived from the result. NON-VACUOUS (F-1): a run that reports failure,
  // or whose reported writes are not authoritatively present, does not resolve.
  const expectedPostState = { importResolved: true };

  const idem = brandIdempotencyKey(
    createHash('sha256')
      .update(`${tenantId}|${plan.planId}|${JSON.stringify(decisions)}`)
      .digest('hex'),
  );

  const time = new SystemTime();
  const purpose = `Import approved tables from ${plan.sourceFile}`;

  // Approval is supplied ONLY when every high-risk table is actually approved
  // (the reviewer holds `data:approve` and approved it). A high-risk table left
  // unapproved therefore reaches the kernel as C3 WITHOUT an approval → HOLD.
  const approval: Approval | undefined = allHighRiskApproved
    ? {
        approvalId: brandApprovalId(`appr:${plan.planId}`),
        transitionId: brandTransitionId(`dp-import:${plan.planId}`),
        approver: actor, // the same session actor who holds `data:approve` and approved the tables
        action: 'data.import',
        scope: { tenantId, resourceType: RESOURCE_TYPE, resourceId: plan.planId },
        resourceVersion: target.version,
        purpose,
        policyVersion,
        issuedAt: time.now(),
        expiresAt: time.now() + APPROVAL_TTL_MS,
        consumed: false,
      }
    : undefined;

  const request: TransitionRequest = {
    transitionId: brandTransitionId(`dp-import:${plan.planId}`),
    requestId: brandRequestId(`req:${plan.planId}:${time.now()}`),
    actor,
    action: 'data.import',
    target,
    purpose,
    intent: 'bulk data import of reviewer-approved tables',
    // relationships intentionally OMITTED: import declares no relationship
    // dependency (policy below does not list it), so the assessment reports
    // NOT_APPLICABLE — not ASSESSED_NONE_FOUND, and never silently "assessed".
    expectedPostState,
    consequence,
    reversibility: 'REVERSIBLE',
    policyVersion,
    idempotencyKey: idem,
    evidence: [],
    ...(approval ? { approval } : {}),
  };

  // ---- Ports. One authority source: the policy grant reflects the same
  // authorization the secure-IPC layer already enforced (the actor reached this
  // code only by passing `data:import` + the destination WRITE scope). The kernel
  // is the single governance VERDICT; it does not invent a second authority.
  const policy = new PolicyStore(
    new Map([[actorId, new Set(['data.import'])]]),
    policyVersion,
    // no SoD declared for import (matches current Desktop behaviour — the same
    // person may hold data:import and data:approve); no relationship actions.
  );
  const claims = new ClaimStore();
  const idempotency = new IdempotencyStore();
  const evidence = new EvidenceStore();

  // Authoritative-observation store. Pre-state carries the target version so
  // revalidation passes when nothing drifted; the effect writes the observed
  // post-state (read back from the destination) so verification compares the
  // authoritative store, not the effect's return.
  const resources = new ResourceStore();
  resources.put(target, { phase: 'pre' });

  // No external reconciliation oracle for a LOCAL import: honest {known:false}.
  // An interrupted (IN_FLIGHT) replay therefore HOLDs for reconciliation rather
  // than asserting an effect we cannot confirm.
  const reconcile = async (): Promise<{ known: false }> => ({ known: false });

  let captured: { result: ImportResult; provenance: ProvenanceRecord[] } | undefined;

  const kernel = new CstKernel({ time, policy, claims, idempotency, resources, evidence, reconcile });

  const effect = async (): Promise<{ accepted: boolean }> => {
    // THE PRESERVED EFFECT — the only place the real side effect lives.
    const { result, provenance } = await applyImportPlan(plan, decisions, importDeps);
    captured = { result, provenance };
    // Observe authoritatively, then hand the kernel the store's answer.
    resources.put(target, observeImportState(result, provenance, importDeps));
    // Transport-level acceptance only (NOT a verification verdict).
    return { accepted: result.status !== 'failed' };
  };

  const outcome = await kernel.run(request, effect);
  return {
    outcome,
    semanticOutcome: classifyImport(outcome, captured?.result),
    ...(captured ? { result: captured.result, provenance: captured.provenance } : {}),
  };
}

/**
 * Refine the kernel's outcome into the domain vocabulary WITHOUT overriding it.
 * The only refinement is splitting the kernel's VERIFIED_SUCCESS into a real
 * mutation (≥1 record written) vs a legitimate authorized no-op (0 written, 0
 * failed). Everything else is taken verbatim from the kernel — a HOLD/DENY is a
 * refusal, a DEVIATION is a deviation, an UNKNOWN is an unknown.
 */
function classifyImport(outcome: TransitionOutcome, result: ImportResult | undefined): ImportSemanticOutcome {
  if (!outcome.executed) {
    // Governance refused (or nothing was attempted): report the verdict itself.
    return outcome.verdict === 'ALLOW' ? 'UNKNOWN' : outcome.verdict;
  }
  switch (outcome.outcomeClass) {
    case 'VERIFIED_SUCCESS': {
      const wrote = result ? result.totals.imported + result.totals.updated : 0;
      return wrote > 0 ? 'VERIFIED_SUCCESS' : 'VERIFIED_NOOP';
    }
    case 'VERIFIED_FAILURE':
      return 'VERIFIED_FAILURE';
    case 'DEVIATION':
      return 'DEVIATION';
    default:
      return 'UNKNOWN'; // UNKNOWN or NOT_ATTEMPTED
  }
}
