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
import { EXITED_STATES, HUMAN_DECISION_STATES, PILOT_EVENT_TYPES, PilotError } from './types';
import { isPermitted, ownAuthority, resolveAuthority, type AuthorityEvaluator } from './authority';
import type { HumanDecision, PilotControl, PilotControlPublic, PilotTerms, PilotEnrollment, PilotEvent, PilotEventType, PilotLifecycleEvent, PilotState } from './types';
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

/**
 * C-05. Consent binds to an AUTHORITATIVE TERMS OBJECT, never to a browser-supplied string.
 *
 * Before this, `version` was whatever the client sent — the server accepted any string of
 * 1..64 characters and stored it as the record of what the participant agreed to, while the
 * one version the UI sent ('pilot-terms-draft-v1') named no document anywhere in the
 * repository. A consent record could not be reconstructed against anything.
 *
 * The registry ships EMPTY, so every version is unknown and consent fails closed until a
 * human publishes real terms. That is the intended state, not a gap.
 */
export async function recordConsent(deps: PilotServiceDeps, userId: string, version: string) {
  const terms = await deps.repo.findTerms(version);
  if (!terms)
    throw new PilotError('terms_unknown', `No pilot terms are published under version '${version}'.`);
  if (terms.status !== 'PUBLISHED')
    throw new PilotError('terms_not_published', `Pilot terms '${version}' are ${terms.status}, not PUBLISHED.`);
  return deps.repo.recordConsent(userId, version, terms);
}

/**
 * Enrollment now passes four governance gates before the original two.
 *
 * Order matters and is deliberate: the pilot-wide gates come first, so a stopped pilot or an
 * undecided boundary refuses BEFORE any per-user record is read. A refusal therefore cannot
 * be used to probe whether a given account has consented.
 *
 * `maxParticipants === null` means the boundary is UNDECIDED, and that REFUSES. It does not
 * mean unlimited. No number is invented here; the cap is a human decision
 * (NP-PILOT-FIRST-004, HUMAN_DECISION_REQUIRED) and the code enforces whatever is approved.
 */
