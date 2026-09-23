/**
 * THE GATE PRECEDES THE REPOSITORY - the property the whole fail-closed design rests on, and
 * the one no test pinned until now.
 *
 * Every existing enforcement test asserts a ROW COUNT on the in-memory repository: "the
 * refusal wrote nothing". That is necessary and it is not sufficient. It proves no WRITE
 * happened; it says nothing about whether a READ happened first. A refactor that hoisted the
 * enrollment read above the authority check would keep all 166 pilot tests green while
 * reopening exactly what the ordering was built to close:
 *
 *   - AN ENUMERATION ORACLE. If the refusal read the enrollment first, `not_enrolled` (404)
 *     and `human_decision_required` (403) would distinguish a real participant from a
 *     stranger, so an unauthorised caller could enumerate who is in the pilot one id at a
 *     time - while still writing nothing, and while every row-count assertion stayed green.
 *   - A COST ASYMMETRY. An unauthenticated-in-effect caller would drive database work on
 *     every attempt.
 *
 * The probe is a repository whose EVERY method throws. If any gated operation touches the
 * repository before deciding, the throw escapes and the expected PilotError never arrives. So
 * the assertion is not "no rows changed" but "the repository was never reached at all".
 *
 * This is the in-process analogue of pointing the service at an unreachable database: a
 * refusal from a process that cannot read is direct evidence that it did not read.
 */
import { describe, expect, it } from 'vitest';
import type { PilotRepository } from './repository';
import { applyHumanDecision, resumePilot, stopPilot, terminateParticipation } from './service';

const ACTOR = '33333333-3333-4333-8333-333333333333';
const SUBJECT = '11111111-1111-4111-8111-111111111111';

class RepositoryTouched extends Error {
  constructor(method: string) {
    super(`the repository was reached before the authority gate decided: ${method}`);
  }
}

/** Every method throws. Reaching any of them is the failure this file exists to detect. */
function unreachableRepository(): PilotRepository & { calls: string[] } {
  const calls: string[] = [];
  const METHODS = [
    'recordConsent', 'latestConsent', 'findConsentById', 'createEnrollment', 'createEnrollmentWithinBoundary',
    'getEnrollment', 'setEnrollmentState', 'exitEnrollmentIfActive', 'insertEvent', 'listEvents', 'insertDecision',
    'findDecision', 'findTerms', 'findTermsById', 'listPublishedTerms', 'getControl', 'setStopped',
    'countActiveEnrollments', 'insertLifecycleEvent', 'listLifecycleEvents',
    'listPilotWideLifecycleEvents',
  ] as const;

  const repo = { calls } as unknown as Record<string, unknown> & { calls: string[] };
  for (const m of METHODS) {
    repo[m] = (..._args: unknown[]) => {
      calls.push(m);
      throw new RepositoryTouched(m);
    };
  }
  return repo as unknown as PilotRepository & { calls: string[] };
}

/** Every consequential operation that is gated on the authority predicate. */
const GATED: Array<[string, (deps: { repo: PilotRepository }) => Promise<unknown>]> = [
  ['applyHumanDecision', (d) => applyHumanDecision(d, ACTOR, SUBJECT, 'COMPLETED', 'x', 'y')],
  ['terminateParticipation', (d) => terminateParticipation(d, ACTOR, SUBJECT, 'r')],
  ['stopPilot', (d) => stopPilot(d, ACTOR, 'r')],
  ['resumePilot', (d) => resumePilot(d, ACTOR, 'r')],
];

describe('PRODUCTION SHAPE: with no evaluator, a refusal never reaches the repository', () => {
  it.each(GATED)('%s refuses without a single repository call', async (_name, call) => {
    const repo = unreachableRepository();

    // No `authority` key at all - exactly how app.ts wires createPilotRouter().
    const err = await call({ repo })
      .then(() => null)
      .catch((e: { code?: string; message?: string }) => e);

    expect(err).not.toBeNull();
    expect(err!.code).toBe('human_decision_required');
    expect(repo.calls).toEqual([]); // the assertion that matters
  });

  it('CONTROL: the probe can detect a repository call, so an empty list is meaningful', async () => {
    const repo = unreachableRepository();

    // An UNGATED operation must reach the repository. If this passed with an empty call list,
    // the probe would be measuring nothing and every assertion above would be vacuous.
    const err = await import('./service')
      .then((m) => m.status({ repo }, SUBJECT))
      .then(() => null)
      .catch((e: Error) => e);

    expect(err).toBeInstanceOf(RepositoryTouched);
    expect(repo.calls.length).toBeGreaterThan(0);
  });
});

describe('a DENY also refuses before the repository', () => {
  it.each(GATED)('%s with an evaluator answering DENY touches nothing', async (_name, call) => {
    const repo = unreachableRepository();
    const deps = { repo, authority: { evaluate: () => 'DENY' as const } };

    const err = await call(deps)
      .then(() => null)
      .catch((e: { code?: string }) => e);

    expect(err!.code).toBe('human_decision_required');
    expect(repo.calls).toEqual([]);
  });

  it.each(GATED)('%s with an evaluator answering UNKNOWN touches nothing', async (_name, call) => {
    const repo = unreachableRepository();
    const deps = { repo, authority: { evaluate: () => 'UNKNOWN' as const } };

    const err = await call(deps)
      .then(() => null)
      .catch((e: { code?: string }) => e);

    expect(err!.code).toBe('human_decision_required');
    expect(repo.calls).toEqual([]);
  });
});

describe('the refusal is INDISTINGUISHABLE for a real subject and a stranger', () => {
  /**
   * The enumeration-oracle property stated directly: because nothing is read, the refusal
   * cannot depend on whether the subject exists. Asserted on the error itself, not on a
   * status code, so it holds at the service layer regardless of routing.
   */
  it('a decision about a non-existent subject fails identically to one about anyone else', async () => {
    const repoA = unreachableRepository();
    const repoB = unreachableRepository();

    const fail = (p: Promise<unknown>) =>
      p.then(() => null).catch((e: { code: string; message: string }) => e);

    const a = await fail(applyHumanDecision({ repo: repoA }, ACTOR, SUBJECT, 'COMPLETED', 'x', 'y'));
    const b = await fail(
      applyHumanDecision({ repo: repoB }, ACTOR, '99999999-9999-4999-8999-999999999999', 'COMPLETED', 'x', 'y'),
    );

    expect(a).not.toBeNull();
    expect(a!.code).toBe(b!.code);
    expect(a!.message).toBe(b!.message);
    expect(repoA.calls).toEqual([]);
    expect(repoB.calls).toEqual([]);
  });

  it('an INVALID target state is refused with the same code as a valid one, and reads nothing', async () => {
    const repo = unreachableRepository();

    const fail = (p: Promise<unknown>) => p.then(() => null).catch((e: { code: string }) => e);
    const valid = await fail(applyHumanDecision({ repo }, ACTOR, SUBJECT, 'COMPLETED', 'x', 'y'));
    const invalid = await fail(applyHumanDecision({ repo }, ACTOR, SUBJECT, 'NOT_A_STATE', 'x', 'y'));

    // The authority question precedes even the value-domain check, so the endpoint leaks no
    // membership signal AND no state-name signal.
    expect(valid!.code).toBe('human_decision_required');
    expect(invalid!.code).toBe('human_decision_required');
    expect(repo.calls).toEqual([]);
  });
});
