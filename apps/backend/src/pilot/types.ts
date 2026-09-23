export type PilotState =
  | 'PILOT_ACTIVE'
  | 'DAY7_READY'
  | 'DAY7_REVIEWED'
  | 'DAY30_READY'
  | 'OUTCOME_PENDING'
  | 'CONTINUE'
  | 'PAID_PENDING_HUMAN_DECISION'
  | 'INSTITUTIONAL_PENDING'
  | 'EXTENDED'
  | 'STOPPED'
  | 'COMPLETED'
  // NP-PILOT-FIRST-004 (C-03). WITHDRAWN, TERMINATED and COMPLETED are deliberately THREE
  // states, not one: a pilot the participant left, a pilot an operator ended, and a pilot
  // that finished are different facts, and collapsing them would destroy the difference.
  | 'WITHDRAWN'
  | 'TERMINATED';

/** States only reachable through a recorded human decision — never by machine flow. */
export const HUMAN_DECISION_STATES: readonly PilotState[] = [
  'CONTINUE',
  'PAID_PENDING_HUMAN_DECISION',
  'INSTITUTIONAL_PENDING',
  'EXTENDED',
  'STOPPED',
  'COMPLETED',
];

/**
 * States after which the participation is over. No further pilot activity is accepted and
 * the machine never advances out of one. Re-entry, if it is ever allowed, is a human policy
 * decision — see PILOT_RE_ENROLLMENT_POLICY below.
 */
export const EXITED_STATES: readonly PilotState[] = ['WITHDRAWN', 'TERMINATED', 'COMPLETED'];

/**
 * Re-enrollment is NOT ALLOWED, and that is encoded rather than assumed: the UNIQUE
 * constraint on pilot_enrollments.user_id has always made enrollment one-shot per account,
 * and this seam did not change it. Whether it SHOULD be allowed is a human decision that has
 * not been made (NP-PILOT-FIRST-004, HUMAN_DECISION_REQUIRED), so the existing behaviour is
 * recorded here explicitly instead of being inferred from a database constraint.
 */
export const PILOT_RE_ENROLLMENT_POLICY = 'NOT_ALLOWED_PENDING_HUMAN_DECISION' as const;

/** An authoritative, published terms object. Consent binds to one of these, never to a string. */
export interface PilotTerms {
  id: string;
  version: string;
  status: 'DRAFT' | 'PUBLISHED' | 'RETIRED';
  digest: string;
  contentReference: string;
  publishedAt: string | null;
}

/** The pilot-wide control row. A stop is a PILOT state, never an infrastructure action. */
export interface PilotControl {
  stopped: boolean;
  stopActorId: string | null;
  stopReason: string | null;
  stopAt: string | null;
  /** NULL means the boundary is UNDECIDED — it does not mean unlimited. */
  maxParticipants: number | null;
}

/**
 * What an ORDINARY authenticated caller may see of the control row.
 *
 * A participant has a legitimate need to know the pilot is stopped: it explains the refusal
 * they just received. They have no established need to know WHICH HUMAN stopped it or WHY, and
 * that disclosure is undecided (see decisions/HUMAN-DECISION-G5-STOP-AUTHORITY.md).
 *
 * `maxParticipants` is excluded too - the programme's capacity is an operational fact about the
 * pilot, not a fact about the participant asking.
 */
export interface PilotControlPublic {
  stopped: boolean;
}

export interface PilotLifecycleEvent {
  id: string;
  /** NULL for pilot-wide events (STOP / RESUME), which belong to no single participation. */
  enrollmentId: string | null;
  subjectUserId: string | null;
  actorUserId: string;
  kind: 'WITHDRAWAL' | 'TERMINATION' | 'COMPLETION' | 'STOP' | 'RESUME';
  previousState: PilotState;
  newState: PilotState;
  reason: string;
  createdAt: string;
}

export const PILOT_EVENT_TYPES = [
  'session_started',
  'session_ended',
  'os_install_started',
  'os_install_completed',
  'os_version_reported',
  'device_connected',
  'policy_acknowledged',
  'measurement_recorded',
  'feedback_submitted',
] as const;
export type PilotEventType = (typeof PILOT_EVENT_TYPES)[number];

export interface ConsentRecord {
  id: string;
  userId: string;
  version: string;
  createdAt: string;
  /** The terms object accepted. NULL on consents recorded before the registry existed. */
  termsId: string | null;
  /** The digest of the exact content accepted, stored beside the reference. */
  termsDigest: string | null;
}

export interface PilotEnrollment {
  id: string;
  userId: string;
  state: PilotState;
  consentId: string;
  decisionId: string | null;
  startedAt: string;
  updatedAt: string;
}

export interface PilotEvent {
  id: string;
  userId: string;
  enrollmentId: string;
  eventType: PilotEventType;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface HumanDecision {
  id: string;
  actorId: string;
  decisionType: 'commercial' | 'pilot' | 'institutional';
  subject: string;
  decision: string;
  reason: string;
  createdAt: string;
}

export type PilotErrorCode =
  | 'consent_required'
  | 'already_enrolled'
  | 'not_enrolled'
  | 'invalid_event'
  | 'human_decision_required'
  | 'invalid_decision'
  // NP-PILOT-FIRST-004
  | 'terms_unknown'          // the named version is not in the registry
  | 'terms_not_published'    // it exists but is DRAFT or RETIRED
  | 'consent_not_bound'      // the consent predates the registry, or names no terms object
  | 'pilot_stopped'          // the pilot as a whole is stopped
  | 'enrollment_boundary_undecided' // no approved cap exists, so enrollment is withheld
  | 'enrollment_full'        // the approved cap is reached
  | 'already_exited'
  // NP-PILOT-FIRST-005 — the bound terms are re-read at enrollment, not merely copied at consent.
  | 'terms_digest_mismatch'
  | 'terms_no_longer_published';        // withdrawn / terminated / completed

export class PilotError extends Error {
  constructor(
    public readonly code: PilotErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/**
 * The result of an enrollment attempt, decided INSIDE the cap transaction.
 *
 * A bare `PilotEnrollment | null` conflated three different refusals, so the service had to
 * re-derive the reason from state it had read earlier — which is exactly how NP-007's
 * stop-race survived: `enroll` read `stopped` before the transaction and mapped every null to
 * `enrollment_full`. The reason is now decided where the lock is held and carried out.
 */
export type EnrollmentAdmission =
  | { ok: true; enrollment: PilotEnrollment }
  | { ok: false; reason: 'pilot_stopped' | 'enrollment_boundary_undecided' | 'enrollment_full' };
