/**
 * §19 - PARTICIPANT FREE-TEXT MUST NOT LEAK.
 *
 * Tracing the feedback path end to end found something better than a gap: there is NO logging
 * path at all. The pilot module imports no logger, the error handler never touches `req.body`,
 * and a Zod validation failure renders `{ path, message }` without the offending VALUE.
 *
 * WHICH IS EXACTLY WHY THIS FILE EXISTS. A property that holds BY CONSTRUCTION regresses
 * silently: nothing fails the day someone adds a convenient `logger.info({ body })` to a pilot
 * handler while debugging. A redaction filter would be the weaker answer - it would imply the
 * text reaches a logger and is being scrubbed. Pinning the absence is the stronger one.
 *
 * SYNTHETIC PARTICIPANTS ONLY (§33). The "feedback" below is fixture text.
 */
import 'express-async-errors';
import express from 'express';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/pool', () => ({ query: vi.fn(), pool: {}, getPool: vi.fn() }));

import { signAccessToken } from '../auth/jwt';
import { requireAuth } from '../auth/requireAuth';
import { errorHandler, notFoundHandler } from '../middleware/error';
import { createMemoryPilotRepository } from './memoryRepository';
import { TEST_TERMS_VERSION, seedPilotFixtures } from './testFixtures';
import { createPilotRouter } from './router';
import { day7Report, enroll, recordConsent, recordEvent } from './service';

const P = '11111111-1111-4111-8111-111111111111';
const Q = '22222222-2222-4222-8222-222222222222';

/** Distinctive enough that a substring search for it is meaningful. */
const SECRET_TEXT = 'SYNTHETIC-FEEDBACK-canary-8f31c0-do-not-log';

let server: Server | undefined;
afterEach(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  server = undefined;
});

async function start(repo: ReturnType<typeof createMemoryPilotRepository>) {
  const app = express();
  app.use(express.json());
  app.use('/pilot', requireAuth, createPilotRouter({ repo }));
  app.use(notFoundHandler);
  app.use(errorHandler);
  server = app.listen(0);
  await new Promise<void>((r) => server!.once('listening', () => r()));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

const tokenFor = (id: string) => signAccessToken({ sub: id, email: `${id}@test.dev` }).token;

async function enrolled(userId = P) {
  const repo = createMemoryPilotRepository();
  seedPilotFixtures(repo);
  const deps = { repo };
  await recordConsent(deps, userId, TEST_TERMS_VERSION);
  await enroll(deps, userId);
  return { repo, deps };
}

describe('§19 - the pilot module has no logging path (source invariant)', () => {
  /**
   * Asserted against the SOURCE rather than against behaviour, because "this code path did not
   * log today" is not the claim. The claim is that no pilot module can log, and only reading
   * every file can establish that.
   */
  const dir = __dirname;
  const productionFiles = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

  it('no production pilot file imports a logger or calls console', () => {
    expect(productionFiles.length).toBeGreaterThan(4); // vacuity guard: the list must be real

    const offenders: string[] = [];
    for (const f of productionFiles) {
      const src = readFileSync(join(dir, f), 'utf8');
      if (/from\s+['"].*logger['"]/.test(src) || /\bconsole\s*\./.test(src) || /\blogger\s*\./.test(src)) {
        offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('CONTROL: the detector fires on a file that does log', () => {
    // Proves the assertion above is capable of failing - without this, an empty offender list
    // could mean "nothing logs" or "the regex never matches anything".
    const withLogging = readFileSync(join(dir, '..', 'middleware', 'error.ts'), 'utf8');
    expect(/from\s+['"].*logger['"]/.test(withLogging)).toBe(true);
  });
});

describe('§19 - a rejected body never echoes the submitted text', () => {
  it('a Zod failure reports the PATH and the RULE, never the value', async () => {
    const { repo } = await enrolled();
    const base = await start(repo);

    // eventType is bounded to 64 chars; send the canary as an over-long type so the value is
    // what fails validation, and check it is not reflected anywhere in the response.
    const res = await fetch(`${base}/pilot/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tokenFor(P)}` },
      body: JSON.stringify({ eventType: SECRET_TEXT.repeat(4), metadata: { text: SECRET_TEXT } }),
    });
    const raw = await res.text();

    expect(res.status).toBe(400);
    expect(raw).not.toContain(SECRET_TEXT);
    expect(raw).toContain('eventType'); // the path IS reported, so the caller can fix it
  });

  it('an unknown event type is refused by name without quoting the metadata', async () => {
    const { repo } = await enrolled();
    const base = await start(repo);

    const res = await fetch(`${base}/pilot/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tokenFor(P)}` },
      body: JSON.stringify({ eventType: 'not_a_pilot_event', metadata: { text: SECRET_TEXT } }),
    });
    const raw = await res.text();

    expect(res.status).toBe(400);
    expect(raw).not.toContain(SECRET_TEXT);
    expect(repo.events).toHaveLength(0);
  });
});

describe("§19 - free-text is readable only by the participant who wrote it", () => {
  it('the day-7 report returns a participant their OWN feedback', async () => {
    const { deps } = await enrolled();
    await recordEvent(deps, P, 'feedback_submitted', { text: SECRET_TEXT });

    const report = await day7Report(deps, P);

    expect(JSON.stringify(report.feedback)).toContain(SECRET_TEXT);
  });

  it("ANOTHER participant's report contains none of it", async () => {
    const { repo, deps } = await enrolled();
    await recordEvent(deps, P, 'feedback_submitted', { text: SECRET_TEXT });
    await recordConsent(deps, Q, TEST_TERMS_VERSION);
    await enroll(deps, Q);
    await recordEvent(deps, Q, 'feedback_submitted', { text: 'SYNTHETIC-other-participant' });

    const report = await day7Report(deps, Q);

    expect(JSON.stringify(report.feedback)).not.toContain(SECRET_TEXT);
    expect(report.feedback).toHaveLength(1);
    expect(repo.events).toHaveLength(2); // both were recorded; only the reader differs
  });

  it('the day-7 route resolves the subject from the token, so it cannot be pointed elsewhere', async () => {
    const { repo, deps } = await enrolled();
    await recordEvent(deps, P, 'feedback_submitted', { text: SECRET_TEXT });
    const base = await start(repo);

    // Q asks for the report. There is no subject parameter to supply, and Q is enrolled
    // nowhere, so the only possible answer is a refusal - never P's text.
    const res = await fetch(`${base}/pilot/day7`, { headers: { authorization: `Bearer ${tokenFor(Q)}` } });
    const raw = await res.text();

    expect(res.status).toBe(404);
    expect(raw).not.toContain(SECRET_TEXT);
  });
});

describe('§19 - free-text cannot be appended to a closed participation', () => {
  it.each([
    ['an exited participation', (repo: ReturnType<typeof createMemoryPilotRepository>) => { repo.enrollments.get(P)!.state = 'WITHDRAWN'; }, 'already_exited'],
    ['a stopped pilot', (repo: ReturnType<typeof createMemoryPilotRepository>) => { repo.control.stopped = true; }, 'pilot_stopped'],
  ])('%s refuses new feedback with zero writes', async (_label, mutate, code) => {
    const { repo, deps } = await enrolled();
    mutate(repo);

    const err = await recordEvent(deps, P, 'feedback_submitted', { text: SECRET_TEXT })
      .then(() => null)
      .catch((e: { code?: string }) => e);

    expect(err!.code).toBe(code);
    expect(repo.events).toHaveLength(0);
  });
});
