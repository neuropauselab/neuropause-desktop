/** In-memory PilotRepository for unit tests (mirrors devices/memoryRepository). */
import { randomUUID } from 'node:crypto';
import type { PilotRepository } from './repository';
import type { ConsentRecord, HumanDecision, PilotEnrollment, PilotEvent } from './types';

export function createMemoryPilotRepository(): PilotRepository & {
  enrollments: Map<string, PilotEnrollment>;
  events: PilotEvent[];
  decisions: HumanDecision[];
} {
  const consents: ConsentRecord[] = [];
  const enrollments = new Map<string, PilotEnrollment>();
  const events: PilotEvent[] = [];
  const decisions: HumanDecision[] = [];
  const now = () => new Date().toISOString();
  return {
    enrollments,
    events,
    decisions,
    async recordConsent(userId, version) {
      const c = { id: randomUUID(), userId, version, createdAt: now() };
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
  };
}
