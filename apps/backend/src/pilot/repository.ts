/** SQL repository for the pilot lifecycle (mirrors devices/repository style). */
import { query, withTransaction } from '../db/pilotPool';
import type {
  ConsentRecord, EnrollmentAdmission, HumanDecision, PilotControl, PilotEnrollment, PilotEvent, PilotEventType,
  PilotLifecycleEvent, PilotState, PilotTerms,
} from './types';

export interface PilotRepository {
  recordConsent(userId: string, version: string, terms?: PilotTerms | null): Promise<ConsentRecord>;
  latestConsent(userId: string): Promise<ConsentRecord | null>;
  /**
   * The consent a participation is BOUND to, by id.
   *
   * `pilot_enrollments.consent_id` was written and never read — the THIRD instance in this
   * module of a column persisted with no reader, after `insertDecision` and `terms_id`. The
   * consequence was not cosmetic: every reconstruction resolved consent with
   * `latestConsent(userId)`, so a participant who consented again to a newer terms version had
   * their whole participation retrospectively reported as resting on the NEWER document, in
   * both the evidence read-back and their own data export.
   */
  findConsentById(id: string): Promise<ConsentRecord | null>;
  createEnrollment(userId: string, consentId: string): Promise<PilotEnrollment>;
  /**
   * Admit a participant ONLY IF the approved boundary still has room — counted and written
   * ATOMICALLY, returning null when full.
   *
   * A test found the reason this must exist: checking `countActiveEnrollments()` and then
   * calling `createEnrollment()` is read-then-write, so two enrollments that begin before
   * either finishes BOTH see room and BOTH are admitted. A cap of one admitted two. The
   * boundary is the thing a human approves, so "approximately the approved number" is not a
   * boundary at all.
   */
  createEnrollmentWithinBoundary(userId: string, consentId: string): Promise<EnrollmentAdmission>;
  getEnrollment(userId: string): Promise<PilotEnrollment | null>;
  /**
   * Machine advancement, with BOTH preconditions inside the statement.
   *
   * NP-PILOT-FIRST-007 measured why this must exist. `advanceMachineStates` checked
   * `control.stopped` and `EXITED_STATES.includes(e.state)` and then called an UNCONDITIONAL
   * update. Both guards read values fetched BEFORE the `await`, so a withdrawal or a STOP that
   * committed in between was invisible to the write: over real HTTP, a participant's own
   * `GET /pilot/status` racing their `POST /pilot/withdraw` put them BACK IN THE PILOT in
   * 36-39% of trials, and a committed STOP did not bind advancement already in flight.
   *
   * Returns false when this caller lost the race - the row had exited, or the pilot stopped.
   */
  advanceMachineStateIfRunning(
    id: string,
    fromStates: readonly PilotState[],
    toState: PilotState,
  ): Promise<boolean>;
  /**
   * Record a human decision's state change ONLY IF the participation has not exited.
   *
   * Same defect class as above: `applyHumanDecision` guarded on a state read before the
   * decision row was written, so a decision racing a withdrawal overwrote the exit in 100/100
   * trials. The guard is now the UPDATE's own predicate.
   */
  applyDecisionStateIfActive(id: string, toState: PilotState, decisionId: string): Promise<boolean>;
  /**
   * Move a participation to an EXITED state ONLY IF it has not already exited, atomically.
   * Returns false when the row had already exited — i.e. when this caller lost the race.
   *
   * NP-PILOT-FIRST-005 measured why this must exist: `requireExitable` read the state and the
   * writes followed as separate statements, so TWO CONCURRENT WITHDRAWALS BOTH SUCCEEDED,
   * writing two WITHDRAWAL rows that each claimed previousState=PILOT_ACTIVE — and a
   * withdrawal racing a termination also both succeeded, leaving a ledger asserting that an
   * operator ended a participation the participant had already left. The read-back reported
   * EXITED with zero deviations in both cases, so the reconstruction built to catch
   * inconsistency could not see it.
   *
   * This is the same read-then-write shape `enroll` already fixed, in the same module, one
   * function away — `createEnrollmentWithinBoundary` is the pattern.
   */
  exitEnrollmentIfActive(id: string, state: PilotState, decisionId: string | null): Promise<boolean>;
  insertEvent(userId: string, enrollmentId: string, type: PilotEventType, metadata: Record<string, unknown>): Promise<PilotEvent>;
  /**
   * Insert an event ONLY IF the participation is still active and the pilot is running.
   * The two guards in `recordEvent` read state before the insert; a STOP committing in the
   * gap did not bind the write. One statement closes it.
   */
  insertEventIfActive(
    userId: string,
    enrollmentId: string,
    eventType: PilotEventType,
    metadata: Record<string, unknown>,
  ): Promise<PilotEvent | null>;
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
  /**
   * The terms object a consent is BOUND to, by id.
   *
   * `consents.terms_id` was written and never read by id — the same write-only shape this
   * module already fixed once for `insertDecision`. Resolving by VERSION instead answers
   * "whatever row currently answers to that string", which is precisely the question a
   * tampered or re-published registry gets wrong.
   */
  findTermsById(id: string): Promise<PilotTerms | null>;
  /**
   * Every PUBLISHED terms version, newest first.
   *
   * Consent binds to a document (C-05), but nothing told the participant WHICH document —
   * the web page hard-coded a version string that named no terms anywhere. This read is what
   * lets a surface show what is actually published, and show NOTHING when the registry is
   * empty, instead of offering consent to a placeholder.
   */
  listPublishedTerms(): Promise<PilotTerms[]>;
  /** The pilot-wide control row. Always present; the migration seeds exactly one. */
  getControl(): Promise<PilotControl>;
  setStopped(stopped: boolean, actorId: string | null, reason: string | null): Promise<void>;
  /** Enrollments that have not exited — the count an approved cap is compared against. */
  countActiveEnrollments(): Promise<number>;
  insertLifecycleEvent(e: Omit<PilotLifecycleEvent, 'id' | 'createdAt'>): Promise<PilotLifecycleEvent>;
  listLifecycleEvents(enrollmentId: string): Promise<PilotLifecycleEvent[]>;
  /**
   * The PILOT-WIDE lifecycle rows (STOP / RESUME), which belong to no participation and so
   * carry enrollment_id NULL — meaning `listLifecycleEvents` can never return them. Without
   * this read they are write-only, and §11's "audit reconstruction" could not be performed
   * for the one control that affects every participant at once.
   */
  listPilotWideLifecycleEvents(): Promise<PilotLifecycleEvent[]>;
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
  async findConsentById(id) {
    const { rows } = await query('SELECT * FROM consents WHERE id=$1', [id]);
    return rows[0] ? consentRow(rows[0]) : null;
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
  async createEnrollmentWithinBoundary(userId, consentId) {
    return withTransaction(async (client) => {
      // Lock the singleton control row FIRST. Every concurrent enrollment serializes here, so
      // the count below is taken while no other enrollment can be committing.
      const control = await client.query('SELECT max_participants, stopped FROM pilot_control FOR UPDATE');
      // NP-007: `enroll` read `stopped` BEFORE this transaction, so a STOP committing in the
      // gap did not bind the insert. `stopped` is now read under the same FOR UPDATE lock that
      // serializes the cap, so a committed STOP is visible to every enrollment behind it.
      // A MISSING singleton refuses, matching getControl's fail-closed default.
      if (control.rows[0] === undefined || control.rows[0].stopped === true)
        return { ok: false, reason: 'pilot_stopped' as const };
      const cap: number | null = control.rows[0].max_participants ?? null;
      if (cap === null) return { ok: false, reason: 'enrollment_boundary_undecided' as const };
      const counted = await client.query(
        "SELECT count(*)::int AS n FROM pilot_enrollments WHERE state NOT IN ('WITHDRAWN','TERMINATED','COMPLETED')",
      );
      if (counted.rows[0].n >= cap) return { ok: false, reason: 'enrollment_full' as const };
      const { rows } = await client.query(
        "INSERT INTO pilot_enrollments (user_id, state, consent_id) VALUES ($1,'PILOT_ACTIVE',$2) RETURNING *",
        [userId, consentId],
      );
      return { ok: true as const, enrollment: enrollRow(rows[0]) };
    });
  },
  async getEnrollment(userId) {
    const { rows } = await query('SELECT * FROM pilot_enrollments WHERE user_id=$1', [userId]);
    return rows[0] ? enrollRow(rows[0]) : null;
  },
  async advanceMachineStateIfRunning(id, fromStates, toState) {
    // `EXISTS (... stopped = false)` and NOT `NOT EXISTS (... stopped)`: a MISSING control row
    // must refuse the write, matching getControl's fail-closed `stopped: true`. The negated
    // form would let an absent singleton wave every advancement through.
    const { rowCount } = await query(
      `UPDATE pilot_enrollments SET state=$3, updated_at=now()
       WHERE id=$1 AND state = ANY($2::text[])
         AND EXISTS (SELECT 1 FROM pilot_control WHERE id = true AND stopped = false)`,
      [id, fromStates as unknown as string[], toState],
    );
    return (rowCount ?? 0) > 0;
  },
  async applyDecisionStateIfActive(id, toState, decisionId) {
    const { rowCount } = await query(
      `UPDATE pilot_enrollments SET state=$2, decision_id=$3, updated_at=now()
       WHERE id=$1 AND state NOT IN ('WITHDRAWN','TERMINATED','COMPLETED')`,
      [id, toState, decisionId],
    );
    return (rowCount ?? 0) > 0;
  },
  async exitEnrollmentIfActive(id, state, decisionId) {
    // One statement: the state precondition is IN the UPDATE, so two concurrent callers
    // cannot both observe an active row and both write.
    const { rowCount } = await query(
      `UPDATE pilot_enrollments SET state=$2, decision_id=COALESCE($3, decision_id), updated_at=now()
       WHERE id=$1 AND state NOT IN ('WITHDRAWN','TERMINATED','COMPLETED')`,
      [id, state, decisionId],
    );
    return (rowCount ?? 0) > 0;
  },
  async insertEventIfActive(userId, enrollmentId, eventType, metadata) {
    const { rows } = await query(
      `INSERT INTO pilot_events (user_id, enrollment_id, event_type, metadata)
       SELECT $1,$2,$3,$4
       WHERE EXISTS (
               SELECT 1 FROM pilot_enrollments
               WHERE id=$2 AND user_id=$1 AND state NOT IN ('WITHDRAWN','TERMINATED','COMPLETED'))
         AND EXISTS (SELECT 1 FROM pilot_control WHERE id = true AND stopped = false)
       RETURNING *`,
      [userId, enrollmentId, eventType, metadata],
    );
    return rows[0] ? eventRow(rows[0]) : null;
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
  async findTermsById(id) {
    const { rows } = await query('SELECT * FROM pilot_terms WHERE id=$1', [id]);
    return rows[0] ? termsRow(rows[0]) : null;
  },
  async listPublishedTerms() {
    const { rows } = await query("SELECT * FROM pilot_terms WHERE status='PUBLISHED' ORDER BY published_at DESC");
    return rows.map(termsRow);
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
  async listPilotWideLifecycleEvents() {
    const { rows } = await query(
      'SELECT * FROM pilot_lifecycle_events WHERE enrollment_id IS NULL ORDER BY created_at ASC',
    );
    return rows.map(lifecycleRow);
  },
};
