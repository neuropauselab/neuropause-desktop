/**
 * SEAM-22 / GATE-BUILD-1 · SLICE 1 — the INDEPENDENT READ-BACK surface (P0 §20–§21).
 *
 * Answers, from PERSISTED EVIDENCE ONLY: "what happened to this governed action?"
 * — reconstructing request → verdict → execution → observation → verification and
 * deriving one epistemically honest FINAL_STATUS per evidence row.
 *
 * ── INDEPENDENCE (§21) ────────────────────────────────────────────────────────
 * This module never reads the return value of any execute() call. It reads the
 * durable ActionRecord store — the same single source `m365WriteStates` derives
 * from — so it can CATCH A FALSE SUCCESS: a row whose outcome claims provider
 * acknowledgement but whose independent verification recorded a failure terminal
 * reports VERIFIED_FAILURE, and a success-looking string anywhere outside the
 * verification object is never trusted (classification goes ONLY through the
 * D-16 authority, deny-by-default).
 *
 * ── ALIGNMENT (one source of truth, build-directive §56) ──────────────────────
 * The five state rungs use the IDENTICAL predicates as `deriveWriteStates`
 * (verdict === 'ALLOW' · executed === true · outcome === 'ACKNOWLEDGED' ·
 * `isSuccessTerminal`), so this command and the M365 write panel can never
 * disagree about the same row. Route A governance rows (outcome NOT_STARTED)
 * are NOT write attempts: they report REFUSED / GATE_NOT_EVALUATED and carry no
 * funnel rungs, exactly as the counter excludes them.
 *
 * ── HONESTY ABOUT WHAT THE STORE CANNOT ANSWER ───────────────────────────────
 * §20 names fields the evidence store does not persist (relationship, purpose,
 * policyVersion, the approval object, the claim/fencing token). They are listed
 * in `NOT_PERSISTED`, structurally — this surface states absence; it never
 * infers, fabricates, or back-fills (§2 #17/#19; NP-015's "a time we were not
 * told is ABSENT").
 *
 * NOTE (F-P45, carried): `tenantId` on evidence rows HOLDS A WORKSPACE ID — the
 * writer's recorded deviation. Callers pass the workspace-scope key, exactly as
 * `readBackReconcilerInstance.ts` does with `perWorkspace: true`. The migration
 * that ends that accommodation is its own gated slice, not this one.
 */
import type { ActionRecord, ActionRecordVerification } from '../connectors/actionRecord';
import { actionRecord, EXECUTION_NOT_STARTED } from '../connectors/actionRecord';
import { classifyTerminal, isSuccessTerminal } from '../verification/verificationTerminals';

/** How the caller names the action being asked about. At least one field required. */
export interface ReadBackRef {
  readonly requestId?: string;
  readonly transitionId?: string;
  /** FG-14 causal-episode identity (`asst_<uuid>`), matched verbatim. */
  readonly correlationId?: string;
}

/**
 * One epistemic rung per row — never collapsed (§20: REQUESTED ≠ AUTHORIZED ≠
 * EXECUTED ≠ OBSERVED ≠ VERIFIED; §57: UNKNOWN is never converted to failure or
 * success without evidence).
 */
export type ReadBackFinalStatus =
  | 'REFUSED' // governance DENY — execution NOT_STARTED (§2 #19: never execution_failed)
  | 'GATE_NOT_EVALUATED' // a recorded gate SKIP — the absence of a decision, made visible
  | 'REQUESTED'
  | 'DENIED' // execution-path kernel DENY
  | 'AUTHORIZED'
  | 'EXECUTED'
  | 'PROVIDER_ACKNOWLEDGED' // submission, not verification (§2 #14)
  | 'UNKNOWN' // HOLD/UNKNOWN outcome, or verification attempted and unresolved
  | 'VERIFIED_FAILURE'
  | 'VERIFIED_SUCCESS';

/** The funnel rungs, predicate-identical to `deriveWriteStates`. All false for governance rows. */
export interface ReadBackStates {
  readonly requested: boolean;
  readonly authorized: boolean;
  readonly executed: boolean;
  readonly providerAcknowledged: boolean;
  readonly externallyObserved: boolean;
}

/** §14 temporal fields, verbatim from the row — null/absent preserved, never inferred. */
export interface ReadBackTimeline {
  readonly requestTime: string | null;
  readonly eventTime: string | null;
  readonly recordTime: string;
  readonly verificationTime: string | null;
  readonly effectTime: string | null;
}

export interface ReadBackRow {
  readonly finalStatus: ReadBackFinalStatus;
  readonly states: ReadBackStates;
  readonly requestId: string;
  readonly transitionId: string;
  readonly correlationId: string | null;
  readonly actionId: string;
  readonly connectorId: string;
  readonly accountId: string;
  readonly actor: string;
  /** F-P45: holds a WORKSPACE id (the writer's recorded deviation). */
  readonly tenantId: string;
  readonly recipients: ActionRecord['recipients'];
  readonly subjectFingerprint: string;
  readonly bodyFingerprint: string;
  readonly verdict: string;
  readonly executed: boolean;
  readonly outcome: string;
  readonly admissionRef: string;
  readonly verification: ActionRecordVerification | null;
  readonly timeline: ReadBackTimeline;
  /** The failure terminal's name when verification classified as failure; else null. */
  readonly deviation: string | null;
}

