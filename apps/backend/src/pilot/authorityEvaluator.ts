/**
 * ENG-04 — the pilot authority evaluator.
 *
 * `authority.ts` defines the SHAPE of the question and one answer, UNKNOWN. This file answers
 * it. Until NP-PILOT-FIRST-HUMAN-001 D05 designated three roles, writing this file was
 * forbidden: `authority.ts` states that an evaluator returning ALLOW is itself a designation
 * of who may decide, and none could be added without a human one. D05 is that designation, so
 * the mechanism may now exist.
 *
 * WHAT D05 DID NOT SUPPLY, AND WHY THIS STILL DENIES EVERYTHING IN PRODUCTION.
 *
 * D05 names three PEOPLE. The code authorizes by authenticated subject id. A name is not an
 * identifier, and resolving one to an account would be engineering deciding who the authority
 * is - the precise act this whole apparatus exists to prevent. So `pilot_role_bindings` ships
 * empty, every lookup misses, and every consequential route answers DENY with
 * `ROLE_NOT_BOUND`. That is the correct state, not a gap in this file.
 *
 * §12 — WHAT IS NEVER SUFFICIENT: a display name, a role NAME, an email, a job title, a
 * repository permission, or an organizational position. Nothing in this file reads any of
 * those. The only key is `subjectId`, and it must be present in the bindings table.
 *
 * §13 — THERE IS NO ALLOW_ALL. Each role carries an explicit, enumerated action list. A role
 * with a wildcard would make the action check decorative.
 */
import type { AuthorityDecision, AuthorityEvaluator, DecisionContext } from './authority';
import type { AlertClass, PilotMonitor } from './monitor';

export type PilotRole =
  | 'FIRST_PILOT_HUMAN_DECISION_AUTHORITY'
  | 'PILOT_OPERATOR_TECHNICAL_OPERATIONS'
  | 'INDEPENDENT_PILOT_VERIFIER';

export type AuthorityReason =
  | 'ALLOWED'
  | 'NO_AUTHENTICATED_SUBJECT'
  | 'ROLE_NOT_BOUND'
  | 'ROLE_REVOKED'
  | 'ROLE_EXPIRED'
  | 'DECISION_MISSING'
  | 'DECISION_INVALID'
  | 'DECISION_OUT_OF_SCOPE'
  | 'ACTION_NOT_AUTHORIZED'
  | 'TARGET_NOT_AUTHORIZED'
  | 'ENVIRONMENT_NOT_AUTHORIZED'
  | 'PRODUCTION_TARGET_DENIED';

/**
 * The action vocabulary is THE ONE ALREADY IN USE at the five `resolveAuthority` call sites in
 * `service.ts`. A parallel set of PILOT_STOP-style constants would be a second vocabulary for
 * the same concept, and this programme has repeatedly measured what that costs. The mapping to
 * the directive's §13 classes is recorded here instead of being built.
 *
 *   pilot.control.read            -> PILOT_CONFIGURATION (read)
 *   pilot.stop                    -> PILOT_STOP
 *   pilot.resume                  -> PILOT_RESUME
 *   pilot.participation.terminate -> PILOT_TERMINATION
 *   pilot.decision.record         -> PILOT_EXECUTION_AUTHORIZATION (outcome decisions)
 *   pilot.cap.set                 -> PILOT_CONFIGURATION (write)
 *
 * `pilot.cap.set` WAS MISSING FROM THIS LIST UNTIL NP-PILOT-FIRST-013, AND THE OMISSION WAS
 * NOT COSMETIC. `capGovernance.ts` has asked `resolveAuthority` for it since NP-009, but the
 * literal appeared in neither PILOT_ACTIONS nor any ROLE_ACTIONS row - so step 5 of
 * `explainAuthority` found `permitted.length === 0` and answered DENY/ACTION_NOT_AUTHORIZED
 * FOR EVERY ROLE, PERMANENTLY. The governed path built to set the cap could never have set it.
 *
 * It failed CLOSED, so nothing was ever wrongly permitted - but D09's cap could never have been
 * activated, and that would have surfaced only at the moment someone first tried.
 *
 * WHY FORTY TESTS AND FOUR MUTANTS MISSED IT: every ENG-10 test injected
 * `{ evaluate: () => 'ALLOW' }`, which bypasses this function entirely. Nothing ever asked the
 * real evaluator whether any role may perform the action. That is the same defect class as
 * NP-007's in-memory repository - a double more permissive than reality - in a control written
 * after that lesson was recorded. `authorityActionCoverage.test.ts` now pins the invariant at
 * source level so the next such omission fails a test rather than waiting for a caller.
 */
