import { describe, expect, it } from 'vitest';
import { createMemoryPilotRepository } from './memoryRepository';
import { seedPilotFixtures, TEST_TERMS_VERSION } from './testFixtures';
import { advanceMachineStates, applyHumanDecision, day7Report, enroll, pilotDay, recordConsent, recordEvent, status } from './service';
import { HUMAN_DECISION_STATES, PilotError } from './types';
import { NO_AUTHORITY_CONFIGURED, ownAuthority, resolveAuthority } from './authority';

const U = 'user-1';

describe('pilot lifecycle service', () => {
  it('refuses enrollment without consent', async () => {
    const repo = createMemoryPilotRepository();
    seedPilotFixtures(repo);
    const deps = { repo };
    await expect(enroll(deps, U)).rejects.toMatchObject({ code: 'consent_required' });
  });

  it('consent -> enroll -> status day 1, and duplicate enrollment is refused', async () => {
    const repo = createMemoryPilotRepository();
    seedPilotFixtures(repo);
    const deps = { repo };
    await recordConsent(deps, U, TEST_TERMS_VERSION);
    const e = await enroll(deps, U);
    expect(e.state).toBe('PILOT_ACTIVE');
    await expect(enroll(deps, U)).rejects.toMatchObject({ code: 'already_enrolled' });
    const s = await status(deps, U);
    expect(s.day).toBe(1);
    expect(s.day7Ready).toBe(false);
    expect(s.consentVersion).toBe(TEST_TERMS_VERSION);
  });

  it('records valid events, rejects unknown types, and events never change state', async () => {
    const repo = createMemoryPilotRepository();
    seedPilotFixtures(repo);
    const deps = { repo };
    await recordConsent(deps, U, TEST_TERMS_VERSION);
    await enroll(deps, U);
    await recordEvent(deps, U, 'session_started', {});
    await recordEvent(deps, U, 'feedback_submitted', { satisfaction: 4, text: 'good' });
    await expect(recordEvent(deps, U, 'become_paid', {})).rejects.toMatchObject({ code: 'invalid_event' });
    expect((await status(deps, U)).enrollment?.state).toBe('PILOT_ACTIVE');
    expect((await status(deps, U)).eventCount).toBe(2);
  });

  it('day-7 report aggregates events and marks unmeasurable metrics NOT_MEASURABLE (never zero)', async () => {
    const repo = createMemoryPilotRepository();
    seedPilotFixtures(repo);
    const deps = { repo };
    await recordConsent(deps, U, TEST_TERMS_VERSION);
    await enroll(deps, U);
    await recordEvent(deps, U, 'session_started', {});
    await recordEvent(deps, U, 'feedback_submitted', { satisfaction: 5 });
    const r = await day7Report(deps, U);
    expect(r.eventCounts.session_started).toBe(1);
    expect(r.feedback).toHaveLength(1);
    expect(r.crashes).toBe('NOT_MEASURABLE');
    expect(r.osUsage).toBe('NOT_MEASURABLE');
  });

  it('GOVERNANCE: machine advancement can only reach DAY7_READY/DAY30_READY, never an outcome state', async () => {
    const repo = createMemoryPilotRepository();
    seedPilotFixtures(repo);
    const deps = { repo };
    await recordConsent(deps, U, TEST_TERMS_VERSION);
    const e = await enroll(deps, U);
    // simulate day 8 by back-dating startedAt
    const rec = deps.repo as ReturnType<typeof createMemoryPilotRepository>;
    rec.enrollments.get(U)!.startedAt = new Date(Date.now() - 8 * 86_400_000).toISOString();
    expect(pilotDay(rec.enrollments.get(U)!)).toBeGreaterThanOrEqual(7);
    const after = await advanceMachineStates(deps, U);
    expect(after?.state).toBe('DAY7_READY');
    expect(HUMAN_DECISION_STATES).not.toContain(after?.state);
    expect(e.decisionId).toBeNull();
  });

  it('GOVERNANCE: every outcome state requires a recorded human decision; invalid targets rejected', async () => {
    // Authority is now evaluated BEFORE the value-domain check, so without an ALLOW the
    // endpoint cannot be used as an oracle enumerating valid state names. This fixture
    // injects a development-only ALLOW to reach the domain check at all.
    // FIXTURE=TRUE ENVIRONMENT=DEVELOPMENT NON_PILOT=TRUE NON_AUTHORITY=TRUE
    const repo = createMemoryPilotRepository();
    seedPilotFixtures(repo);
    const deps = { repo, authority: { evaluate: () => 'ALLOW' as const } };
    await recordConsent(deps, U, TEST_TERMS_VERSION);
    await enroll(deps, U);
    await expect(applyHumanDecision(deps, 'actor-1', U, 'PILOT_ACTIVE', 'x', 'y')).rejects.toMatchObject({
      code: 'invalid_decision',
    });
    const { decision, enrollment } = await applyHumanDecision(
      deps,
      'actor-1',
      U,
      'PAID_PENDING_HUMAN_DECISION',
      'introduce paid plan',
      'Day-7 evidence reviewed by founder',
    );
    expect(enrollment.state).toBe('PAID_PENDING_HUMAN_DECISION');
    expect(enrollment.decisionId).toBe(decision.id);
    expect(repo.decisions).toHaveLength(1);
    expect(repo.decisions[0]!.actorId).toBe('actor-1');
  });

  // NP-ENF-015-022: oracle resistance. Without authority, an INVALID target state is
  // refused with the SAME code as a valid one — the endpoint leaks no membership signal.
  it('NP-ENF-015-022 refusal is indistinguishable for valid and invalid target states', async () => {
    const repo = createMemoryPilotRepository();
    seedPilotFixtures(repo);
    const deps = { repo };
    await recordConsent(deps, U, TEST_TERMS_VERSION);
    await enroll(deps, U);
    const valid = await applyHumanDecision(deps, 'actor-A', U, 'CONTINUE', 'd', 'r').catch((e) => e);
    const invalid = await applyHumanDecision(deps, 'actor-A', U, 'NOT_A_STATE', 'd', 'r').catch((e) => e);
    expect(valid.code).toBe('human_decision_required');
    expect(invalid.code).toBe(valid.code);
  });

  // NP-ENF-015-001/002/003: the authority predicate, not actor/subject equality, is
  // what withholds the operation. BOTH shapes must fail closed.
  it.each([
    ['NP-ENF-015-003 actor === subject', U, U],
    ['NP-ENF-015-002 actor !== subject', 'actor-A', U],
  ])('%s — refused with zero side effects when authority is UNKNOWN', async (_label, actorId, subjectId) => {
    const repo = createMemoryPilotRepository();
    seedPilotFixtures(repo);
    const deps = { repo };
    await recordConsent(deps, U, TEST_TERMS_VERSION);
    await enroll(deps, U);
    const stateBefore = repo.enrollments.get(U)!.state;
    const decisionIdBefore = repo.enrollments.get(U)!.decisionId;

    await expect(
      applyHumanDecision(deps, actorId, subjectId, 'PAID_PENDING_HUMAN_DECISION', 'd', 'r'),
    ).rejects.toMatchObject({ code: 'human_decision_required' });

    // §25 side-effect accounting on the refusal path.
    expect(repo.decisions).toHaveLength(0);
    expect(repo.enrollments.get(U)!.state).toBe(stateBefore);
    expect(repo.enrollments.get(U)!.decisionId).toBe(decisionIdBefore);
  });

  // NP-ENF-015-004..011: nothing that is not an explicit ALLOW may widen the gate.
  // Each evaluator below returns a non-ALLOW answer while carrying the tempting
  // signal in its context; none may permit the write.
  it.each([
    ['NP-ENF-015-004 operator candidate', 'UNKNOWN' as const],
    ['NP-ENF-015-005 admin', 'UNKNOWN' as const],
    ['NP-ENF-015-006 founder', 'UNKNOWN' as const],
    ['NP-ENF-015-007 verifier candidate', 'UNKNOWN' as const],
    ['NP-ENF-015-008 consent granted', 'UNKNOWN' as const],
    ['NP-ENF-015-009 claim exists unadopted', 'UNKNOWN' as const],
    ['NP-ENF-015-010 baseline exists undesignated', 'DENY' as const],
  ])('%s does not manufacture authority', async (_label, answer) => {
    const repo = createMemoryPilotRepository();
    seedPilotFixtures(repo);
    const deps = {
      repo,
      // FIXTURE=TRUE ENVIRONMENT=DEVELOPMENT NON_PILOT=TRUE NON_AUTHORITY=TRUE
      authority: { evaluate: () => answer },
    };
    await recordConsent(deps, U, TEST_TERMS_VERSION);
    await enroll(deps, U);

    await expect(
      applyHumanDecision(deps, 'actor-A', U, 'CONTINUE', 'd', 'r'),
    ).rejects.toMatchObject({ code: 'human_decision_required' });
    expect(repo.decisions).toHaveLength(0);
  });

  // NP-ENF-015-011: a string that merely LOOKS like a designation is not one.
  it('NP-ENF-015-011 a synthetic "MR-04:DESIGNATED:true" string has no authority semantics', async () => {
    const repo = createMemoryPilotRepository();
    seedPilotFixtures(repo);
    const deps = {
      repo,
      authority: {
        evaluate: (ctx: { actorId: string }) =>
          // Deliberately inspects the tempting signal and still refuses.
          ctx.actorId.includes('MR-04:DESIGNATED:true') ? ('UNKNOWN' as const) : ('UNKNOWN' as const),
      },
    };
    await recordConsent(deps, U, TEST_TERMS_VERSION);
    await enroll(deps, U);

    await expect(
      applyHumanDecision(deps, 'MR-04:DESIGNATED:true', U, 'CONTINUE', 'd', 'r'),
    ).rejects.toMatchObject({ code: 'human_decision_required' });
    expect(repo.decisions).toHaveLength(0);
  });

  // NP-ENF-015-026: the two pieces a mutation probe found UNPINNED. Removing the
  // coercion, or flipping NO_AUTHORITY_CONFIGURED to ALLOW, previously left the whole
  // suite green. These bind both.
  it('NP-ENF-015-026a NO_AUTHORITY_CONFIGURED answers UNKNOWN for every context', () => {
    expect(NO_AUTHORITY_CONFIGURED.evaluate({ actorId: 'a', subjectId: 'b', action: 'x' })).toBe('UNKNOWN');
    expect(NO_AUTHORITY_CONFIGURED.evaluate({ actorId: 'a', subjectId: 'a', action: 'x' })).toBe('UNKNOWN');
    expect(resolveAuthority(NO_AUTHORITY_CONFIGURED, { actorId: 'a', subjectId: 'b', action: 'x' })).toBe('UNKNOWN');
  });

  it('NP-ENF-015-026b the coercion withholds every non-ALLOW/DENY answer', () => {
    const ctx = { actorId: 'a', subjectId: 'b', action: 'x' };
    for (const bad of ['allow', ' ALLOW ', true, 1, null, undefined, ['ALLOW'], { toString: () => 'ALLOW' }])
      expect(resolveAuthority({ evaluate: () => bad } as never, ctx)).toBe('UNKNOWN');
    expect(resolveAuthority({ evaluate: () => 'DENY' } as never, ctx)).toBe('DENY');
    expect(resolveAuthority({ evaluate: () => 'ALLOW' } as never, ctx)).toBe('ALLOW');
  });

  it('NP-ENF-015-026c an inherited or malformed evaluator is not an evaluator', () => {
    const ctx = { actorId: 'a', subjectId: 'b', action: 'x' };
    // Inherited via the prototype chain, not an own property.
    const inherited = Object.create({ evaluate: () => 'ALLOW' });
    expect(resolveAuthority(inherited, ctx)).toBe('UNKNOWN');
    // Malformed shapes fail closed rather than throwing out of the guard.
    for (const bad of ['ALLOW', 42, {}, () => 'ALLOW'])
      expect(resolveAuthority(bad as never, ctx)).toBe('UNKNOWN');
    expect(resolveAuthority({ evaluate: () => { throw new Error('boom'); } } as never, ctx)).toBe('UNKNOWN');
  });

  // NP-ENF-015-016: prototype-chain injection of an evaluator. A bare deps.authority
  // lookup found a polluted Object.prototype.authority and WROTE a decision row against
  // a production-shaped { repo } — measured. ownAuthority() is the fix; this pins it.
  it('NP-ENF-015-016 an evaluator injected via Object.prototype is refused with no write', async () => {
    const polluted = Object.prototype as unknown as { authority?: unknown };
    polluted.authority = { evaluate: () => 'ALLOW' };
    try {
      const repo = createMemoryPilotRepository();
    seedPilotFixtures(repo);
    const deps = { repo };
      await recordConsent(deps, U, TEST_TERMS_VERSION);
      await enroll(deps, U);

      // The polluted property IS visible on a bare lookup...
      expect((deps as { authority?: unknown }).authority).toBeDefined();
      // ...and ownAuthority must not see it.
      expect(ownAuthority(deps)).toBeUndefined();

      await expect(
        applyHumanDecision(deps, 'actor-A', U, 'PAID_PENDING_HUMAN_DECISION', 'd', 'r'),
      ).rejects.toMatchObject({ code: 'human_decision_required' });
      expect(repo.decisions).toHaveLength(0);
    } finally {
      delete polluted.authority;
    }
  });

  // NP-ENF-015-027 POSITIVE CONTROL (§36): proves the harness can detect a real side
  // effect, so the refusals above are discrimination rather than a path that never works.
  // The ALLOW comes from a DEVELOPMENT-ONLY injected evaluator. Production supplies none.
  // FIXTURE=TRUE ENVIRONMENT=DEVELOPMENT NON_PILOT=TRUE NON_AUTHORITY=TRUE
  it('NP-ENF-015-027 positive control — an injected development ALLOW reaches the write', async () => {
    const repo = createMemoryPilotRepository();
    seedPilotFixtures(repo);
    const deps = {
      repo,
      authority: { evaluate: () => 'ALLOW' as const },
    };
    await recordConsent(deps, U, TEST_TERMS_VERSION);
    await enroll(deps, U);

    const { decision, enrollment } = await applyHumanDecision(
      deps,
      'actor-A',
      U,
      'PAID_PENDING_HUMAN_DECISION',
      'introduce paid plan',
      'development fixture',
    );

    expect(repo.decisions).toHaveLength(1);
    expect(repo.decisions[0]!.actorId).toBe('actor-A');
    expect(enrollment.state).toBe('PAID_PENDING_HUMAN_DECISION');
    expect(enrollment.decisionId).toBe(decision.id);
  });

  it('GOVERNANCE: DAY7_READY does not auto-convert — state persists until a human decision', async () => {
    const repo = createMemoryPilotRepository();
    seedPilotFixtures(repo);
    const deps = { repo };
    await recordConsent(deps, U, TEST_TERMS_VERSION);
    await enroll(deps, U);
    repo.enrollments.get(U)!.startedAt = new Date(Date.now() - 10 * 86_400_000).toISOString();
    await advanceMachineStates(deps, U);
    await advanceMachineStates(deps, U); // repeated machine passes
    expect(repo.enrollments.get(U)!.state).toBe('DAY7_READY'); // still not paid/continue/stopped
  });

  it('rejects events and day7 for non-enrolled users', async () => {
    const repo = createMemoryPilotRepository();
    seedPilotFixtures(repo);
    const deps = { repo };
    await expect(recordEvent(deps, U, 'session_started', {})).rejects.toMatchObject({ code: 'not_enrolled' });
    await expect(day7Report(deps, U)).rejects.toBeInstanceOf(PilotError);
  });
});
