/**
 * The five NP-PILOT-FIRST-004 routes, exercised at the ACTUAL production consumer.
 *
 * Strategy mirrors router.enforcement.test.ts: a real Express app on an ephemeral port,
 * driven over fetch, mounted exactly as app.ts mounts it — `requireAuth` then
 * `createPilotRouter()` — with real JWT verification. Only the Postgres pool is replaced,
 * so routing, validation, auth and the service layer all run for real.
 *
 * A test that called the service directly would be a policy test. This one is an
 * ENFORCEMENT test: it proves the refusals survive the HTTP edge, and that the
 * authentication boundary is reached BEFORE the service on every new route.
 *
 * The assertion that establishes enforcement is the SIDE-EFFECT COUNT. The HTTP status is
 * corroboration.
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
import { TEST_TERMS_VERSION, seedPilotFixtures } from './testFixtures';
import { createPilotRouter } from './router';
import { enroll, recordConsent } from './service';
import type { AuthorityEvaluator } from './authority';

const P = '11111111-1111-4111-8111-111111111111';
const OPERATOR = '33333333-3333-4333-8333-333333333333';

/** Every route this seam added, with a body that would be VALID if it were reached. */
const NEW_ROUTES = [
  ['POST', '/pilot/withdraw', { reason: 'r' }],
  ['POST', '/pilot/terminate', { subjectUserId: P, reason: 'r' }],
  ['POST', '/pilot/stop', { reason: 'r' }],
  ['POST', '/pilot/resume', { reason: 'r' }],
  ['GET', '/pilot/control', undefined],
] as const;

let repo: ReturnType<typeof createMemoryPilotRepository>;
let server: Server | undefined;

