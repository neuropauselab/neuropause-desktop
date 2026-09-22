/** SQL repository for the pilot lifecycle (mirrors devices/repository style). */
import { query } from '../db/pool';
import type {
  ConsentRecord, HumanDecision, PilotControl, PilotEnrollment, PilotEvent, PilotEventType,
  PilotLifecycleEvent, PilotState, PilotTerms,
} from './types';

export interface PilotRepository {
  recordConsent(userId: string, version: string, terms?: PilotTerms | null): Promise<ConsentRecord>;
  latestConsent(userId: string): Promise<ConsentRecord | null>;
  createEnrollment(userId: string, consentId: string): Promise<PilotEnrollment>;
  getEnrollment(userId: string): Promise<PilotEnrollment | null>;
  setEnrollmentState(id: string, state: PilotState, decisionId: string | null): Promise<void>;
  insertEvent(userId: string, enrollmentId: string, type: PilotEventType, metadata: Record<string, unknown>): Promise<PilotEvent>;
  listEvents(enrollmentId: string): Promise<PilotEvent[]>;
  insertDecision(d: Omit<HumanDecision, 'id' | 'createdAt'>): Promise<HumanDecision>;
  /**
   * The human decision behind `pilot_enrollments.decision_id`.
   *
   * G7 (NP-PILOT-FIRST-004) found this reader MISSING: `insertDecision` had no counterpart,
   * so the row that authorizes an outcome state was WRITE-ONLY through this interface and a
   * participation could not be reconstructed from evidence past the point where a human
   * decided something. A record nothing can read is not a separate evidence class; it is an
   * absent one. This is a READ and grants nothing.
   */
  findDecision(id: string): Promise<HumanDecision | null>;
  // NP-PILOT-FIRST-004
  /** The terms object for a version, or null if the registry does not hold it. */
  findTerms(version: string): Promise<PilotTerms | null>;
  /** The pilot-wide control row. Always present; the migration seeds exactly one. */
  getControl(): Promise<PilotControl>;
  setStopped(stopped: boolean, actorId: string | null, reason: string | null): Promise<void>;
  /** Enrollments that have not exited — the count an approved cap is compared against. */
  countActiveEnrollments(): Promise<number>;
  insertLifecycleEvent(e: Omit<PilotLifecycleEvent, 'id' | 'createdAt'>): Promise<PilotLifecycleEvent>;
  listLifecycleEvents(enrollmentId: string): Promise<PilotLifecycleEvent[]>;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// pg returns timestamptz columns as JS Date objects; the domain contract is ISO strings.
const iso = (v: any): string => (v instanceof Date ? v.toISOString() : String(v));
const consentRow = (r: any): ConsentRecord => ({ id: r.id, userId: r.user_id, version: r.version, createdAt: iso(r.created_at), termsId: r.terms_id ?? null, termsDigest: r.terms_digest ?? null });
const termsRow = (r: any): PilotTerms => ({ id: r.id, version: r.version, status: r.status, digest: r.digest, contentReference: r.content_reference, publishedAt: r.published_at ? iso(r.published_at) : null });
const controlRow = (r: any): PilotControl => ({ stopped: r.stopped, stopActorId: r.stop_actor_id ?? null, stopReason: r.stop_reason ?? null, stopAt: r.stop_at ? iso(r.stop_at) : null, maxParticipants: r.max_participants ?? null });
const lifecycleRow = (r: any): PilotLifecycleEvent => ({ id: r.id, enrollmentId: r.enrollment_id, subjectUserId: r.subject_user_id, actorUserId: r.actor_user_id, kind: r.kind, previousState: r.previous_state, newState: r.new_state, reason: r.reason, createdAt: iso(r.created_at) });
const enrollRow = (r: any): PilotEnrollment => ({ id: r.id, userId: r.user_id, state: r.state, consentId: r.consent_id, decisionId: r.decision_id, startedAt: iso(r.started_at), updatedAt: iso(r.updated_at) });
const eventRow = (r: any): PilotEvent => ({ id: r.id, userId: r.user_id, enrollmentId: r.enrollment_id, eventType: r.event_type, metadata: r.metadata, createdAt: iso(r.created_at) });
const decisionRow = (r: any): HumanDecision => ({ id: r.id, actorId: r.actor_id, decisionType: r.decision_type, subject: r.subject, decision: r.decision, reason: r.reason, createdAt: iso(r.created_at) });

export const sqlPilotRepository: PilotRepository = {
  async recordConsent(userId, version, terms) {
    const { rows } = await query(
      'INSERT INTO consents (user_id, version, terms_id, terms_digest) VALUES ($1,$2,$3,$4) RETURNING *',
      [userId, version, terms?.id ?? null, terms?.digest ?? null],
    );
    return consentRow(rows[0]);
  },
  async latestConsent(userId) {
    const { rows } = await query('SELECT * FROM consents WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1', [userId]);
    return rows[0] ? consentRow(rows[0]) : null;
  },
  async createEnrollment(userId, consentId) {
    const { rows } = await query(
      "INSERT INTO pilot_enrollments (user_id, state, consent_id) VALUES ($1,'PILOT_ACTIVE',$2) RETURNING *",
      [userId, consentId],
    );
    return enrollRow(rows[0]);
  },
  async getEnrollment(userId) {
    const { rows } = await query('SELECT * FROM pilot_enrollments WHERE user_id=$1', [userId]);
    return rows[0] ? enrollRow(rows[0]) : null;
  },
  async setEnrollmentState(id, state, decisionId) {
    await query('UPDATE pilot_enrollments SET state=$2, decision_id=COALESCE($3, decision_id), updated_at=now() WHERE id=$1', [id, state, decisionId]);
  },
  async insertEvent(userId, enrollmentId, type, metadata) {
    const { rows } = await query(
      'INSERT INTO pilot_events (user_id, enrollment_id, event_type, metadata) VALUES ($1,$2,$3,$4) RETURNING *',
      [userId, enrollmentId, type, JSON.stringify(metadata)],
    );
    return eventRow(rows[0]);
  },
  async listEvents(enrollmentId) {
    const { rows } = await query('SELECT * FROM pilot_events WHERE enrollment_id=$1 ORDER BY created_at', [enrollmentId]);
    return rows.map(eventRow);
  },
  async insertDecision(d) {
    const { rows } = await query(
      'INSERT INTO human_decisions (actor_id, decision_type, subject, decision, reason) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [d.actorId, d.decisionType, d.subject, d.decision, d.reason],
    );
    return decisionRow(rows[0]);
  },
  async findDecision(id) {
    const { rows } = await query('SELECT * FROM human_decisions WHERE id=$1', [id]);
    return rows[0] ? decisionRow(rows[0]) : null;
  },
  async findTerms(version) {
    const { rows } = await query('SELECT * FROM pilot_terms WHERE version=$1', [version]);
    return rows[0] ? termsRow(rows[0]) : null;
  },
  async getControl() {
    const { rows } = await query('SELECT * FROM pilot_control WHERE id=true');
    // The migration seeds the singleton. If it is somehow absent, fail CLOSED: report a
    // stopped pilot with an undecided boundary rather than an open one.
    return rows[0]
      ? controlRow(rows[0])
      : { stopped: true, stopActorId: null, stopReason: 'pilot_control row missing', stopAt: null, maxParticipants: null };
  },
  async setStopped(stopped, actorId, reason) {
    await query(
      'UPDATE pilot_control SET stopped=$1, stop_actor_id=$2, stop_reason=$3, stop_at=CASE WHEN $1 THEN now() ELSE NULL END, updated_at=now() WHERE id=true',
      [stopped, actorId, reason],
    );
  },
  async countActiveEnrollments() {
    const { rows } = await query(
      "SELECT count(*)::int AS n FROM pilot_enrollments WHERE state NOT IN ('WITHDRAWN','TERMINATED','COMPLETED')",
    );
    return rows[0]?.n ?? 0;
  },
  async insertLifecycleEvent(e) {
    const { rows } = await query(
      'INSERT INTO pilot_lifecycle_events (enrollment_id, subject_user_id, actor_user_id, kind, previous_state, new_state, reason) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [e.enrollmentId, e.subjectUserId, e.actorUserId, e.kind, e.previousState, e.newState, e.reason],
    );
    return lifecycleRow(rows[0]);
  },
  async listLifecycleEvents(enrollmentId) {
    const { rows } = await query('SELECT * FROM pilot_lifecycle_events WHERE enrollment_id=$1 ORDER BY created_at', [enrollmentId]);
    return rows.map(lifecycleRow);
  },
};