export async function enroll(deps: PilotServiceDeps, userId: string): Promise<PilotEnrollment> {
  const control = await deps.repo.getControl();
  if (control.stopped)
    throw new PilotError('pilot_stopped', 'The pilot is stopped; new enrollment is not accepted.');
  if (control.maxParticipants === null)
    throw new PilotError(
      'enrollment_boundary_undecided',
      'No approved enrollment boundary exists for this pilot, so enrollment is withheld.',
    );

  const consent = await deps.repo.latestConsent(userId);
  if (!consent) throw new PilotError('consent_required', 'Record consent before enrolling in the pilot.');
  if (!consent.termsId)
    throw new PilotError('consent_not_bound', 'The recorded consent is not bound to a published terms version.');

  /*
   * THE BOUND TERMS ARE RE-READ AND COMPARED, NOT MERELY COPIED.
   *
   * NP-PILOT-FIRST-005 measured the hole: a consent recorded against terms whose content then
   * CHANGED under the same version still enrolled — ADMITTED at PILOT_ACTIVE, and the
   * evidence read-back reported IN_PILOT with zero deviations. `terms_digest` was written at
   * consent time and compared by nothing, so it documented a claim instead of enforcing one.
   * `pilot_terms` has no immutability trigger, so rewriting a digest is one UPDATE.
   *
   * That is the same write-only shape this module already fixed once for `insertDecision`,
   * one field away: `terms_id` was written and never read BY ID.
   *
   * Resolution is BY ID, deliberately. Resolving by version would answer "whatever row
   * currently answers to that string", which is exactly the question a re-published registry
   * gets wrong. Three things must still hold at admission, not merely at consent:
   *   the bound row still exists; it is still PUBLISHED; and its digest is unchanged.
   */
  const boundTerms = await deps.repo.findTermsById(consent.termsId);
  if (!boundTerms)
    throw new PilotError(
      'terms_unknown',
      'The terms this consent is bound to are no longer in the registry, so the consent cannot be honoured.',
    );
  if (boundTerms.status !== 'PUBLISHED')
    throw new PilotError(
      'terms_no_longer_published',
      `The terms this consent is bound to are now ${boundTerms.status}, not PUBLISHED.`,
    );
  if (consent.termsDigest !== boundTerms.digest)
    throw new PilotError(
      'terms_digest_mismatch',
      'The terms have changed since this consent was recorded, so the consent does not cover the current document.',
    );

  const existing = await deps.repo.getEnrollment(userId);
  if (existing) throw new PilotError('already_enrolled', 'A pilot enrollment already exists for this account.');

  // THE BOUNDARY IS ENFORCED BY THE WRITE, NOT BY A PRECEDING READ. Counting first and
  // inserting second is read-then-write: two enrollments that begin before either finishes
  // both see room and both are admitted. A cap of one admitted two until this was atomic.
  const admission = await deps.repo.createEnrollmentWithinBoundary(userId, consent.id);
  if (!admission.ok) {
    // The REASON comes from inside the transaction, not from the `control` read at the top of
    // this function. NP-007: a STOP committing between that read and this write was admitted,
    // and then reported as `enrollment_full` — a refusal that named the wrong cause.
    if (admission.reason === 'pilot_stopped')
      throw new PilotError('pilot_stopped', 'The pilot is stopped; new enrollment is not accepted.');
    if (admission.reason === 'enrollment_boundary_undecided')
      throw new PilotError(
        'enrollment_boundary_undecided',
        'No approved enrollment boundary exists for this pilot, so enrollment is withheld.',
      );
    throw new PilotError('enrollment_full', 'The approved enrollment boundary for this pilot has been reached.');
  }
  return admission.enrollment;
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
  if ((EXITED_STATES as readonly string[]).includes(e.state))
    throw new PilotError('already_exited', `This participation is ${e.state}; no further pilot activity is accepted.`);
  const control = await deps.repo.getControl();
  if (control.stopped)
    throw new PilotError('pilot_stopped', 'The pilot is stopped; no further pilot activity is accepted.');
  // The two guards above read state; this write re-asserts both. A STOP or a withdrawal
  // committing in the gap loses nothing here — the insert simply does not happen.
  const ev = await deps.repo.insertEventIfActive(userId, e.id, eventType as PilotEventType, metadata);
  if (!ev)
    throw new PilotError(
      'already_exited',
      'This participation is no longer accepting activity; it has exited or the pilot is stopped.',
    );
  return ev;
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
  // THE HISTORICAL CLAIM BELOW IS UNVERIFIED AND APPEARS TO BE FALSE — kept visible rather
  // than deleted, because a later reader could otherwise cite it as an established fact about
  // what this code used to do. NP-PILOT-FIRST-005 searched all 7 revisions of this file
  // reachable from every ref in this clone: ZERO contain an actor/subject equality comparison
  // (positive controls on the same loop: `applyHumanDecision` in 7/7, `resolveAuthority` in
  // 6/7). In the one revision predating the authority guard there was no guard here AT ALL —
  // the true prior state was WEAKER than the claim describes, not stronger. Search-space
  // caveat: a guard living in another repository or an unfetched branch is invisible to this.
  //
  //   SUPERSEDED: "The previous guard refused only when actor === subject. That made
  //   enforcement an incidental consequence of the router passing one id twice: a SEPARATED
  //   actor with no authority passed straight through and wrote both rows."
  //
  // The sentence that followed it is independently true and still governs:
  // SEPARATION IS A PROPERTY, NOT A PERMISSION.
  //
  // This guard asks the authority question instead, and withholds unless the answer is
  // an explicit ALLOW. No evaluator is configured in production, so the answer is
  // UNKNOWN and every caller is refused — separated or not. That grants authority to
  // no one. Placed before the value-domain check and before any repository read, so the
  // refusal path performs zero reads and cannot be used as a state-name oracle.
  //
  // `targetState` IS PASSED, AND IT MATTERS BEFORE A DESIGNATION EXISTS RATHER THAN AFTER.
  // Without it the evaluator is only asked "may this actor record a decision about this
  // subject?", so a single ALLOW would authorise EVERY state in HUMAN_DECISION_STATES — an
  // evaluator could not permit COMPLETED while refusing PAID_PENDING_HUMAN_DECISION, because
  // it would never learn which was being asked. Adding the field changes nothing today (no
  // evaluator reads it), which is precisely why it is safe now and would be a breaking change
  // to introduce once someone is designated and their evaluator is written.
  const authority = resolveAuthority(ownAuthority(deps), {
    actorId,
    subjectId: subjectUserId,
    action: 'pilot.decision.record',
    targetId: subjectUserId,
    targetState,
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

  /*
   * AN EXITED PARTICIPATION CANNOT BE DECIDED ABOUT — the guard its two siblings had and this
   * path did not.
   *
   * MEASURED before the fix: withdraw() a participation, then apply a CONTINUE decision with
   * a designated evaluator, and the state became CONTINUE and the participant could record
   * events again. A participant who left was put back. `withdraw` and `terminateParticipation`
   * both call `requireExitable`; this one read the row and never checked it, which is why the
   * comment two functions down claiming "a withdrawn participation cannot silently return to
   * active" was true of the machine and false of the decision path.
   *
   * Reinstatement may be a thing this pilot eventually wants. If so it needs its own named
   * operation and its own authority question, not an outcome decision that happens to land on
   * a closed participation.
   */
  if ((EXITED_STATES as readonly string[]).includes(e.state))
    throw new PilotError(
      'already_exited',
      `This participation is ${e.state}; no further outcome decision is accepted.`,
    );

  const rec = await deps.repo.insertDecision({
    actorId,
    decisionType: 'commercial',
    subject: `pilot_enrollment:${e.id}`,
    decision: `${targetState}: ${decision}`,
    reason,
  });
  // Captured BEFORE the write. `applyDecisionStateIfActive` mutates the row in place in the in-memory
  // repository, so reading `e.state` afterwards would report the NEW state as the previous
  // one — which is how this was caught. Relying on a repository not to alias its rows is a
  // property no interface here promises.
  const stateBeforeDecision = e.state;

  // NP-007 DEFECT-3: this was an unconditional write guarded by a state read taken before the
  // decision row was inserted, so a decision racing a withdrawal overwrote the exit in 100/100
  // trials. The exited-state predicate now lives in the UPDATE.
  if (!(await deps.repo.applyDecisionStateIfActive(e.id, targetState as PilotState, rec.id)))
    throw new PilotError(
      'already_exited',
      'This participation exited before the decision could be recorded; no outcome was applied.',
    );

  /*
   * A COMPLETION IS AN EXIT, AND THE LEDGER OF EXITS MUST CONTAIN IT.
   *
   * `pilot_lifecycle_events` was introduced as "an append-only record of every lifecycle
   * exit", but its `kind` vocabulary admitted only WITHDRAWAL / TERMINATION / STOP / RESUME —
   * so COMPLETED, which `EXITED_STATES` lists alongside the other two and which is the one
   * exit a 30-day pilot exists to produce, was NOT EXPRESSIBLE. It had to be inferred from a
   * state literal on the enrollment row, which is exactly the inference the ledger was built
   * to remove. Migration 0017 widens the vocabulary; this writes the row.
   *
   * Only COMPLETED gets one. The other human-decision states (CONTINUE, EXTENDED,
   * PAID_PENDING_HUMAN_DECISION, INSTITUTIONAL_PENDING, STOPPED) are outcomes that do not end
   * the participation, and inventing exit rows for them would overstate what happened.
   */
  if (targetState === 'COMPLETED')
    await deps.repo.insertLifecycleEvent({
      enrollmentId: e.id,
      subjectUserId,
      actorUserId: actorId,
      kind: 'COMPLETION',
      previousState: stateBeforeDecision,
      newState: 'COMPLETED',
      reason,
    });

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

  /*
   * THE MACHINE DOES NOT WRITE WHILE THE PILOT IS STOPPED.
   *
   * MEASURED before this guard: with the pilot stopped, GET /pilot/status still advanced a
   * participation all the way to DAY30_READY. A stop refuses new participant activity, so the
   * pilot was advancing people through a period in which they were forbidden to take part.
   *
   * THIS FREEZES THE WRITES, NOT THE CLOCK, and the difference is deliberate. `pilotDay` is
   * wall-clock arithmetic over `startedAt`; on resume the machine will advance to whatever day
   * it now is. WHETHER STOPPED TIME COUNTS TOWARD THE 30 DAYS IS A HUMAN DECISION
   * (decisions/HUMAN-DECISION-G5-STOP-AUTHORITY.md) and subtracting stop intervals here would
   * be inventing that answer. Not writing is the conservative half that needs no decision.
   */
  const control = await deps.repo.getControl();
  if (control.stopped) return e;

  // An exited participation is terminal: the machine never advances out of WITHDRAWN,
  // TERMINATED or COMPLETED, so a withdrawn participant cannot be returned to the clock.
  if ((EXITED_STATES as readonly string[]).includes(e.state)) return e;
  /*
   * THE TWO GUARDS ABOVE ARE FAST PATHS, NOT THE ENFORCEMENT.
   *
   * NP-PILOT-FIRST-007 measured the difference over real HTTP. Both guards test values read
   * before an `await`; the write that followed asserted neither. A participant's own
   * `GET /pilot/status` racing their `POST /pilot/withdraw` revived them in 36-39% of 100
   * trials — 201 "withdrawn", then back in the pilot and able to submit data again — and a
   * committed STOP did not bind an advancement already in flight.
   *
   * The enforcement is now the UPDATE's own predicate: it names the states it may move FROM
   * and requires the pilot to be running, so a withdrawal or STOP that commits in the gap
   * makes the write match zero rows. Losing that race is not an error — it means someone
   * else's decision arrived first, which is precisely the outcome the machine must respect.
   */
  if (day >= 30)
    await deps.repo.advanceMachineStateIfRunning(e.id, ['PILOT_ACTIVE', 'DAY7_READY'], 'DAY30_READY');
  else if (day >= 7) await deps.repo.advanceMachineStateIfRunning(e.id, ['PILOT_ACTIVE'], 'DAY7_READY');
  return deps.repo.getEnrollment(userId);
}

/* ==========================================================================================
 * C-03 — WITHDRAWAL AND TERMINATION
 *
 * Three distinct exits, never collapsed:
 *   WITHDRAWN   the participant chose to leave          — self-service, no authority needed
 *   TERMINATED  an operator ended this participation    — authority-gated
 *   COMPLETED   the pilot finished                      — reached via applyHumanDecision
 *
 * Both exits here are TERMINAL, and NP-PILOT-FIRST-005 had to make that true of every path
 * rather than of most of them: `applyHumanDecision` had no exited-state guard, so a
 * designated authority could put a withdrawn participant back to CONTINUE and they could
 * record events again. The machine was innocent; the decision path was not.
 * ========================================================================================== */

async function requireExitable(deps: PilotServiceDeps, subjectUserId: string): Promise<PilotEnrollment> {
  const e = await deps.repo.getEnrollment(subjectUserId);
  if (!e) throw new PilotError('not_enrolled', 'No pilot enrollment for this account.');
  if ((EXITED_STATES as readonly string[]).includes(e.state))
    throw new PilotError('already_exited', `This participation is already ${e.state}.`);
  return e;
}

/**
 * A participant withdraws from their OWN participation.
 *
 * Deliberately NOT authority-gated: requiring a designated operator to let someone leave
 * would make withdrawal unavailable for exactly as long as the operator designation is
 * missing — which is now. A participant leaving their own pilot is not a consequential
 * action against anyone else.
 */
export async function withdraw(
  deps: PilotServiceDeps,
  userId: string,
  reason: string,
): Promise<{ enrollment: PilotEnrollment; event: PilotLifecycleEvent }> {
  const e = await requireExitable(deps, userId);
  const previousState = e.state;

  // THE STATE CHANGE GOES FIRST, AND IT IS A COMPARE-AND-SET. `requireExitable` above is a
  // courtesy that produces a clean error for the ordinary case; it is NOT what makes the exit
  // safe, because a read cannot. Losing the race here means someone else exited this
  // participation first, and the answer is the same as if we had seen it: already_exited.
  // Writing the ledger row only after the CAS succeeds is what stops two concurrent
  // withdrawals from both appearing in the ledger, each claiming to have left an active
  // participation.
  if (!(await deps.repo.exitEnrollmentIfActive(e.id, 'WITHDRAWN', null)))
    throw new PilotError('already_exited', `This participation is already exited.`);

  const event = await deps.repo.insertLifecycleEvent({
    enrollmentId: e.id, subjectUserId: userId, actorUserId: userId,
    kind: 'WITHDRAWAL', previousState, newState: 'WITHDRAWN', reason,
  });
  return { enrollment: (await deps.repo.getEnrollment(userId))!, event };
}

/**
 * An operator ends ANOTHER participant's participation. Authority-gated exactly like
 * applyHumanDecision: the predicate is asked before any state is written, production
 * supplies no evaluator, so this is refused until someone is designated.
 */
export async function terminateParticipation(
  deps: PilotServiceDeps,
  actorId: string,
  subjectUserId: string,
  reason: string,
): Promise<{ enrollment: PilotEnrollment; event: PilotLifecycleEvent }> {
  const authority = resolveAuthority(ownAuthority(deps), {
    actorId, subjectId: subjectUserId, action: 'pilot.participation.terminate', targetId: subjectUserId,
  });
  if (!isPermitted(authority))
    throw new PilotError(
      'human_decision_required',
      `Terminating a participation requires a designated pilot authority. Authority is ${authority}; none is designated, so this operation is withheld.`,
    );
  const e = await requireExitable(deps, subjectUserId);
  const previousState = e.state;

  // Same compare-and-set as withdrawal, and for a sharper reason: measured before the fix, a
  // withdrawal racing a termination left a ledger asserting that an operator ended a
  // participation the participant had already left. The three distinct exits are the whole
  // point of C-03, and a race that produces two of them at once erases the distinction.
  if (!(await deps.repo.exitEnrollmentIfActive(e.id, 'TERMINATED', null)))
    throw new PilotError('already_exited', `This participation is already exited.`);

  const event = await deps.repo.insertLifecycleEvent({
    enrollmentId: e.id, subjectUserId, actorUserId: actorId,
    kind: 'TERMINATION', previousState, newState: 'TERMINATED', reason,
  });
  return { enrollment: (await deps.repo.getEnrollment(subjectUserId))!, event };
}

/* ==========================================================================================
 * C-04 — PILOT STOP
 *
 * A pilot-scoped stop. It refuses new enrollment and new participant activity while leaving
 * every other backend route serving — stopping the pilot is NOT stopping the service, and the
 * previous practical options (take down the backend, or edit the database by hand) were
 * neither auditable nor pilot-scoped.
 *
 * Evidence is preserved: nothing is deleted, and the stop itself is recorded with actor,
 * reason and time. Resume is a separate authority-gated act, so a stopped pilot never
 * restarts silently.
 * ========================================================================================== */

export async function stopPilot(deps: PilotServiceDeps, actorId: string, reason: string): Promise<PilotControl> {
  const authority = resolveAuthority(ownAuthority(deps), {
    actorId, subjectId: actorId, action: 'pilot.stop',
  });
  if (!isPermitted(authority))
    throw new PilotError(
      'human_decision_required',
      `Stopping the pilot requires a designated pilot authority. Authority is ${authority}; none is designated, so this operation is withheld.`,
    );
  /**
   * A REPEATED STOP PRESERVES THE FIRST STOP'S RECORD.
   *
   * Writing again would overwrite stop_actor_id / stop_reason / stop_at with the second
   * caller's, silently replacing the authority record for WHY AND BY WHOM the pilot was
   * stopped — the one fact a stop exists to preserve. So a second stop is a no-op that
   * returns the standing control unchanged.
   *
   * The authority check above still runs first, so an UNAUTHORIZED repeat is still refused
   * rather than quietly succeeding because the pilot happened to be stopped already.
   */
  const current = await deps.repo.getControl();
  if (current.stopped) return current;

  await deps.repo.insertLifecycleEvent({
    enrollmentId: null, subjectUserId: null, actorUserId: actorId,
    kind: 'STOP', previousState: 'PILOT_ACTIVE', newState: 'STOPPED', reason,
  });
  await deps.repo.setStopped(true, actorId, reason);
  return deps.repo.getControl();
}

/** Resume is its own authority question, so recovery is never an accident of the stop path. */
export async function resumePilot(deps: PilotServiceDeps, actorId: string, reason: string): Promise<PilotControl> {
  const authority = resolveAuthority(ownAuthority(deps), {
    actorId, subjectId: actorId, action: 'pilot.resume',
  });
  if (!isPermitted(authority))
    throw new PilotError(
      'human_decision_required',
      `Resuming the pilot requires a designated pilot authority. Authority is ${authority}; none is designated, so this operation is withheld.`,
    );
  // Symmetrically: resuming a pilot that is not stopped records nothing, so the ledger never
  // carries a RESUME that resumed nothing.
  const current = await deps.repo.getControl();
  if (!current.stopped) return current;

  await deps.repo.insertLifecycleEvent({
    enrollmentId: null, subjectUserId: null, actorUserId: actorId,
    kind: 'RESUME', previousState: 'STOPPED', newState: 'PILOT_ACTIVE', reason,
  });
  await deps.repo.setStopped(false, null, null);
  return deps.repo.getControl();
}

/**
 * The pilot-wide control state, REDACTED BY DEFAULT.
 *
 * NP-PILOT-FIRST-005 found this route returning the full row - `stop_actor_id` and
 * `stop_reason` included - to any signed-in caller. That contradicted this programme's own
 * stated position: the pilot-wide stop HISTORY was deliberately left unexposed because "who may
 * see who stopped the pilot and why is a disclosure question no human has decided", while the
 * CURRENT stop was disclosing exactly that through a different door.
 *
 * The inconsistency is resolved in the conservative direction, because an undecided disclosure
 * must default to non-disclosure: an ordinary caller learns only WHETHER the pilot is stopped,
 * which is what explains the refusal they just received. The full row requires authority, and
 * production designates none - so today every caller gets the redacted view.
 */
export async function pilotControl(
  deps: PilotServiceDeps,
  actorId: string,
): Promise<PilotControl | PilotControlPublic> {
  const control = await deps.repo.getControl();
  const authority = resolveAuthority(ownAuthority(deps), {
    actorId, subjectId: actorId, action: 'pilot.control.read',
  });
  return isPermitted(authority) ? control : { stopped: control.stopped };
}

/**
 * What a participant may be asked to agree to.
 *
 * A surface must never present a version string it invented. The registry ships EMPTY, so
 * this returns [] and a surface that renders it honestly shows "no terms are published" and
 * offers no consent button — which is the correct state until a human publishes real terms.
 *
 * This is a READ. Publishing terms is a human act and no code path here performs it.
 */
export async function publishedTerms(deps: PilotServiceDeps): Promise<PilotTerms[]> {
  return deps.repo.listPublishedTerms();
}
