/**
 * SEAM-B.8 / GATE-R.2 — the governed transition for JOURNAL DRAFT → POSTED.
 *
 * The FIRST domain-store consequential transition to cross the sanctioned CST
 * boundary. This module mirrors the sanctioned adapter pattern of frozen
 * `cst/importTransition.ts` VERBATIM in shape (per-call kernel + single-actor
 * policy projection + declared postcondition + honest {known:false} reconcile),
 * and is deliberately NON-frozen: it is domain integration, not a kernel change.
 * The frozen kernel is consumed, never modified; the effect is the journal
 * module's own write, preserved and passed in as a closure.
 *
 * ── WHAT THE KERNEL GOVERNS HERE ─────────────────────────────────────────────
 *   actor (fail-closed: a null session actor mints no approval, and C3 without
 *   approval HOLDs APPROVAL_REQUIRED — kernel.ts:189-196) · policy grant ·
 *   approval binding/scope/expiry · atomic claim on the transition · idempotent
 *   replay (same entry at the same revision = one logical post) · declared
 *   postcondition verified against an AUTHORITATIVE re-read of the store.
 *
 * ── WHAT THE DOMAIN SUPPLIES ─────────────────────────────────────────────────
 *   The CAS: `effect` must perform the fresh-read + revision-check + write in
 *   ONE synchronous (await-free) section — atomic on the main-process event
 *   loop, which is this substrate's real concurrency model (JSON-under-userData
 *   provides no multi-process CAS; the single-instance lock is the process
 *   guarantee; stated, not pretended away).
 *
 * ── CONSEQUENCE / REVERSIBILITY (precedent-calibrated) ──────────────────────
 *   C3: a posting is financially consequential and immutable once made
 *   (import's high-risk branch is the precedent for a C3 local-store write).
 *   DIFFICULT_TO_REVERSE: correction is a NEW mirrored reversing entry —
 *   compensable, never undoable (the `contacts.update` precedent; neither
 *   REVERSIBLE nor IRREVERSIBLE would be honest).
 *
 * ── VERIFICATION IS NOT "THE FUNCTION RETURNED" ─────────────────────────────
 *   expectedPostState = { postedByThisTransition: true }, declared BEFORE the
 *   effect runs (NP-CST-35). `observe` re-reads the authoritative store and the
 *   proposition requires ALL of: this transition's write won the CAS, the row
 *   reads posted, and rev === expectedRev + 1 (revision divergence in either
 *   direction fails verification — §30 of the gate). A lost CAS is
 *   STALE_RESOURCE, never VERIFIED_SUCCESS and never a silent overwrite.
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
import type { IdempotencyStorePort } from '@neuropause/cst/dist/src/stores.js';
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

/** How long a journal-post approval is valid after issue (adapter convention). */
const APPROVAL_TTL_MS = 15 * 60_000;
const RESOURCE_TYPE = 'finance-journal-entry';
const ACTION = 'finance.journal.post';

/**
 * The policy contract label recorded on every journal-post transition.
 * NP-020 standing law: this is a CONTRACT LABEL for evidence, never authority —
 * the kernel's verdict derives from the grant map and approval, not this string.
 */
export const JOURNAL_POST_POLICY_VERSION = 'finance-journal-post-policy-1';

/** Per-process attempt counter — same-millisecond attempts still mint distinct transition ids. */
let attemptSeq = 0;

/** What the domain effect reports back — `wrote` only when ITS write won the CAS. */
export interface JournalPostEffectResult {
  readonly accepted: boolean;
  /** True only when this invocation's conditional write won (rev matched, row written). */
  readonly wrote: boolean;
  /** True when the conditional write LOST (row changed since expectedRev). */
  readonly stale: boolean;
}

/** The authoritative post-state, re-read from the store by the caller. */
export interface JournalObservedState {
  readonly posted: boolean;
  readonly rev: number;
}

export type JournalPostSemanticOutcome =
  | 'VERIFIED_SUCCESS'
  | 'STALE_RESOURCE'
  | 'VERIFIED_FAILURE'
  | 'DEVIATION'
  | 'UNKNOWN'
  | 'HOLD'
  | 'DENY'
  | 'ESCALATE';

