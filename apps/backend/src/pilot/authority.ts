/**
 * Non-authorizing authority interface for consequential pilot operations.
 *
 * THIS FILE CREATES NO AUTHORITY. It defines the shape of a question and one
 * answer — UNKNOWN — so that a consequential operation can fail closed while the
 * question remains unanswered.
 *
 * The distinction this exists to hold:
 *
 *   ACTOR !== SUBJECT   is a separation property, NOT an authorization.
 *   AUTHENTICATED       is not authorized.
 *   ROLE / ADMIN        is not a designation.
 *   CONSENT             is not authority.
 *   CLAIM / BASELINE    existing is not adoption or designation.
 *
 * An implementation of AuthorityEvaluator that returns ALLOW is a DESIGNATION of
 * who may decide. No such implementation exists here, and none may be added
 * without a human designation (MR-04). Production supplies no evaluator at all,
 * so `resolveAuthority` yields UNKNOWN and every consequential call is withheld.
 */

/** What an actor is asking to do to a subject. Actor and subject are distinct by type. */
export interface DecisionContext {
  /** The principal making the request. */
  readonly actorId: string;
  /** The principal the request is about. Never defaulted from actorId. */
  readonly subjectId: string;
  /** The consequential action requested. */
  readonly action: string;
  /** The object the action targets, where one is known before the decision. */
  readonly targetId?: string;
}

export type AuthorityDecision = 'ALLOW' | 'DENY' | 'UNKNOWN';

export interface AuthorityEvaluator {
  evaluate(context: DecisionContext): AuthorityDecision;
}

/**
 * The only evaluator shipped. It answers UNKNOWN for every context, because no
 * decision authority has been designated. It deliberately reads nothing from the
 * context: no role, no email, no admin flag, no consent record, no claim, no
 * baseline, no string that looks like a designation.
 */
export const NO_AUTHORITY_CONFIGURED: AuthorityEvaluator = {
  evaluate(): AuthorityDecision {
    return 'UNKNOWN';
  },
};

/**
 * Fail-closed resolution. An absent evaluator is not a permissive default: it is
 * the same UNKNOWN as an evaluator that declines to answer.
 */
export function resolveAuthority(
  evaluator: AuthorityEvaluator | undefined,
  context: DecisionContext,
): AuthorityDecision {
  // An evaluator must be a real object carrying its OWN evaluate function. A plain
  // property lookup would also find one inherited from Object.prototype, so a
  // prototype-pollution primitive elsewhere in the process could otherwise hand this
  // guard an evaluator it was never given. No such primitive is known in this backend
  // (no deep-merge or Object.assign of request data), so this is hardening, not a
  // patched exploit — but the guard should not depend on that remaining true.
  if (
    typeof evaluator !== 'object' ||
    evaluator === null ||
    !Object.prototype.hasOwnProperty.call(evaluator, 'evaluate') ||
    typeof evaluator.evaluate !== 'function'
  )
    return 'UNKNOWN';

  let decision: unknown;
  try {
    decision = evaluator.evaluate(context);
  } catch {
    // A throwing evaluator has not answered ALLOW. Fail closed rather than let a raw
    // Error escape the guard as a 500 instead of a refusal.
    return 'UNKNOWN';
  }
  // Anything that is not an explicit ALLOW or DENY is withheld. UNKNOWN never widens.
  // Strict equality on a primitive string defeats coercion tricks (new String('ALLOW'),
  // ['ALLOW'], objects with toString/valueOf, thenables, Promise<'ALLOW'>).
  return decision === 'ALLOW' || decision === 'DENY' ? decision : 'UNKNOWN';
}

/** True only for an explicit ALLOW. Used so callers cannot accidentally treat UNKNOWN as permission. */
export function isPermitted(decision: AuthorityDecision): boolean {
  return decision === 'ALLOW';
}

/**
 * Read an evaluator from a deps object ONLY if it is an own property.
 *
 * A bare `deps.authority` lookup walks the prototype chain, so a polluted
 * Object.prototype.authority would be found on a deps literal that never carried one —
 * measured: that attack wrote a decision row through a production-shaped { repo }.
 * The own-property check is the actual fix; checking the evaluator's own `evaluate`
 * does not help, because the injected evaluator legitimately owns its method.
 */
export function ownAuthority(deps: object): AuthorityEvaluator | undefined {
  if (typeof deps !== 'object' || deps === null) return undefined;
  if (!Object.prototype.hasOwnProperty.call(deps, 'authority')) return undefined;
  return (deps as { authority?: AuthorityEvaluator }).authority;
}
