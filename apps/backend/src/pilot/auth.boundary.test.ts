/**
 * §14 — SIGN-IN IS NOT ENROLLMENT.
 *
 * NP-PILOT-FIRST-004 requires the two to be explicitly separate, and requires the chain
 * between them to be walked rather than asserted:
 *
 *   REGISTER -> SIGN IN -> AUTHENTICATED USER -> ELIGIBILITY -> TERMS -> CONSENT
 *            -> ENROLLMENT -> PILOT_ACTIVE
 *
 * Every arrow is a gate, and this file walks the chain one link at a time: at each step it
 * asserts what the account can do AND what it still cannot. Holding a valid session token is
 * the FIRST link, not the last — an authenticated account is a stranger to the pilot until
 * terms exist, consent is recorded and bound, a boundary is approved, and enrollment is
 * accepted.
 *
 * Driven through the real HTTP edge (real Express, real JWT verification, real requireAuth),
 * because the claim is about what a signed-in caller can reach, and only the edge can answer
 * that. Synthetic accounts only (§20).
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
import { TEST_TERMS, TEST_TERMS_VERSION } from './testFixtures';
import { createPilotRouter } from './router';

const U = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

let repo: ReturnType<typeof createMemoryPilotRepository>;
let base: string;
let server: Server | undefined;

const tokenFor = (id: string) => signAccessToken({ sub: id, email: `${id}@test.dev` }).token;

type ErrorBody = { error: { code: string } };

function call(method: string, path: string, body?: unknown, callerId?: string) {
  return fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(callerId ? { authorization: `Bearer ${tokenFor(callerId)}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const code = async (r: Response) => ((await r.json()) as ErrorBody).error.code;

beforeEach(async () => {
  repo = createMemoryPilotRepository(); // registry EMPTY, boundary UNDECIDED — production shape
  const app = express();
  app.use(express.json());
  app.use('/pilot', requireAuth, createPilotRouter({ repo }));
  app.use(notFoundHandler);
  app.use(errorHandler);
  server = app.listen(0);
  await new Promise<void>((r) => server!.once('listening', () => r()));
  base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
});

afterEach(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  server = undefined;
});

/** Every pilot route, so "what can this caller reach?" is asked exhaustively, not by sample. */
const ALL_ROUTES: Array<[string, string, unknown]> = [
  ['GET', '/pilot/terms', undefined],
  ['POST', '/pilot/consent', { version: TEST_TERMS_VERSION }],
  ['POST', '/pilot/enroll', undefined],
  ['GET', '/pilot/status', undefined],
  ['POST', '/pilot/events', { eventType: 'session_started' }],
  ['GET', '/pilot/day7', undefined],
  ['POST', '/pilot/decision', { targetState: 'COMPLETED', decision: 'd', reason: 'r' }],
  ['POST', '/pilot/withdraw', { reason: 'r' }],
  ['POST', '/pilot/terminate', { subjectUserId: U, reason: 'r' }],
  ['POST', '/pilot/stop', { reason: 'r' }],
  ['POST', '/pilot/resume', { reason: 'r' }],
  ['GET', '/pilot/control', undefined],
];

describe('§14 link 1 — REGISTER -> SIGN IN: without a session, nothing is reachable', () => {
  it.each(ALL_ROUTES)('%s %s answers 401 for an unauthenticated caller', async (method, path, body) => {
    expect((await call(method, path, body)).status).toBe(401);
  });

  it('a forged token is refused exactly like no token, and writes nothing', async () => {
    const res = await fetch(`${base}/pilot/enroll`, {
      method: 'POST',
      headers: { authorization: 'Bearer not-a-real-token' },
    });
    expect(res.status).toBe(401);
    expect(repo.enrollments.size).toBe(0);
  });
});

describe('§14 link 2 — SIGN IN -> AUTHENTICATED USER: a session is not a participation', () => {
  it('SIGNING IN CREATES NO ENROLLMENT — a fresh authenticated account has none', async () => {
    const res = await call('GET', '/pilot/status', undefined, U);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { enrollment: unknown; consentVersion: unknown; day: unknown };
    expect(body.enrollment).toBeNull();
    expect(body.consentVersion).toBeNull();
    expect(body.day).toBeNull();
    expect(repo.enrollments.size).toBe(0);
    expect(repo.events).toHaveLength(0);
  });

  it('an authenticated but unenrolled account cannot record events, report, withdraw or decide', async () => {
    for (const [method, path, body] of [
      ['POST', '/pilot/events', { eventType: 'session_started' }],
      ['GET', '/pilot/day7', undefined],
      ['POST', '/pilot/withdraw', { reason: 'r' }],
    ] as const) {
      const res = await call(method, path, body, U);
      expect(res.status).toBe(404);
      expect(await code(res)).toBe('pilot_not_enrolled');
    }
    expect(repo.events).toHaveLength(0);
    expect(repo.lifecycle).toHaveLength(0);
  });

  it('AUTHENTICATION IS NOT OPERATOR AUTHORITY — any signed-in account is refused the operator routes', async () => {
    for (const [path, body] of [
      ['/pilot/terminate', { subjectUserId: OTHER, reason: 'r' }],
      ['/pilot/stop', { reason: 'r' }],
      ['/pilot/resume', { reason: 'r' }],
      ['/pilot/decision', { targetState: 'COMPLETED', decision: 'd', reason: 'r' }],
    ] as const) {
      const res = await call('POST', path, body, U);
      expect(res.status).toBe(403);
      expect(await code(res)).toBe('pilot_human_decision_required');
    }
    expect(repo.control.stopped).toBe(false);
    expect(repo.decisions).toHaveLength(0);
    expect(repo.lifecycle).toHaveLength(0);
  });
});