export interface GovernedJournalPostArgs {
  readonly entryId: string;
  readonly entryNumber: string;
  /** The row's own org tenant id (kernel scope). Empty string fails closed. */
  readonly tenantId: string;
  /** `ctx.actor()` verbatim — session email or `local-<id>@device.invalid`; null → ''. */
  readonly actorId: string;
  /** The durable EnterpriseEntity `rev` read fresh at governance start. */
  readonly expectedRev: number;
  readonly policyVersion: string;
  /**
   * THE PRESERVED EFFECT — must perform fresh-read + rev/status check + write in
   * one synchronous section (no await between check and write).
   */
  readonly effect: () => Promise<JournalPostEffectResult>;
  /** Authoritative re-read of the row (store truth, never the effect's return). */
  readonly observe: () => JournalObservedState | null;
  /** Module-lifetime ports (claims + idempotency). Defaults are in-memory. */
  readonly ports?: JournalPostPorts;
}

export interface JournalPostPorts {
  readonly claims: ClaimStore;
  readonly idempotency: IdempotencyStorePort;
}

/**
 * Build the module-lifetime ports. Inject a durable `IdempotencyStorePort`
 * (e.g. a `DurableIdempotencyStore` over `journal-post-transitions.json`) from
 * the Electron instance layer; tests and Electron-free callers get in-memory
 * semantics with identical behavior within one process lifetime.
 */
export function createJournalPostPorts(idempotency: IdempotencyStorePort = new IdempotencyStore()): JournalPostPorts {
  return { claims: new ClaimStore(), idempotency };
}

export interface GovernedJournalPostResult {
  /** The full CST envelope — the transition's evidence of record. */
  readonly outcome: TransitionOutcome;
  readonly semanticOutcome: JournalPostSemanticOutcome;
  readonly transitionId: string;
  readonly requestId: string;
}