async function start(authority?: AuthorityEvaluator): Promise<string> {
  const app = express();
  app.use(express.json());
  app.use('/pilot', requireAuth, createPilotRouter(authority ? { repo, authority } : { repo }));
  app.use(notFoundHandler);
  app.use(errorHandler);
  server = app.listen(0);
  await new Promise<void>((r) => server!.once('listening', () => r()));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

const tokenFor = (id: string) => signAccessToken({ sub: id, email: `${id}@test.dev` }).token;

type ErrorBody = { error: { code: string; message: string } };

function call(base: string, method: string, path: string, body: unknown, callerId?: string) {
  return fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(callerId ? { authorization: `Bearer ${tokenFor(callerId)}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** Everything the routes could possibly have written. */
const writes = () => ({
  lifecycle: repo.lifecycle.length,
  stopped: repo.control.stopped,
  state: repo.enrollments.get(P)?.state ?? null,
});

beforeEach(async () => {
  repo = createMemoryPilotRepository();
  seedPilotFixtures(repo);
  await recordConsent({ repo }, P, TEST_TERMS_VERSION);
  await enroll({ repo }, P);
});

afterEach(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  server = undefined;
});

describe('the new routes — authentication is reached before the service', () => {
  it.each(NEW_ROUTES)('%s %s rejects an unauthenticated caller and writes nothing', async (method, path, body) => {
    const base = await start();
    const before = writes();

    const res = await call(base, method, path, body);

    expect(res.status).toBe(401);
    expect(writes()).toEqual(before);
  });
});

describe('POST /pilot/withdraw — a participant leaves their own participation', () => {
  it('an enrolled participant withdraws, and the reason is durable', async () => {
    const base = await start();

    const res = await call(base, 'POST', '/pilot/withdraw', { reason: 'no longer available' }, P);

    expect(res.status).toBe(201);
    expect(repo.enrollments.get(P)!.state).toBe('WITHDRAWN');
    expect(repo.lifecycle).toHaveLength(1);
    expect(repo.lifecycle[0]).toMatchObject({ kind: 'WITHDRAWAL', actorUserId: P, subjectUserId: P, reason: 'no longer available' });
  });

  it('WITHDRAWAL IS SELF-SCOPED BY CONSTRUCTION — a named subject in the body cannot redirect it', async () => {
    const base = await start();
    // The route derives the subject from the authenticated caller; the schema has no
    // subjectUserId, so a caller cannot withdraw anyone else even by asking.
    const res = await call(base, 'POST', '/pilot/withdraw', { reason: 'r', subjectUserId: P }, OPERATOR);

    expect(res.status).toBe(404);
    expect(((await res.json()) as ErrorBody).error.code).toBe('pilot_not_enrolled');
    expect(repo.enrollments.get(P)!.state).toBe('PILOT_ACTIVE');
    expect(repo.lifecycle).toHaveLength(0);
  });

  it('a second withdrawal is refused at the edge with 409, and writes nothing further', async () => {
    const base = await start();
    await call(base, 'POST', '/pilot/withdraw', { reason: 'r' }, P);

    const res = await call(base, 'POST', '/pilot/withdraw', { reason: 'again' }, P);

    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorBody).error.code).toBe('pilot_already_exited');
    expect(repo.lifecycle).toHaveLength(1);
  });

  it('a malformed body is refused before the service', async () => {
    const base = await start();

    const res = await call(base, 'POST', '/pilot/withdraw', {}, P); // no reason

    expect(res.status).toBe(400);
    expect(repo.lifecycle).toHaveLength(0);
    expect(repo.enrollments.get(P)!.state).toBe('PILOT_ACTIVE');
  });
});

describe('the authority-gated routes create no authority', () => {
  it.each([
    ['/pilot/terminate', { subjectUserId: P, reason: 'r' }],
    ['/pilot/stop', { reason: 'r' }],
    ['/pilot/resume', { reason: 'r' }],
  ])('PRODUCTION SHAPE: %s is refused 403 with zero writes when no evaluator is wired', async (path, body) => {
    const base = await start(); // no authority — exactly how app.ts wires it
    const before = writes();

    const res = await call(base, 'POST', path, body, OPERATOR);

    expect(res.status).toBe(403);
    expect(((await res.json()) as ErrorBody).error.code).toBe('pilot_human_decision_required');
    expect(writes()).toEqual(before);
  });

  it('a designated authority reaches the effect — the mechanism exists and is exercised', async () => {
    const base = await start({ evaluate: () => 'ALLOW' });

    const stop = await call(base, 'POST', '/pilot/stop', { reason: 'safety signal' }, OPERATOR);
    expect(stop.status).toBe(201);
    expect(repo.control).toMatchObject({ stopped: true, stopActorId: OPERATOR, stopReason: 'safety signal' });

    // A stopped pilot refuses participant activity at the edge, with 409 not 500.
    const ev = await call(base, 'POST', '/pilot/events', { eventType: 'session_started' }, P);
    expect(ev.status).toBe(409);
    expect(((await ev.json()) as ErrorBody).error.code).toBe('pilot_pilot_stopped');

    const resume = await call(base, 'POST', '/pilot/resume', { reason: 'cleared' }, OPERATOR);
    expect(resume.status).toBe(201);
    expect(repo.control.stopped).toBe(false);
    expect(repo.lifecycle.map((e) => e.kind)).toEqual(['STOP', 'RESUME']);
  });
});

describe('GET /pilot/control — the pilot-wide state is readable', () => {
  it('reports the control row to any authenticated caller, disclosing no participant data', async () => {
    const base = await start();

    const res = await call(base, 'GET', '/pilot/control', undefined, P);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { control: Record<string, unknown> };
    expect(Object.keys(body.control).sort()).toEqual(
      ['maxParticipants', 'stopActorId', 'stopAt', 'stopReason', 'stopped'].sort(),
    );
    expect(body.control.stopped).toBe(false);
  });
});

describe('GET /pilot/terms — a surface never has to invent a version string', () => {
  it('reports the PUBLISHED terms only — DRAFT and RETIRED are not offered', async () => {
    const base = await start();

    const res = await call(base, 'GET', '/pilot/terms', undefined, P);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { terms: Array<{ version: string; status: string }> };
    expect(body.terms.map((t) => t.status)).toEqual(['PUBLISHED']);
    expect(body.terms[0]!.version).toBe(TEST_TERMS_VERSION);
  });

  it('PRODUCTION SHAPE: an empty registry answers an EMPTY LIST, so nothing can be offered', async () => {
    repo.terms.length = 0; // exactly what migration 0016 leaves behind
    const base = await start();

    const res = await call(base, 'GET', '/pilot/terms', undefined, P);

    expect(res.status).toBe(200);
    expect((await res.json()) as unknown).toEqual({ terms: [] });
  });

  it('requires authentication like every other pilot route', async () => {
    const base = await start();
    expect((await call(base, 'GET', '/pilot/terms', undefined)).status).toBe(401);
  });
});
