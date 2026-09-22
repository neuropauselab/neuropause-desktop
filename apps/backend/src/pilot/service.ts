/**
 * Pilot lifecycle service — pure logic over an injected PilotRepository.
 *
 * Governance invariants enforced here, not in the UI:
 *  - enrollment requires a recorded consent (consent_required);
 *  - one enrollment per user (already_enrolled);
 *  - events never change lifecycle state;
 *  - every outcome state (CONTINUE / PAID_PENDING_HUMAN_DECISION / INSTITUTIONAL_PENDING /
 *    EXTENDED / STOPPED / COMPLETED) is reachable ONLY through applyHumanDecision, which
 *    requires a recorded human decision — there is no machine path to paid conversion.
 */
import { HUMAN_DECISION_STATES, PILOT_EVENT_TYPES, PilotError } from './types';
import { isPermitted, ownAuthority, resolveAuthority, type AuthorityEvaluator } from './authority';
import type { HumanDecision, PilotEnrollment, PilotEvent, PilotEventType, PilotState } from './types';
import type { PilotRepository } from './repository';

export interface PilotServiceDeps {
  repo: PilotRepository;
  /**
   * Optional decision-authority evaluator. Production supplies none, so
   * resolveAuthority yields UNKNOWN and consequential operations fail closed.
   * Supplying one that returns ALLOW is a DESIGNATION and requires MR-04.
   */
  authority?: AuthorityEvaluator;
}

const DAY_MS = 86_400_000;

export function pilotDay(e: PilotEnrollment, at = Date.now()): number {
  return Math.floor((at - new Date(e.startedAt).getTime()) / DAY_MS) + 1;
}

export async function recordConsent(deps: PilotServiceDeps, userId: string, version: string) {
  return deps.repo.recordConsent(userId, version);
}

export async function enroll(deps: PilotServiceDeps, userId: string): Promise<PilotEnrollment> {
  const consent = await deps.repo.latestConsent(userId);
  if (!consent) throw new PilotError('consent_required', 'Record consent before enrolling in the pilot.');
  const existing = await deps.repo.getEnrollment(userId);
  if (existing) throw new PilotError('already_enrolled', 'A pilot enrollment already exists for this account.');
  return deps.repo.createEnrollment(userId, consent.id);
}

export async function recordEvent(
  deps: PilotServiceDeps,
  userId: string,
  eventType: string,
  metadata: Record<string, unknown>,
): Promise<PilotEvent> {
  if (!(PILOT_EVENT_TYPES as readonly string[]).includes(eventType))
    throw new PilotError('invalid_event', `Unknown pilot event type: ${eventType}`);
  const e = await deps.repo.getEnrollment(userId);
  if (!e) throw new PilotError('not_enrolled', 'No pilot enrollment for this account.');
  return deps.repo.insertEvent(userId, e.id, eventType as PilotEventType, metadata);
}

export interface PilotStatus {
  enrollment: PilotEnrollment | null;
  consentVersion: string | null;
  day: number | null;
  day7Ready: boolean;
  eventCount: number;
}

export async function status(deps: PilotServiceDeps, userId: string): Promise<PilotStatus> {
  const consent = await deps.repo.latestConsent(userId);
  const e = await deps.repo.getEnrollment(userId);
  if (!e) return { enrollment: null, consentVersion: consent?.version ?? null, day: null, day7Ready: false, eventCount: 0 };
  const events = await deps.repo.listEvents(e.id);
  const day = pilotDay(e);
  return { enrollment: e, consentVersion: consent?.version ?? null, day, day7Ready: day >= 7, eventCount: events.length };
}

export interface Day7Report {
  day: number;
  activeDays: number;
  eventCounts: Record<string, number>;
  feedback: Array<Record<string, unknown>>;
  crashes: 'NOT_MEASURABLE';
  osUsage: 'NOT_MEASURABLE';
  state: PilotState;
}

export async function day7Report(deps: PilotServiceDeps, userId: string): Promise<Day7Report> {
  const e = await deps.repo.getEnrollment(userId);
  if (!e) throw new PilotError('not_enrolled', 'No pilot enrollment for this account.');
  const events = await deps.repo.listEvents(e.id);
  const eventCounts: Record<string, number> = {};
  const days = new Set<string>();
  const feedback: Array<Record<string, unknown>> = [];
  for (const ev of events) {
    eventCounts[ev.eventType] = (eventCounts[ev.eventType] ?? 0) + 1;
    days.add(ev.createdAt.slice(0, 10));
    if (ev.eventType === 'feedback_submitted') feedback.push(ev.metadata);
  }
  // Metrics the current system cannot produce are NOT_MEASURABLE, never zero.
  return { day: pilotDay(e), activeDays: days.size, eventCounts, feedback, crashes: 'NOT_MEASURABLE', osUsage: 'NOT_MEASURABLE', state: e.state };
}

