/** In-memory PilotRepository for unit tests (mirrors devices/memoryRepository). */
import { randomUUID } from 'node:crypto';
import type { PilotRepository } from './repository';
import type {
  ConsentRecord, HumanDecision, PilotControl, PilotEnrollment, PilotEvent,
  PilotLifecycleEvent, PilotTerms,
} from './types';

export function createMemoryPilotRepository(): PilotRepository & {
  enrollments: Map<string, PilotEnrollment>;
  events: PilotEvent[];
  decisions: HumanDecision[];
  /** Terms registry. EMPTY by default — exactly like the migration, so consent fails closed. */
  terms: PilotTerms[];
  control: PilotControl;
  lifecycle: PilotLifecycleEvent[];
} {
  const consents: ConsentRecord[] = [];
  const enrollments = new Map<string, PilotEnrollment>();
  const events: PilotEvent[] = [];
  const decisions: HumanDecision[] = [];
  const terms: PilotTerms[] = [];
  const lifecycle: PilotLifecycleEvent[] = [];
  // Mirrors the migration's seeded singleton: not stopped, boundary UNDECIDED (null).
  const control: PilotControl = { stopped: false, stopActorId: null, stopReason: null, stopAt: null, maxParticipants: null };
  const now = () => new Date().toISOString();
  return {
    enrollments,
    events,
    decisions,
    terms,
    control,
    lifecycle,
    async recordConsent(userId, version, boundTerms) {
      const c: ConsentRecord = {
        id: randomUUID(), userId, version, createdAt: now(),
        termsId: boundTerms?.id ?? null, termsDigest: boundTerms?.digest ?? null,
      };
      consents.push(c);
      return c;
    },
    async latestConsent(userId) {
      return [...consents].reverse().find((c) => c.userId === userId) ?? null;
    },
    async createEnrollment(userId, consentId) {
      const e: PilotEnrollment = {
        id: randomUUID(),
        userId,
        state: 'PILOT_ACTIVE',
        consentId,
        decisionId: null,
        startedAt: now(),
        updatedAt: now(),
      };
      enrollments.set(userId, e);
      return e;
    },
    async createEnrollmentWithinBoundary(userId, consentId) {
      // The memory analogue of the SQL row lock: count and insert with NO await between
      // them, so no other caller can interleave inside the critical section.
      const cap = control.maxParticipants;
      if (cap === null) return null;
      let active = 0;
      for (const e of enrollments.values())
        if (e.state !== 'WITHDRAWN' && e.state !== 'TERMINATED' && e.state !== 'COMPLETED') active += 1;
      if (active >= cap) return null;
      const e: PilotEnrollment = {
        id: randomUUID(), userId, state: 'PILOT_ACTIVE', consentId,
        decisionId: null, startedAt: now(), updatedAt: now(),
      };
      enrollments.set(userId, e);
      return e;
    },
    async getEnrollment(userId) {
      return enrollments.get(userId) ?? null;
    },
    async setEnrollmentState(id, state, decisionId) {
      for (const e of enrollments.values())
        if (e.id === id) Object.assign(e, { state, decisionId: decisionId ?? e.decisionId, updatedAt: now() });
    },
    async insertEvent(userId, enrollmentId, eventType, metadata) {
      const ev: PilotEvent = { id: randomUUID(), userId, enrollmentId, eventType, metadata, createdAt: now() };
      events.push(ev);
      return ev;
    },
    async listEvents(enrollmentId) {
      return events.filter((e) => e.enrollmentId === enrollmentId);
    },
    async insertDecision(d) {
      const rec: HumanDecision = { ...d, id: randomUUID(), createdAt: now() };
      decisions.push(rec);
      return rec;
    },
    async findDecision(id) {
      return decisions.find((d) => d.id === id) ?? null;
    },
    async findTerms(version) {
      return terms.find((t) => t.version === version) ?? null;
    },
    async listPublishedTerms() {
      return terms
        .filter((t) => t.status === 'PUBLISHED')
        .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
    },
    async getControl() {
      return { ...control };
    },
    async setStopped(stopped, actorId, reason) {
      control.stopped = stopped;
      control.stopActorId = stopped ? actorId : null;
      control.stopReason = stopped ? reason : null;
      control.stopAt = stopped ? now() : null;
    },
    async countActiveEnrollments() {
      let n = 0;
      for (const e of enrollments.values())
        if (e.state !== 'WITHDRAWN' && e.state !== 'TERMINATED' && e.state !== 'COMPLETED') n += 1;
      return n;
    },
    async insertLifecycleEvent(e) {
      const rec: PilotLifecycleEvent = { ...e, id: randomUUID(), createdAt: now() };
      lifecycle.push(rec);
      return rec;
    },
    async listLifecycleEvents(enrollmentId) {
      return lifecycle.filter((e) => e.enrollmentId === enrollmentId);
    },
    async listPilotWideLifecycleEvents() {
      return lifecycle.filter((e) => e.enrollmentId === null);
    },
  };
}