/** Run a journal DRAFT → POSTED as a governed Consequential State Transition. */
export async function governedJournalPost(args: GovernedJournalPostArgs): Promise<GovernedJournalPostResult> {
  const { entryId, entryNumber, tenantId, actorId, expectedRev, policyVersion } = args;
  const ports = args.ports ?? createJournalPostPorts();

  const actor: Actor = { id: actorId, type: 'HUMAN', tenantId };
  const target = { tenantId, resourceType: RESOURCE_TYPE, resourceId: entryId, version: expectedRev };
  const consequence: Consequence = 'C3';

  // NP-CST-35 — declared before anything runs; never derived from the result.
  const expectedPostState = { postedByThisTransition: true };

  // Same entry at the same durable revision = the same logical post. A replay
  // after success reports the original outcome; after an interrupted attempt it
  // HOLDs for reconciliation (the {known:false} oracle below).
  const idem = brandIdempotencyKey(
    createHash('sha256').update(`${tenantId}|${entryId}|${expectedRev}`).digest('hex'),
  );

  const time = new SystemTime();
  // SEAM-B.9 (measured on persisted evidence): the transition id must be unique
  // PER ATTEMPT, not per logical post — a refused attempt does not advance the
  // row's revision, so a retry at the same rev would otherwise reuse the id and
  // the evidence store's terminal attachment (first match on tenant+transition)
  // would pin the retry's terminal onto the REFUSAL's row. The idempotency key
  // above — not this id — carries the logical-post identity, so replay
  // semantics are unchanged; a DONE-replay returns the ORIGINAL outcome whose
  // envelope carries the original attempt's id.
  const transitionId = brandTransitionId(
    `journal-post:${entryId}:${expectedRev}:${time.now()}-${(attemptSeq += 1)}`,
  );
  const purpose = `Post journal entry ${entryNumber} to the general ledger`;

  // The explicit post request by an authenticated, RBAC-passed actor IS the C3
  // approval act (the sendTransition `confirmed`-flag precedent) — on the GL
  // auto-post path the same ctx carries the ORIGINATING mutation's actor, so
  // approval provenance is that originating authorized act, recorded verbatim.
  // No actor ⇒ no approval ⇒ the kernel HOLDs APPROVAL_REQUIRED (fail-closed).
  const approval: Approval | undefined =
    actorId !== ''
      ? {
          approvalId: brandApprovalId(`appr:${idem}`),
          transitionId,
          approver: actor,
          action: ACTION,
          scope: { tenantId, resourceType: RESOURCE_TYPE, resourceId: entryId },
          resourceVersion: target.version,
          purpose,
          policyVersion,
          issuedAt: time.now(),
          expiresAt: time.now() + APPROVAL_TTL_MS,
          consumed: false,
        }
      : undefined;

  const request: TransitionRequest = {
    transitionId,
    requestId: brandRequestId(`req:${idem}:${time.now()}`),
    actor,
    action: ACTION,
    target,
    purpose,
    intent: `post balanced journal entry ${entryNumber} (draft rev ${expectedRev})`,
    // relationships intentionally OMITTED (the importTransition precedent):
    // the journal declares no relationship dependency, so the assessment
    // reports NOT_APPLICABLE — never silently "assessed".
    expectedPostState,
    consequence,
    reversibility: 'DIFFICULT_TO_REVERSE',
    policyVersion,
    idempotencyKey: idem,
    evidence: [],
    ...(approval ? { approval } : {}),
  };

  // ONE authority source: the grant reflects the authorization the module door
  // already enforced (ctx.authorize(write) / the originating mutation's RBAC).
  // The kernel is the single governance VERDICT; an empty actor gets an empty
  // grant set and is DENIED by policy.
  const policy = new PolicyStore(
    new Map([[actorId, actorId !== '' ? new Set([ACTION]) : new Set<string>()]]),
    policyVersion,
  );
  const evidence = new EvidenceStore();
  const resources = new ResourceStore();
  resources.put(target, { phase: 'pre' });

  // No external oracle for a local store: an interrupted replay HOLDs for
  // reconciliation rather than asserting an effect we cannot confirm.
  const reconcile = async (): Promise<{ known: false }> => ({ known: false });

  let effectReport: JournalPostEffectResult | undefined;

  const kernel = new CstKernel({
    time,
    policy,
    claims: ports.claims,
    idempotency: ports.idempotency,
    resources,
    evidence,
    reconcile,
  });

  const effect = async (): Promise<{ accepted: boolean }> => {
    // THE PRESERVED EFFECT — the caller's synchronous CAS + write.
    effectReport = await args.effect();
    // Observe authoritatively, then hand the kernel the store's answer. The
    // proposition is about THIS transition: a lost CAS never verifies, even
    // though the world may (correctly) read posted via the winner.
    const observed = args.observe();
    resources.put(
      target,
      observed === null
        ? UNOBSERVABLE
        : {
            postedByThisTransition:
              effectReport.wrote === true && observed.posted === true && observed.rev === expectedRev + 1,
          },
    );
    return { accepted: effectReport.accepted };
  };

  const outcome = await kernel.run(request, effect);
  return {
    outcome,
    semanticOutcome: classifyJournalPost(outcome, effectReport),
    // The ENVELOPE's id, not this call's mint: on a DONE-replay the kernel
    // returns the ORIGINAL outcome, and evidence (observed under the envelope
    // id) must be addressed by that same id — never a fresh one (SEAM-B.9).
    transitionId: String(outcome.transitionId),
    requestId: String(request.requestId),
  };
}

/**
 * Refine the kernel's outcome into the domain vocabulary WITHOUT overriding it
 * (the importTransition refinement pattern). The only refinement: an executed
 * effect that LOST the revision CAS is STALE_RESOURCE — governance allowed the
 * attempt, the domain's optimistic-concurrency boundary refused the write, and
 * the kernel's verification correctly reads not-verified.
 */
function classifyJournalPost(
  outcome: TransitionOutcome,
  effect: JournalPostEffectResult | undefined,
): JournalPostSemanticOutcome {
  if (!outcome.executed) {
    return outcome.verdict === 'ALLOW' ? 'UNKNOWN' : outcome.verdict;
  }
  if (effect?.stale === true) return 'STALE_RESOURCE';
  switch (outcome.outcomeClass) {
    case 'VERIFIED_SUCCESS':
      return 'VERIFIED_SUCCESS';
    case 'VERIFIED_FAILURE':
      return 'VERIFIED_FAILURE';
    case 'DEVIATION':
      return 'DEVIATION';
    default:
      return 'UNKNOWN'; // UNKNOWN or NOT_ATTEMPTED
  }
}