export const PILOT_ACTIONS = [
  'pilot.control.read',
  'pilot.stop',
  'pilot.resume',
  'pilot.participation.terminate',
  'pilot.decision.record',
  'pilot.cap.set',
] as const;
export type PilotAction = (typeof PILOT_ACTIONS)[number];

/**
 * THE ROLE MATRIX, derived from the instrument rather than from convenience.
 *
 * D06: the operator may stop WITHOUT prior approval, so `pilot.stop` is the operator's.
 * D07: resume authority is the decision authority's alone - the operator EXECUTES a resume but
 *      does not authorize one, so `pilot.resume` is deliberately absent from the operator row.
 * D12: operator termination is a defined operator power, so it is present.
 * D04: the operator may not grant authorization, so `pilot.decision.record` is absent.
 * §30: the independent verifier VERIFIES; she operates nothing. Read only.
 */
export const ROLE_ACTIONS: Readonly<Record<PilotRole, readonly PilotAction[]>> = {
  FIRST_PILOT_HUMAN_DECISION_AUTHORITY: [
    'pilot.control.read', 'pilot.stop', 'pilot.resume',
    'pilot.participation.terminate', 'pilot.decision.record',
    // D05 verbatim lists "participant-cap changes" among this role's authorities, so adding it
    // here IMPLEMENTS AN ALREADY-SUBMITTED DECISION rather than making a new one. It is on this
    // row and no other: D04's operator may not change the cap, and D09 states that "increasing
    // the cap requires a new human decision".
    'pilot.cap.set',
  ],
  PILOT_OPERATOR_TECHNICAL_OPERATIONS: [
    'pilot.control.read', 'pilot.stop', 'pilot.participation.terminate',
  ],
  INDEPENDENT_PILOT_VERIFIER: ['pilot.control.read'],
};

export interface RoleBinding {
  readonly subjectId: string;
  readonly role: PilotRole;
  readonly decisionRef: string;
  readonly boundAt: string;
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
}

export interface AuthorityDecisionArtifact {
  readonly instrument: string;
  /** FALSE until a human authentication process says otherwise. Never set by code. */
  readonly authenticated: boolean;
  readonly actions: readonly string[];
  readonly environmentClass: 'PILOT';
  readonly effectiveFrom: string;
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
}

export interface AuthorityEnvironment {
  readonly environmentClass: string;
  readonly environmentId: string;
}

/**
 * Everything the evaluator needs, read ONCE PER REQUEST before the gate runs.
 *
 * `resolveAuthority` requires a SYNCHRONOUS `evaluate` returning exactly 'ALLOW' or 'DENY' -
 * deliberately so, because a promise is not an answer and it refuses anything else. Rather
 * than weaken that contract, the three lookups happen up front and the evaluator is a pure
 * function of this snapshot. A stale snapshot can only ever be MORE restrictive than the live
 * state for the duration of one request, because a binding added mid-request simply is not
 * seen; a binding REVOKED mid-request is the case that matters, and §19 handles it at the
 * write rather than here.
 */
export interface AuthoritySnapshot {
  readonly bindings: readonly RoleBinding[];
  readonly decisions: readonly AuthorityDecisionArtifact[];
  /** null when the environment is not established. Null DENIES. */
  readonly environment: AuthorityEnvironment | null;
  readonly now: Date;
}

export interface AuthorityOutcome {
  readonly decision: AuthorityDecision;
  readonly reason: AuthorityReason;
  readonly role: PilotRole | null;
  readonly instrument: string | null;
}

