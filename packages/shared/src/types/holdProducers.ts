/**
 * The nine HOLD shapes, one factory each.
 *
 * `dangerous_delete` and `approval_required` were built first and proved the
 * pattern; these are the remaining seven. Every one is a pure function from
 * REAL facts to a `HoldView`, which matters for three reasons:
 *
 *  1. **The five questions get answered the same way every time.** A hold that
 *     says "something went wrong" is an error toast wearing a costume. The
 *     value of the state is entirely in what it can tell you, so the shape is
 *     enforced by the type rather than left to whoever writes the call site.
 *  2. **No fabrication.** Each factory takes the evidence it needs as an
 *     argument. There is no branch that invents a count, a name, or a cause —
 *     if the caller does not know, the hold says it does not know.
 *  3. **`ifProceeding` is deliberately empty for most of them.** A hold is a
 *     control state, not a confirmation dialog. Only `dangerous_delete` offers
 *     a way through, because only there is the consequence bounded, reversible
 *     and the actor's to accept. You cannot "proceed anyway" past a missing
 *     permission — that is the entire point of a permission.
 *
 * Pure, so main and renderer produce identical text and one test covers both.
 */
import type { HoldView } from './understanding';

/* ── permission_missing ────────────────────────────────────────────────────── */

/**
 * The actor lacks the scope an operation requires.
 *
 * Today an RBAC refusal surfaces as a thrown error and disappears with the
 * toast. That is the wrong shape: the request was legitimate and understood,
 * the person simply is not permitted — and the resolution (ask someone who
 * holds the scope) belongs somewhere durable, not in a dismissed banner.
 */
export function permissionMissingHold(input: {
  /** What was attempted, in plain words. */
  action: string;
  /** The scope the operation requires, e.g. `finance:manage`. */
  permission: string;
  /** Scopes the actor actually holds. Empty is meaningful: no org membership. */
  heldPermissions: readonly string[];
  actorLabel: string;
}): HoldView {
  return {
    reason: 'insufficient_permission',
    why: `${input.actorLabel} does not hold "${input.permission}", which ${input.action} requires.`,
    known: [
      `The operation requires "${input.permission}".`,
      input.heldPermissions.length > 0
        ? `${input.actorLabel} holds ${input.heldPermissions.length} scope${input.heldPermissions.length === 1 ? '' : 's'}, none of them this one.`
        : `${input.actorLabel} is not bound to an organization member, so holds no scopes at all.`,
    ],
    unknown: ['Whether this person should hold the scope — that is an ownership decision.'],
    resolution:
      input.heldPermissions.length > 0
        ? `Have an administrator grant "${input.permission}", or ask someone who already holds it to perform the action.`
        : 'Bind this account to an organization member, then grant the scope.',
    // A permission you can click past is not a permission.
    ifProceeding: '',
  };
}

/* ── policy_conflict ───────────────────────────────────────────────────────── */

/**
 * A rule the system is not permitted to break, regardless of authority.
 *
 * Distinct from `insufficient_permission`: no amount of privilege makes it
 * correct to post into a closed accounting period. The right answer is to
 * change the world (reopen the period, pick another date), not the actor.
 */
export function policyConflictHold(input: {
  action: string;
  /** The rule, named as the system names it. */
  policy: string;
  /** Why it applies HERE — real, specific facts. */
  facts: readonly string[];
  resolution: string;
}): HoldView {
  return {
    reason: 'policy_conflict',
    why: `${input.action} conflicts with ${input.policy}.`,
    known: [...input.facts],
    unknown: ['Whether the policy should apply in this case — that is a policy decision, not a data one.'],
    resolution: input.resolution,
    ifProceeding: '',
  };
}

/* ── insufficient_evidence ─────────────────────────────────────────────────── */

/**
 * The system understood the request and does not have enough to answer it.
 *
 * The most important hold in the product, and the easiest to get wrong: the
 * tempting alternative is a confident-sounding answer built on nothing. What
 * is MISSING has to be named specifically enough to act on — "not enough
 * data" is not a resolution, "no invoices have been imported" is.
 */
