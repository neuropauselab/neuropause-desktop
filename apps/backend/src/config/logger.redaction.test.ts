/**
 * THE LOGGER MUST NOT EMIT A DATABASE ROW.
 *
 * NP-PILOT-FIRST-005 measured, against a real Postgres 16, that a constraint violation
 * returns `DETAIL: Failing row contains (...)` with the ENTIRE row inlined — a planted canary
 * came back in full. node-postgres surfaces that as `err.detail`, and the error middleware
 * logs `{ err, requestId }` wholesale. A failed insert on `pilot_events` would therefore have
 * put a participant's free-text feedback into a log line.
 *
 * THIS CORRECTS AN EARLIER CLAIM OF THIS PROGRAMME'S OWN — that participant free text "cannot
 * reach an application log line through any pilot path". True of the paths traced; false for
 * the database driver's error shape, which the search space had not included.
 *
 * The test asserts on the SERIALIZED OUTPUT of the real logger rather than on the config,
 * because a redact path that is subtly wrong (wrong key, wrong nesting) still looks correct
 * in a config object and silently emits the value.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('./env', () => ({ loadEnv: () => ({ NODE_ENV: 'test' }) }));

import pino from 'pino';
import { REDACT_PATHS } from './logger';

const CANARY = 'CANARY-FREETEXT-9f31-participant-wrote-this';

/** The shape node-postgres produces for a constraint violation. */
function pgError() {
  const err = new Error('null value in column "consent_id" violates not-null constraint') as Error & Record<string, unknown>;
  err.name = 'error';
  err.code = '23502';
  err.table = 'pilot_enrollments';
  err.constraint = 'pilot_enrollments_consent_id_not_null';
  err.schema = 'public';
  err.detail = `Failing row contains (9d8cefa8, 1eaf785d, ${CANARY}, null, null, 2026-09-22).`;
  err.where = `PL/pgSQL function inline_code_block line 1 at SQL statement: ${CANARY}`;
  err.query = `INSERT INTO pilot_events (metadata) VALUES ('{"text":"${CANARY}"}')`;
  err.internalQuery = `SELECT '${CANARY}'`;
  err.hint = `Perhaps you meant ${CANARY}`;
  return err;
}

/** Capture what the configured logger actually writes. */
function captureWith(paths: string[], payload: unknown): string {
  const chunks: string[] = [];
  const stream = { write: (s: string) => { chunks.push(s); } };
  const l = pino({ redact: { paths, censor: '[redacted]' } }, stream as unknown as pino.DestinationStream);
  (l.error as (o: unknown, m: string) => void)(payload, 'probe');
  return chunks.join('');
}

describe('the logger redacts Postgres row-bearing error fields', () => {
  it('CONTROL: without the redaction the canary IS emitted, so the test is not vacuous', () => {
    const out = captureWith(['password'], { err: pgError() });
    expect(out).toContain(CANARY);
  });

  it('with THE SHIPPED paths the canary is gone from every field', () => {
    // REDACT_PATHS is imported from the module under test, so a misspelled path there fails
    // here rather than being masked by a restated copy.
    const out = captureWith(REDACT_PATHS, { err: pgError() });

    expect(out).not.toContain(CANARY);
    // The diagnostically useful fields survive - redaction that blinds the operator would
    // trade one failure for another.
    expect(out).toContain('23502');
    expect(out).toContain('pilot_enrollments');
    expect(out).toContain('violates not-null constraint');
  });

  it('each value-bearing pg field is covered individually, not just in aggregate', () => {
    for (const field of ['detail', 'where', 'query', 'internalQuery', 'hint'] as const) {
      const err = new Error('boom') as Error & Record<string, unknown>;
      err[field] = `row contains ${CANARY}`;
      const out = captureWith(REDACT_PATHS, { err });
      expect(out, `err.${field} leaked`).not.toContain(CANARY);
    }
  });

  it('the pre-existing credential redactions are unchanged', () => {
    const out = captureWith(REDACT_PATHS, {
      password: CANARY,
      refreshToken: CANARY,
      accessToken: CANARY,
      req: { headers: { authorization: CANARY } },
    });
    expect(out).not.toContain(CANARY);
  });
});

describe('NESTED errors - the leak a single-level wildcard cannot cover', () => {
  /**
   * `AppError` carries a `logCause` BY DESIGN so a handler can record which upstream
   * dependency failed, and pino's serializer emits it as `err.logCause`. A pino redact
   * wildcard matches exactly ONE key level, so `err.detail` and `*.detail` both miss
   * `err.logCause.detail`.
   *
   * Found by a canary against a real Postgres error, not by reading the config: four
   * single-level probes passed and the nested one leaked.
   */
  it('a pg error wrapped as err.logCause is redacted', () => {
    const out = captureWith(REDACT_PATHS, { err: { name: 'AppError', status: 503, logCause: pgError() } });
    expect(out).not.toContain(CANARY);
    expect(out).toContain('AppError'); // the wrapper is still legible
  });

  it('a pg error wrapped as err.cause (ES2022) is redacted', () => {
    const out = captureWith(REDACT_PATHS, { err: { name: 'AppError', cause: pgError() } });
    expect(out).not.toContain(CANARY);
  });

  it('a pg error nested under an arbitrary key two levels down is redacted', () => {
    const out = captureWith(REDACT_PATHS, { outer: { inner: pgError() } });
    expect(out).not.toContain(CANARY);
  });

  it('CONTROL: without the nested paths, err.logCause.detail DOES leak', () => {
    const singleLevelOnly = REDACT_PATHS.filter((p) => !p.includes('logCause') && !p.startsWith('*.*') && !p.includes('cause'));
    const out = captureWith(singleLevelOnly, { err: { logCause: pgError() } });
    expect(out).toContain(CANARY); // proves the nested paths are what close it
  });
});