const ALERT_FOR_REASON: Partial<Record<AuthorityReason, AlertClass>> = {
  NO_AUTHENTICATED_SUBJECT: 'UNAUTHORIZED_ACCESS',
  ROLE_NOT_BOUND: 'UNAUTHORIZED_AUTHORITY',
  ROLE_REVOKED: 'UNAUTHORIZED_AUTHORITY',
  ROLE_EXPIRED: 'UNAUTHORIZED_AUTHORITY',
  DECISION_MISSING: 'UNAUTHORIZED_DECISION',
  DECISION_INVALID: 'UNAUTHORIZED_DECISION',
  DECISION_OUT_OF_SCOPE: 'UNAUTHORIZED_DECISION',
  ACTION_NOT_AUTHORIZED: 'UNAUTHORIZED_AUTHORITY',
  TARGET_NOT_AUTHORIZED: 'UNAUTHORIZED_AUTHORITY',
  ENVIRONMENT_NOT_AUTHORIZED: 'PRODUCTION_PATH_ATTEMPT',
  PRODUCTION_TARGET_DENIED: 'PRODUCTION_PATH_ATTEMPT',
};

function isUuid(v: unknown): v is string {
  return typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

/**
 * Evaluate, returning the REASON as well as the decision.
 *
 * Every branch below ends in DENY except the last. The function is written so that the ALLOW
 * is unreachable unless each preceding condition held - there is no early ALLOW, and no
 * default that falls through to permission.
 */
export function explainAuthority(
  snapshot: AuthoritySnapshot,
  context: DecisionContext,
): AuthorityOutcome {
  const now = snapshot.now;
  const deny = (reason: AuthorityReason, role: PilotRole | null = null, instrument: string | null = null):
    AuthorityOutcome => ({ decision: 'DENY', reason, role, instrument });

  // 1. AUTHENTICATED SUBJECT. An actorId is supplied by the request pipeline from a verified
  //    session; a malformed or absent one is not a subject at all.
  if (!isUuid(context.actorId)) return deny('NO_AUTHENTICATED_SUBJECT');

  // 2. ENVIRONMENT. Checked BEFORE any binding lookup, so an unestablished or non-pilot
  //    environment cannot be probed for which subjects are bound.
  const env = snapshot.environment;
  if (!env) return deny('ENVIRONMENT_NOT_AUTHORIZED');
  if (env.environmentClass !== 'PILOT') return deny('PRODUCTION_TARGET_DENIED');

  // 3. ROLE BINDING. Production ships none, so this is where every real call stops today.
  const bindings = snapshot.bindings;
  const bound = bindings.filter((b) => b.subjectId === context.actorId);
  if (bound.length === 0) return deny('ROLE_NOT_BOUND');

  const revokedOnly = bound.every((b) => b.revokedAt !== null && new Date(b.revokedAt) <= now);
  if (revokedOnly) return deny('ROLE_REVOKED', bound[0].role);

  const live = bound.filter((b) => !(b.revokedAt !== null && new Date(b.revokedAt) <= now));
  const unexpired = live.filter((b) => b.expiresAt === null || new Date(b.expiresAt) > now);
  if (unexpired.length === 0) return deny('ROLE_EXPIRED', live[0].role);

  // 4. ACTION within the role matrix. No wildcard exists to fall back on.
  const permitted = unexpired.filter((b) =>
    (ROLE_ACTIONS[b.role] as readonly string[]).includes(context.action));
  if (permitted.length === 0) return deny('ACTION_NOT_AUTHORIZED', unexpired[0].role);
  const binding = permitted[0];

  // 5. DECISION ARTIFACT. The binding names the instrument that created it; that instrument
  //    must exist, be AUTHENTICATED, be in force, and cover this action.
  const decisions = snapshot.decisions;
  const artifact = decisions.find((d) => d.instrument === binding.decisionRef);
  if (!artifact) return deny('DECISION_MISSING', binding.role);
  if (!artifact.authenticated) return deny('DECISION_INVALID', binding.role, artifact.instrument);
  if (artifact.revokedAt !== null && new Date(artifact.revokedAt) <= now)
    return deny('DECISION_INVALID', binding.role, artifact.instrument);
  if (new Date(artifact.effectiveFrom) > now)
    return deny('DECISION_INVALID', binding.role, artifact.instrument);
  if (artifact.expiresAt !== null && new Date(artifact.expiresAt) <= now)
    return deny('DECISION_INVALID', binding.role, artifact.instrument);
  if (artifact.environmentClass !== 'PILOT')
    return deny('DECISION_OUT_OF_SCOPE', binding.role, artifact.instrument);
  if (!artifact.actions.includes(context.action))
    return deny('DECISION_OUT_OF_SCOPE', binding.role, artifact.instrument);

  // 6. TARGET. An action naming a target must name one this evaluator can recognise. A
  //    malformed target is refused rather than ignored - ignoring it would make the field
  //    decorative, which is how an unconsumed field becomes unfalsifiable.
  if (context.targetId !== undefined && !isUuid(context.targetId))
    return deny('TARGET_NOT_AUTHORIZED', binding.role, artifact.instrument);

  return { decision: 'ALLOW', reason: 'ALLOWED', role: binding.role, instrument: artifact.instrument };
}

/**
 * Build the synchronous evaluator the existing gates consume, from a snapshot.
 *
 * Returns the evaluator plus the outcomes it produced, so the caller can record refusals to
 * the monitor AFTER the response is decided. Recording cannot happen inside `evaluate`: it is
 * synchronous by contract, and an evidence write must never sit on the critical path of the
 * refusal it describes.
 */
export function createSnapshotEvaluator(
  snapshot: AuthoritySnapshot,
): AuthorityEvaluator & { readonly outcomes: AuthorityOutcome[]; readonly contexts: DecisionContext[] } {
  const outcomes: AuthorityOutcome[] = [];
  const contexts: DecisionContext[] = [];
  return {
    outcomes,
    contexts,
    evaluate(context: DecisionContext): AuthorityDecision {
      const outcome = explainAuthority(snapshot, context);
      outcomes.push(outcome);
      contexts.push(context);
      return outcome.decision;
    },
  };
}

/**
 * Drain an evaluator's refusals into the monitor. Best-effort by design: see `monitor.ts` on
 * why an evidence emitter must not be able to fail the action it records.
 */
export async function recordAuthorityRefusals(
  monitor: PilotMonitor,
  evaluator: { readonly outcomes: readonly AuthorityOutcome[]; readonly contexts: readonly DecisionContext[] },
): Promise<void> {
  for (let i = 0; i < evaluator.outcomes.length; i += 1) {
    const outcome = evaluator.outcomes[i];
    const context = evaluator.contexts[i];
    if (outcome.decision !== 'DENY') continue;
    const alertClass = ALERT_FOR_REASON[outcome.reason];
    if (!alertClass) continue;
    await monitor.record({
      alertClass,
      outcome: 'DENIED',
      reasonCode: outcome.reason,
      actorId: context.actorId,
      subjectUserId: context.subjectId,
      action: context.action,
      detail: { role: outcome.role ?? 'NONE', instrument: outcome.instrument ?? 'NONE' },
    });
  }
}

/**
 * Load the snapshot from the database.
 *
 * All three reads are against tables that ship EMPTY, so in production this returns
 * `{ bindings: [], decisions: [], environment: <whatever ENV-01 resolved> }` and every gate
 * answers DENY / ROLE_NOT_BOUND.
 */
export async function loadAuthoritySnapshot(
  loaders: {
    bindings: () => Promise<readonly RoleBinding[]>;
    decisions: () => Promise<readonly AuthorityDecisionArtifact[]>;
    environment: () => Promise<AuthorityEnvironment | null>;
  },
  now: Date = new Date(),
): Promise<AuthoritySnapshot> {
  const [bindings, decisions, environment] = await Promise.all([
    loaders.bindings(), loaders.decisions(), loaders.environment(),
  ]);
  return { bindings, decisions, environment, now };
}
