/**
 * G2 — actor/subject separation on the human-decision path.
 *
 * NP-PILOT-FIRST-003 recorded C-02: the production route passed `uid(req)` as BOTH actor and
 * subject, so no operator could ever record an outcome ABOUT a participant. The mechanism was
 * missing, not merely unauthorized.
 *
 * WHAT THIS FILE PROVES, AND WHAT IT DELIBERATELY DOES NOT:
 *   it proves the MECHANISM now exists and is exercised, and that opening it created NO
 *   authority — with no designated evaluator every caller is still refused with zero writes.
 *   It does NOT prove that anyone may decide. That requires a human designation (MR-04),
 *   recorded as HUMAN_DECISION_REQUIRED, and no evaluator returning ALLOW ships in this repo.
 *
 * The evaluators below are TEST FIXTURES. `authority.ts` ships only NO_AUTHORITY_CONFIGURED,
 * which answers UNKNOWN for every context.
 */
import 'express-async-errors';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/pool', () => ({ query: vi.fn(), pool: {}, getPool: vi.fn() }));

import { signAccessToken } from '../auth/jwt';
import { requireAuth } from '../auth/requireAuth';
import { errorHandler, notFoundHandler } from '../middleware/error';
import { createMemoryPilotRepository } from './memoryRepository';
import { seedPilotFixtures, TEST_TERMS_VERSION } from './testFixtures';
import { createPilotRouter } from './router';
import { enroll, recordConsent } from './service';
import type { AuthorityEvaluator, DecisionContext } from './authority';

const PARTICIPANT = '11111111-1111-4111-8111-111111111111';
const OPERATOR = '33333333-3333-4333-8333-333333333333';

let server: Server | undefined;

/** A fixture evaluator. Shipping one of these would be a DESIGNATION, which this repo has not made. */
function evaluatorAllowing(predicate: (c: DecisionContext) => boolean): AuthorityEvaluator {
  return { evaluate: (c) => (predicate(c) ? 'ALLOW' : 'DENY') };
}