describe('§14 links 3-5 — ELIGIBILITY -> TERMS -> CONSENT: each gate refuses on its own grounds', () => {
  it('with an EMPTY registry an authenticated account is offered nothing and can consent to nothing', async () => {
    const terms = await call('GET', '/pilot/terms', undefined, U);
    expect(await terms.json()).toEqual({ terms: [] });

    const res = await call('POST', '/pilot/consent', { version: TEST_TERMS_VERSION }, U);
    expect(res.status).toBe(409);
    expect(await code(res)).toBe('pilot_terms_unknown');
  });

  it('ARBITRARY CLIENT-CHOSEN VERSIONS ARE REFUSED — the client does not get to name the terms', async () => {
    repo.terms.push(TEST_TERMS); // one real published version exists
    for (const version of ['v1', 'pilot-terms-draft-v1', 'TEST-FIXTURE-terms-v2', 'PUBLISHED']) {
      const res = await call('POST', '/pilot/consent', { version }, U);
      expect(res.status).toBe(409);
      expect(await code(res)).toBe('pilot_terms_unknown');
    }
    expect(await repo.latestConsent(U)).toBeNull();
  });

  it('CONSENT IS NOT ENROLLMENT — a consented account is still not in the pilot', async () => {
    repo.terms.push(TEST_TERMS);
    expect((await call('POST', '/pilot/consent', { version: TEST_TERMS_VERSION }, U)).status).toBe(201);

    const status = (await (await call('GET', '/pilot/status', undefined, U)).json()) as { enrollment: unknown; consentVersion: string };
    expect(status.consentVersion).toBe(TEST_TERMS_VERSION); // consent recorded
    expect(status.enrollment).toBeNull();                   // participation NOT created
    expect(repo.enrollments.size).toBe(0);
  });

  it('a consented account is STILL refused enrollment while the boundary is undecided', async () => {
    repo.terms.push(TEST_TERMS);
    await call('POST', '/pilot/consent', { version: TEST_TERMS_VERSION }, U);

    const res = await call('POST', '/pilot/enroll', undefined, U);

    expect(res.status).toBe(409);
    expect(await code(res)).toBe('pilot_enrollment_boundary_undecided');
    expect(repo.enrollments.size).toBe(0);
  });
});

describe('§14 links 6-7 — ENROLLMENT -> PILOT_ACTIVE, and the states after it', () => {
  /** Walk the whole chain once, so the later states are reached the way a participant reaches them. */
  async function walkToActive() {
    repo.terms.push(TEST_TERMS);
    repo.control.maxParticipants = 10;
    await call('POST', '/pilot/consent', { version: TEST_TERMS_VERSION }, U);
    await call('POST', '/pilot/enroll', undefined, U);
  }

  it('the complete chain reaches PILOT_ACTIVE, and only then does activity become possible', async () => {
    await walkToActive();

    const status = (await (await call('GET', '/pilot/status', undefined, U)).json()) as { enrollment: { state: string }; day: number };
    expect(status.enrollment.state).toBe('PILOT_ACTIVE');
    expect(status.day).toBe(1);
    expect((await call('POST', '/pilot/events', { eventType: 'session_started' }, U)).status).toBe(201);
  });

  it('A WITHDRAWN PARTICIPANT IS STILL SIGNED IN AND STILL REFUSED — the session outlives the participation', async () => {
    await walkToActive();
    expect((await call('POST', '/pilot/withdraw', { reason: 'r' }, U)).status).toBe(201);

    // Same valid token, same account: reads still work, participation is closed.
    const status = await call('GET', '/pilot/status', undefined, U);
    expect(status.status).toBe(200);
    expect(((await status.json()) as { enrollment: { state: string } }).enrollment.state).toBe('WITHDRAWN');

    for (const [path, body] of [
      ['/pilot/events', { eventType: 'session_started' }],
      ['/pilot/withdraw', { reason: 'again' }],
    ] as const) {
      const res = await call('POST', path, body, U);
      expect(res.status).toBe(409);
      expect(await code(res)).toBe('pilot_already_exited');
    }
    // Re-enrollment is not a way back in either.
    expect(await code(await call('POST', '/pilot/enroll', undefined, U))).toBe('pilot_already_enrolled');
  });

  it('A TERMINATED PARTICIPANT IS REFUSED IDENTICALLY — the reason for exit changes nothing downstream', async () => {
    await walkToActive();
    repo.enrollments.get(U)!.state = 'TERMINATED'; // reached by an operator on a designated build

    expect(await code(await call('POST', '/pilot/events', { eventType: 'session_started' }, U))).toBe('pilot_already_exited');
    expect(await code(await call('POST', '/pilot/withdraw', { reason: 'r' }, U))).toBe('pilot_already_exited');
    expect((await call('GET', '/pilot/status', undefined, U)).status).toBe(200);
  });

  it('A STOPPED PILOT REFUSES EVERY AUTHENTICATED PARTICIPANT AT ONCE, without touching their sessions', async () => {
    await walkToActive();
    repo.control.stopped = true; // reached by a designated authority via POST /pilot/stop

    expect(await code(await call('POST', '/pilot/events', { eventType: 'session_started' }, U))).toBe('pilot_pilot_stopped');
    expect(await code(await call('POST', '/pilot/enroll', undefined, OTHER))).toBe('pilot_pilot_stopped');
    // Sign-in is untouched: reads still answer, so a stop is not an outage.
    expect((await call('GET', '/pilot/status', undefined, U)).status).toBe(200);
    expect((await call('GET', '/pilot/control', undefined, U)).status).toBe(200);
  });
});