export function insufficientEvidenceHold(input: {
  objective: string;
  /** What IS available. May be empty — that is itself the finding. */
  available: readonly string[];
  /** Specifically what is absent. */
  missing: readonly string[];
  resolution: string;
}): HoldView {
  return {
    reason: 'insufficient_evidence',
    why: `There is not enough evidence to ${input.objective} reliably, so NeuroPause has not answered.`,
    known:
      input.available.length > 0
        ? [...input.available]
        : ['Nothing relevant is present yet — no records, imports or connections cover this.'],
    unknown: [...input.missing],
    resolution: input.resolution,
    ifProceeding: '',
  };
}

/* ── unresolved_dependency ─────────────────────────────────────────────────── */

/**
 * Something this work depends on is not ready.
 *
 * The count matters: "3 references do not resolve" is checkable, "there are
 * dependency problems" is not.
 */
export function unresolvedDependencyHold(input: {
  action: string;
  /** Each unresolved dependency, named. */
  dependencies: readonly string[];
  resolution: string;
}): HoldView {
  const n = input.dependencies.length;
  return {
    reason: 'unresolved_dependency',
    why: `${input.action} depends on ${n} thing${n === 1 ? '' : 's'} that ${n === 1 ? 'is' : 'are'} not resolved yet.`,
    known: [...input.dependencies],
    unknown: ['Whether the dependencies will resolve on their own, or need a person.'],
    resolution: input.resolution,
    ifProceeding: '',
  };
}

/* ── ambiguous_identity ────────────────────────────────────────────────────── */

/**
 * A reference matches more than one record.
 *
 * Guessing is the failure mode to avoid: picking the "best" candidate silently
 * attaches a payment to the wrong customer, and nothing downstream ever
 * questions it. The candidates go on screen so a person decides.
 */
export function ambiguousIdentityHold(input: {
  action: string;
  /** The literal text that was matched, as the source supplied it. */
  reference: string;
  /** Every candidate — not a shortlist, and never auto-picked. */
  candidates: readonly string[];
}): HoldView {
  return {
    reason: 'ambiguous_identity',
    why: `"${input.reference}" matches ${input.candidates.length} records, so ${input.action} cannot proceed without knowing which one is meant.`,
    known: input.candidates.map((c, i) => `Candidate ${i + 1}: ${c}`),
    unknown: ['Which of these the source system meant. NeuroPause will not guess.'],
    resolution: 'Choose the correct record, or correct the reference at the source.',
    ifProceeding: '',
  };
}

/* ── external_system_unavailable ───────────────────────────────────────────── */

/**
 * A system this work needs cannot be reached.
 *
 * Usually transient, which is exactly why it must not be reported as a
 * failure: nothing is wrong with the request, and retrying later is a real
 * resolution. The observed state is quoted rather than summarised — "auth
 * expired" and "host unreachable" need different actions.
 */
export function externalUnavailableHold(input: {
  action: string;
  systemName: string;
  /** The state actually observed. Never inferred. */
  observed: string;
  lastSuccessAt?: string | null;
}): HoldView {
  return {
    reason: 'external_unavailable',
    why: `${input.systemName} could not be reached, so ${input.action} has not run.`,
    known: [
      `${input.systemName} reported: ${input.observed}.`,
      input.lastSuccessAt
        ? `Last successful contact: ${input.lastSuccessAt}.`
        : 'There is no record of a successful contact with this system.',
    ],
    unknown: [
      'Whether this is temporary. NeuroPause cannot distinguish an outage from a withdrawn credential without trying again.',
    ],
    resolution: `Retry once ${input.systemName} is reachable, or reconnect it if the credential was revoked.`,
    ifProceeding: '',
  };
}

/* ── verification_unavailable ──────────────────────────────────────────────── */

/**
 * The action can run, but its result could not be confirmed.
 *
 * The hold exists because "done" and "probably done" are different claims. An
 * unverified execution reported as success is how a system loses the right to
 * be believed about any of its successes.
 */
export function verificationUnavailableHold(input: {
  action: string;
  /** What verification WOULD have checked. */
  expected: string;
  /** Why it could not be checked. */
  because: string;
}): HoldView {
  return {
    reason: 'verification_unavailable',
    why: `${input.action} cannot be confirmed, so NeuroPause is not reporting it as done.`,
    known: [`Verification would check: ${input.expected}.`, `It could not: ${input.because}.`],
    unknown: ['Whether the action actually took effect. Unverified is not the same as failed.'],
    resolution: 'Restore the verification source, then re-check. The action itself is unchanged.',
    ifProceeding: '',
  };
}