export async function applyHumanDecision(
  deps: PilotServiceDeps,
  actorId: string,
  subjectUserId: string,
  targetState: string,
  decision: string,
  reason: string,
): Promise<{ decision: HumanDecision; enrollment: PilotEnrollment }> {
  // Fail-closed on the AUTHORITY PREDICATE, not on actor/subject equality.
  //
  // The previous guard refused only when actor === subject. That made enforcement an
  // incidental consequence of the router passing one id twice: a SEPARATED actor with
  // no authority passed straight through and wrote both rows. Separation is a property,
  // not a permission.
  //
  // This guard asks the authority question instead, and withholds unless the answer is
  // an explicit ALLOW. No evaluator is configured in production, so the answer is
  // UNKNOWN and every caller is refused — separated or not. That grants authority to
  // no one. Placed before the value-domain check and before any repository read, so the
  // refusal path performs zero reads and cannot be used as a state-name oracle.
  const authority = resolveAuthority(ownAuthority(deps), {
    actorId,
    subjectId: subjectUserId,
    action: 'pilot.decision.record',
    targetId: subjectUserId,
  });
  if (!isPermitted(authority))
    throw new PilotError(
      'human_decision_required',
      `A pilot outcome decision requires a designated decision authority. Authority is ${authority}; no decision authority is designated, so this operation is withheld.`,
    );
  if (!(HUMAN_DECISION_STATES as readonly string[]).includes(targetState))
    throw new PilotError('invalid_decision', `Not a human-decision outcome state: ${targetState}`);
  const e = await deps.repo.getEnrollment(subjectUserId);
  if (!e) throw new PilotError('not_enrolled', 'No pilot enrollment for this account.');
  const rec = await deps.repo.insertDecision({
    actorId,
    decisionType: 'commercial',
    subject: `pilot_enrollment:${e.id}`,
    decision: `${targetState}: ${decision}`,
    reason,
  });
  await deps.repo.setEnrollmentState(e.id, targetState as PilotState, rec.id);
  const updated = await deps.repo.getEnrollment(subjectUserId);
  return { decision: rec, enrollment: updated! };
}

/**
 * The ONLY machine-driven state transitions. Outcome states remain unreachable here
 * by design — the machine advances the CLOCK, never the OUTCOME.
 *
 *   PILOT_ACTIVE  --day>=7-->   DAY7_READY
 *   PILOT_ACTIVE  --day>=30-->  DAY30_READY   (a participant who never checked in)
 *   DAY7_READY    --day>=30-->  DAY30_READY
 *   DAY30_READY                 terminal for the machine
 *   any human-decision state    never touched by the machine
 *
 * DAY7_READY IS AN ELIGIBLE SOURCE FOR THE DAY-30 TRANSITION, AND THAT IS THE FIX.
 *
 * Previously both branches required `state === 'PILOT_ACTIVE'`, so DAY7_READY was a
 * machine dead end: once it was set, day>=30 could never fire. Because `/pilot/status`
 * calls this on every request and the web page polls status on load, ANY single check-in
 * between day 7 and day 29 permanently foreclosed DAY30_READY. The 30-day lifecycle was
 * reachable only by a participant who never looked at it — participation suppressed
 * completion, which inverts the intent. Measured and recorded as C-01 in
 * NP-PILOT-FIRST-003.
 *
 * Order still matters: the day>=30 test is evaluated first so that a lapsed PILOT_ACTIVE
 * enrollment lands directly on DAY30_READY rather than stepping through DAY7_READY on a
 * clock that has already passed both thresholds.
 */
export async function advanceMachineStates(deps: PilotServiceDeps, userId: string): Promise<PilotEnrollment | null> {
  const e = await deps.repo.getEnrollment(userId);
  if (!e) return null;
  const day = pilotDay(e);
  const machineAdvanceable = e.state === 'PILOT_ACTIVE' || e.state === 'DAY7_READY';
  if (machineAdvanceable && day >= 30) await deps.repo.setEnrollmentState(e.id, 'DAY30_READY', null);
  else if (e.state === 'PILOT_ACTIVE' && day >= 7) await deps.repo.setEnrollmentState(e.id, 'DAY7_READY', null);
  return deps.repo.getEnrollment(userId);
}
