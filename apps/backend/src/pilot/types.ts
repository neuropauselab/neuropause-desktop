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
  | 'COMPLETED';

/** States only reachable through a recorded human decision — never by machine flow. */
export const HUMAN_DECISION_STATES: readonly PilotState[] = [
  'CONTINUE',
  'PAID_PENDING_HUMAN_DECISION',
  'INSTITUTIONAL_PENDING',
  'EXTENDED',
  'STOPPED',
  'COMPLETED',
];

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
  | 'invalid_decision';

export class PilotError extends Error {
  constructor(
    public readonly code: PilotErrorCode,
    message: string,
  ) {
    super(message);
  }
}