async function start(repo: ReturnType<typeof createMemoryPilotRepository>, authority?: AuthorityEvaluator) {
  const app = express();
  app.use(express.json());
  app.use('/pilot', requireAuth, createPilotRouter(authority ? { repo, authority } : { repo }));
  app.use(notFoundHandler);
  app.use(errorHandler);
  server = app.listen(0);
  await new Promise<void>((r) => server!.once('listening', () => r()));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

async function enrolledRepo() {
  const repo = createMemoryPilotRepository();
  seedPilotFixtures(repo);
  await recordConsent({ repo }, PARTICIPANT, TEST_TERMS_VERSION);
  await enroll({ repo }, PARTICIPANT);
  return repo;
}

const tokenFor = (id: string) => signAccessToken({ sub: id, email: `${id}@test.dev` }).token;

async function decide(base: string, callerId: string, body: Record<string, unknown>) {
  return fetch(`${base}/pilot/decision`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tokenFor(callerId)}` },
    body: JSON.stringify({ targetState: 'COMPLETED', decision: 'd', reason: 'r', ...body }),
  });
}

afterEach(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  server = undefined;
});

describe('G2 — the mechanism exists', () => {
  it('an authorized operator can record a decision ABOUT a participant (actor !== subject)', async () => {
    const repo = await enrolledRepo();
    const authority = evaluatorAllowing((c) => c.actorId === OPERATOR && c.subjectId === PARTICIPANT);
    const base = await start(repo, authority);

    const res = await decide(base, OPERATOR, { subjectUserId: PARTICIPANT });

    expect(res.status).toBe(201);
    expect(repo.decisions).toHaveLength(1);
    expect(repo.decisions[0].actorId).toBe(OPERATOR);              // actor recorded
    expect(repo.decisions[0].subject).toContain('pilot_enrollment:'); // subject recorded
    expect(repo.enrollments.get(PARTICIPANT)!.state).toBe('COMPLETED');
    expect(repo.enrollments.get(PARTICIPANT)!.decisionId).toBe(repo.decisions[0].id);
    expect(repo.decisions[0].createdAt).toBeTruthy();               // timestamp recorded
  });

  it('the evaluator is asked with actor and subject SEPARATELY, never defaulted together', async () => {
    const repo = await enrolledRepo();
    const seen: DecisionContext[] = [];
    const authority: AuthorityEvaluator = {
      evaluate: (c) => {
        seen.push(c);
        return 'ALLOW';
      },
    };
    const base = await start(repo, authority);
    await decide(base, OPERATOR, { subjectUserId: PARTICIPANT });

    expect(seen).toHaveLength(1);
    expect(seen[0].actorId).toBe(OPERATOR);
    expect(seen[0].subjectId).toBe(PARTICIPANT);
    expect(seen[0].actorId).not.toBe(seen[0].subjectId);
    expect(seen[0].action).toBe('pilot.decision.record');
  });
});

describe('G2 — opening the mechanism created no authority', () => {
  it('PRODUCTION SHAPE: with no evaluator, a separated actor is refused with zero writes', async () => {
    const repo = await enrolledRepo();
    const base = await start(repo); // no authority — exactly how app.ts wires it

    const res = await decide(base, OPERATOR, { subjectUserId: PARTICIPANT });

    expect(res.status).toBe(403);
    expect(repo.decisions).toHaveLength(0);
    expect(repo.enrollments.get(PARTICIPANT)!.state).toBe('PILOT_ACTIVE');
    expect(repo.enrollments.get(PARTICIPANT)!.decisionId).toBeNull();
  });

  it('a participant cannot manufacture operator authority by naming themselves the subject', async () => {
    const repo = await enrolledRepo();
    const authority = evaluatorAllowing((c) => c.actorId === OPERATOR);
    const base = await start(repo, authority);

    const res = await decide(base, PARTICIPANT, { subjectUserId: PARTICIPANT });

    expect(res.status).toBe(403);
    expect(repo.decisions).toHaveLength(0);
  });

  it('a participant cannot decide about someone else', async () => {
    const repo = await enrolledRepo();
    const authority = evaluatorAllowing((c) => c.actorId === OPERATOR);
    const base = await start(repo, authority);

    const res = await decide(base, PARTICIPANT, { subjectUserId: OPERATOR });

    expect(res.status).toBe(403);
    expect(repo.decisions).toHaveLength(0);
  });

  it('an evaluator that DENIES refuses with zero writes', async () => {
    const repo = await enrolledRepo();
    const base = await start(repo, { evaluate: () => 'DENY' });

    const res = await decide(base, OPERATOR, { subjectUserId: PARTICIPANT });

    expect(res.status).toBe(403);
    expect(repo.decisions).toHaveLength(0);
  });
});

describe('G2 — the decision is bound and constrained', () => {
  it('a decision about a non-enrolled subject is refused', async () => {
    const repo = await enrolledRepo();
    const authority = evaluatorAllowing(() => true);
    const base = await start(repo, authority);

    const res = await decide(base, OPERATOR, { subjectUserId: '44444444-4444-4444-8444-444444444444' });

    expect(res.status).toBe(404);
    expect(repo.decisions).toHaveLength(0);
  });

  it('a target state outside the human-decision vocabulary is refused', async () => {
    const repo = await enrolledRepo();
    const authority = evaluatorAllowing(() => true);
    const base = await start(repo, authority);

    const res = await decide(base, OPERATOR, { subjectUserId: PARTICIPANT, targetState: 'DAY7_READY' });

    expect(res.status).toBe(400);
    expect(repo.decisions).toHaveLength(0);
    expect(repo.enrollments.get(PARTICIPANT)!.state).toBe('PILOT_ACTIVE');
  });

  it('a malformed body is refused before the service', async () => {
    const repo = await enrolledRepo();
    const base = await start(repo, evaluatorAllowing(() => true));
    const res = await fetch(`${base}/pilot/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tokenFor(OPERATOR)}` },
      body: JSON.stringify({ targetState: 'COMPLETED' }), // no decision, no reason
    });
    expect(res.status).toBe(400);
    expect(repo.decisions).toHaveLength(0);
  });

  it('an unauthenticated caller never reaches the service, even with a subject named', async () => {
    const repo = await enrolledRepo();
    const base = await start(repo, evaluatorAllowing(() => true));
    const res = await fetch(`${base}/pilot/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetState: 'COMPLETED', decision: 'd', reason: 'r', subjectUserId: PARTICIPANT }),
    });
    expect(res.status).toBe(401);
    expect(repo.decisions).toHaveLength(0);
  });
});
