/**
 * Enforcement test for the pilot human-decision path (closes "the sole production
 * call site of the decision endpoint has zero tests").
 *
 * Strategy mirrors store/router.test.ts: a real Express app on an ephemeral port,
 * exercised over fetch, mounted exactly as app.ts:112 mounts it — `requireAuth`
 * then `createPilotRouter()` — with real JWT verification. Only the Postgres pool
 * is replaced, so routing, validation, auth and the service layer all run for real.
 *
 * This traverses the ACTUAL production consumer, which supplies uid(req) as BOTH
 * actor and subject. A test that invokes the service directly would be a policy
 * test; this one is an enforcement test.
 *
 * The assertion that establishes enforcement is the SIDE-EFFECT COUNT on both
 * branches. The HTTP status is corroboration only.
 */
import 'express-async-errors';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/pool', () => ({ query: vi.fn(), pool: {}, getPool: vi.fn() }));

import { signAccessToken } from '../auth/jwt';
import { requireAuth } from '../auth/requireAuth';
import { errorHandler, notFoundHandler } from '../middleware/error';
import { createMemoryPilotRepository } from './memoryRepository';
import { seedPilotFixtures, TEST_TERMS_VERSION } from './testFixtures';
import { createPilotRouter } from './router';
import { enroll, recordConsent } from './service';

const U = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

let repo: ReturnType<typeof createMemoryPilotRepository>;
let server: Server | undefined;

async function start(): Promise<string> {
  const app = express();
  app.use(express.json());
  app.use('/pilot', requireAuth, createPilotRouter({ repo }));
  app.use(notFoundHandler);
  app.use(errorHandler);
  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

const tokenFor = (userId: string) => signAccessToken({ sub: userId, email: `${userId}@test.dev` }).token;

type ErrorBody = { error: { code: string; message: string } };

async function postDecision(base: string, userId: string, targetState: string) {
  return fetch(`${base}/pilot/decision`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tokenFor(userId)}` },
    body: JSON.stringify({ targetState, decision: 'd', reason: 'r' }),
  });
}

beforeEach(async () => {
  repo = createMemoryPilotRepository();
  seedPilotFixtures(repo);
  await recordConsent({ repo }, U, TEST_TERMS_VERSION);
  await enroll({ repo }, U);
});

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

describe('POST /pilot/decision — enforcement at the consequential consumer', () => {
  // The production caller supplies the same authenticated id for actor and subject.
  // Every human-decision outcome state must be refused on that shape, with no write.
  it.each(['CONTINUE', 'PAID_PENDING_HUMAN_DECISION', 'INSTITUTIONAL_PENDING', 'EXTENDED', 'STOPPED', 'COMPLETED'])(
    'refuses a self-issued decision to %s and writes nothing',
    async (targetState) => {
      const base = await start();
      const stateBefore = repo.enrollments.get(U)!.state;
      const decisionIdBefore = repo.enrollments.get(U)!.decisionId;

      const res = await postDecision(base, U, targetState);

      // Side effects — the assertion that establishes enforcement.
      expect(repo.decisions).toHaveLength(0);
      expect(repo.enrollments.get(U)!.state).toBe(stateBefore);
      expect(repo.enrollments.get(U)!.decisionId).toBe(decisionIdBefore);

      // Corroboration only.
      expect(res.status).toBe(403);
      expect(((await res.json()) as ErrorBody).error.code).toBe('pilot_human_decision_required');
    },
  );

  // A DIFFERENT authenticated principal is refused identically.
  //
  // SUPERSEDED COMMENT, kept visible rather than deleted (§2 #21). This previously read:
  //   "router.ts:108 supplies uid(req) as BOTH actor and subject, so actor !== subject is
  //    UNREACHABLE through the production route ... it must not be 'fixed' back open."
  // That was a deliberate decision, and it was correct for the authority state of the time.
  // It is no longer TRUE as a statement about the route: NP-PILOT-FIRST-004 added an optional
  // `subjectUserId`, so actor !== subject IS now reachable through the production API.
  //
  // WHAT THE COMMENT WAS PROTECTING IS UNCHANGED, AND THAT IS THE POINT. The refusal never
  // came from the ids being equal — `applyHumanDecision` asks the AUTHORITY PREDICATE first,
  // before any repository read, and production supplies no evaluator. So every caller is
  // still refused with zero writes, separated or not. The route was "opened" in shape only;
  // no authority was created, and none can be without a designated evaluator (MR-04).
  //
  // Every assertion below is the original. None was weakened to accommodate the new field —
  // this case posts no subjectUserId, so it still exercises the actor == subject shape.
  it('refuses a different principal identically — authority, not id equality, is the gate', async () => {
    const base = await start();
    const res = await postDecision(base, OTHER, 'CONTINUE');

    expect(res.status).toBe(403);
    expect(((await res.json()) as ErrorBody).error.code).toBe('pilot_human_decision_required');
    expect(repo.decisions).toHaveLength(0);
  });

  // An unauthenticated caller never reaches the service at all.
  it('rejects an unauthenticated caller before the service', async () => {
    const base = await start();
    const res = await fetch(`${base}/pilot/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetState: 'CONTINUE', decision: 'd', reason: 'r' }),
    });
    expect(res.status).toBe(401);
    expect(repo.decisions).toHaveLength(0);
  });
});