export interface ReadBackReport {
  readonly ref: ReadBackRef;
  readonly matches: number;
  /** Newest first by record_time. */
  readonly rows: readonly ReadBackRow[];
  /** §20 fields this evidence store cannot answer — stated, never inferred. */
  readonly notPersisted: readonly string[];
}

/**
 * What the ActionRecord store structurally does not carry. Kept as ONE exported
 * constant so a future store extension flips the surface in one place — and so
 * a test can pin that the surface never claims these.
 */
export const NOT_PERSISTED = Object.freeze([
  'relationship',
  'purpose',
  'policyVersion',
  'approval (object; only the verdict it produced is recorded)',
  'claim/fencingToken',
] as const);

function finalStatusOf(r: ActionRecord): ReadBackFinalStatus {
  if (r.outcome === EXECUTION_NOT_STARTED) {
    // Route A — a decision that produced no execution. A SKIP is not a refusal.
    return r.verdict === 'DENY' ? 'REFUSED' : 'GATE_NOT_EVALUATED';
  }
  if (r.verification != null) {
    const c = classifyTerminal(r.verification.terminal);
    if (c === 'success') return 'VERIFIED_SUCCESS';
    if (c === 'failure') return 'VERIFIED_FAILURE';
    // Verification was attempted and is unresolved — epistemically UNKNOWN,
    // regardless of how confident the acknowledgement looked (§2 #9).
    return 'UNKNOWN';
  }
  if (r.outcome === 'UNKNOWN' || r.outcome === 'HOLD') return 'UNKNOWN';
  if (r.outcome === 'ACKNOWLEDGED') return 'PROVIDER_ACKNOWLEDGED';
  if (r.executed === true) return 'EXECUTED';
  if (r.verdict === 'ALLOW') return 'AUTHORIZED';
  if (r.verdict === 'DENY') return 'DENIED';
  return 'REQUESTED';
}

function statesOf(r: ActionRecord): ReadBackStates {
  if (r.outcome === EXECUTION_NOT_STARTED) {
    // Governance rows are not write attempts (Route A) — no funnel rungs.
    return { requested: false, authorized: false, executed: false, providerAcknowledged: false, externallyObserved: false };
  }
  return {
    requested: true,
    authorized: r.verdict === 'ALLOW',
    executed: r.executed === true,
    providerAcknowledged: r.outcome === 'ACKNOWLEDGED',
    externallyObserved: isSuccessTerminal(r.verification?.terminal),
  };
}

function rowOf(r: ActionRecord): ReadBackRow {
  const verification = r.verification ?? null;
  const deviation =
    verification != null && classifyTerminal(verification.terminal) === 'failure' ? verification.terminal : null;
  return {
    finalStatus: finalStatusOf(r),
    states: statesOf(r),
    requestId: r.requestId,
    transitionId: r.transitionId,
    correlationId: typeof r.correlationId === 'string' && r.correlationId.length > 0 ? r.correlationId : null,
    actionId: r.actionId,
    connectorId: r.connectorId,
    accountId: r.accountId,
    actor: r.actor,
    tenantId: r.tenantId,
    recipients: r.recipients,
    subjectFingerprint: r.subjectFingerprint,
    bodyFingerprint: r.bodyFingerprint,
    verdict: r.verdict,
    executed: r.executed,
    outcome: r.outcome,
    admissionRef: r.admissionRef,
    verification,
    timeline: {
      requestTime: r.requestTime ?? null,
      eventTime: r.eventTime ?? null,
      recordTime: r.at,
      verificationTime: verification?.at ?? null,
      effectTime: verification?.effectTime ?? null,
    },
    deviation,
  };
}

/**
 * PURE reconstruction over given rows (Electron-free, store-free) — the testable
 * core, usable by any future CLI/IPC surface without a second derivation.
 */
export function reconstructReadBack(records: readonly ActionRecord[], ref: ReadBackRef): ReadBackReport {
  const matched = records.filter(
    (r) =>
      (ref.requestId === undefined || r.requestId === ref.requestId) &&
      (ref.transitionId === undefined || r.transitionId === ref.transitionId) &&
      (ref.correlationId === undefined || r.correlationId === ref.correlationId),
  );
  const rows = matched.map(rowOf).sort((a, b) => (a.timeline.recordTime < b.timeline.recordTime ? 1 : -1));
  return { ref, matches: rows.length, rows, notPersisted: NOT_PERSISTED };
}

/**
 * The in-process surface: read the DURABLE store (tenant-scoped — no cross-tenant
 * read; the store itself filters) and reconstruct. `scopeTenantId` is the
 * evidence-row key: per F-P45 that is the WORKSPACE id today.
 *
 * At least one ref field is required — an empty ref would mean "everything",
 * which is a listing, not a read-back, and is refused (deny-by-default).
 */
export async function readBack(scopeTenantId: string, ref: ReadBackRef): Promise<ReadBackReport> {
  if (ref.requestId === undefined && ref.transitionId === undefined && ref.correlationId === undefined) {
    return { ref, matches: 0, rows: [], notPersisted: NOT_PERSISTED };
  }
  // Push the supported filters down to the store; correlationId is matched here
  // (the store's query has no correlationId filter — evidence stays untouched).
  const records = await actionRecord.query({
    tenantId: scopeTenantId,
    ...(ref.requestId !== undefined ? { requestId: ref.requestId } : {}),
    ...(ref.transitionId !== undefined ? { transitionId: ref.transitionId } : {}),
  });
  return reconstructReadBack(records, ref);
}
