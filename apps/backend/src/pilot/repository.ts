/** SQL repository for the pilot lifecycle (mirrors devices/repository style). */
import { query } from '../db/pool';
import type { ConsentRecord, HumanDecision, PilotEnrollment, PilotEvent, PilotEventType, PilotState } from './types';

export interface PilotRepository {
  recordConsent(userId: string, version: string): Promise<ConsentRecord>;
  latestConsent(userId: string): Promise<ConsentRecord | null>;
  createEnrollment(userId: string, consentId: string): Promise<PilotEnrollment>;
  getEnrollment(userId: string): Promise<PilotEnrollment | null>;
  setEnrollmentState(id: string, state: PilotState, decisionId: string | null): Promise<void>;
  insertEvent(userId: string, enrollmentId: string, type: PilotEventType, metadata: Record<string, unknown>): Promise<PilotEvent>;
  listEvents(enrollmentId: string): Promise<PilotEvent[]>;
  insertDecision(d: Omit<HumanDecision, 'id' | 'createdAt'>): Promise<HumanDecision>;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// pg returns timestamptz columns as JS Date objects; the domain contract is ISO strings.
const iso = (v: any): string => (v instanceof Date ? v.toISOString() : String(v));
const consentRow = (r: any): ConsentRecord => ({ id: r.id, userId: r.user_id, version: r.version, createdAt: iso(r.created_at) });
const enrollRow = (r: any): PilotEnrollment => ({ id: r.id, userId: r.user_id, state: r.state, consentId: r.consent_id, decisionId: r.decision_id, startedAt: iso(r.started_at), updatedAt: iso(r.updated_at) });
const eventRow = (r: any): PilotEvent => ({ id: r.id, userId: r.user_id, enrollmentId: r.enrollment_id, eventType: r.event_type, metadata: r.metadata, createdAt: iso(r.created_at) });
const decisionRow = (r: any): HumanDecision => ({ id: r.id, actorId: r.actor_id, decisionType: r.decision_type, subject: r.subject, decision: r.decision, reason: r.reason, createdAt: iso(r.created_at) });

export const sqlPilotRepository: PilotRepository = {
  async recordConsent(userId, version) {
    const { rows } = await query('INSERT INTO consents (user_id, version) VALUES ($1,$2) RETURNING *', [userId, version]);
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
};
