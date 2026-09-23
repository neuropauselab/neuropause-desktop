/**
 * §22 — THE FREE-TEXT CANARY, AGAINST A REAL POSTGRES ERROR.
 *
 * NP-005 found that a PostgreSQL constraint violation returns
 * `DETAIL: Failing row contains (...)` with EVERY COLUMN inlined, that node-postgres surfaces
 * it as `err.detail`, and that the error middleware logs `{ err }` wholesale — so a failed
 * insert on `pilot_events` would have written a participant's free text into a log line.
 * The redact list was extended to cover the value-bearing pg fields.
 *
 * NP-006 §22 is explicit: **DO NOT TRUST THE CONFIGURATION.** The existing unit test
 * constructs the error shape by hand, which proves the redact paths match THAT SHAPE — not
 * that the shape is what Postgres actually produces. This file plants a unique canary, forces
 * a REAL database error carrying it, routes the REAL error object through the REAL logger, and
 * searches the ACTUAL serialized output.
 *
 * SYNTHETIC DATA ONLY.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query, pool } from '../db/pool';
import { closeRedis } from '../cache/redis';
import { runMigrations } from '../db/migrate';
import pino from 'pino';
import { REDACT_PATHS } from '../config/logger';

const CANARY = 'NP006_FREE_TEXT_CANARY_7f3a91c4e2';

beforeAll(async () => { await runMigrations(); });
afterAll(async () => { await Promise.allSettled([closePool(), closeRedis()]); });

beforeEach(async () => {
  await query(
    `TRUNCATE pilot_lifecycle_events, pilot_events, human_decisions, pilot_enrollments,
     consents, pilot_terms, users RESTART IDENTITY CASCADE`,
  );
  await query(
    `INSERT INTO pilot_control (id, stopped, max_participants) VALUES (true, false, NULL)
     ON CONFLICT (id) DO UPDATE SET stopped=false, max_participants=NULL`,
  );
});

/** Capture exactly what the configured redaction emits for a given payload. */
function serialize(payload: unknown): string {
  const chunks: string[] = [];
  const stream = { write: (s: string) => { chunks.push(s); } };
  const l = pino(
    { redact: { paths: REDACT_PATHS, censor: '[redacted]' } },
    stream as unknown as pino.DestinationStream,
  );
  (l.error as (o: unknown, m: string) => void)(payload, 'probe');
  return chunks.join('');
}

/** Provoke a REAL pg error and hand back the REAL error object. */
async function realPgError(sql: string, params: unknown[]): Promise<Error & Record<string, unknown>> {
  try {
    await pool.query(sql, params as never[]);
  } catch (e) {
    return e as Error & Record<string, unknown>;
  }
  throw new Error('expected the statement to fail, and it did not - the probe is vacuous');
}

describe('§22 a real Postgres error carries the row, and the logger does not', () => {
  it('CONTROL: the real error DOES contain the canary, so this test is not vacuous', async () => {
    const { rows } = await query<{ id: string }>(
      'INSERT INTO users (email) VALUES ($1) RETURNING id',
      [`canary-${Date.now()}@test.invalid`],
    );
    // NOT NULL violation on consent_id, with the canary sitting in the state column.
    const err = await realPgError(
      'INSERT INTO pilot_enrollments (user_id, state, consent_id) VALUES ($1,$2,NULL)',
      [rows[0].id, CANARY],
    );

    expect(err.code).toBe('23502');
    // THE HEADLINE FACT, measured rather than asserted: Postgres inlines the whole row.
    expect(String(err.detail)).toContain(CANARY);
  });

  it('the SHIPPED redact paths remove the canary from the real error', async () => {
    const { rows } = await query<{ id: string }>(
      'INSERT INTO users (email) VALUES ($1) RETURNING id',
      [`canary2-${Date.now()}@test.invalid`],
    );
    const err = await realPgError(
      'INSERT INTO pilot_enrollments (user_id, state, consent_id) VALUES ($1,$2,NULL)',
      [rows[0].id, CANARY],
    );

    const out = serialize({ err, requestId: 'probe-1' });

    expect(out).not.toContain(CANARY);
    // and the diagnostics survive - redaction that blinds the operator is its own failure
    expect(out).toContain('23502');
    expect(out).toContain('pilot_enrollments');
  });

  it('a CHECK violation on a pilot state also carries the row, and is also redacted', async () => {
    const { rows } = await query<{ id: string }>(
      'INSERT INTO users (email) VALUES ($1) RETURNING id',
      [`canary3-${Date.now()}@test.invalid`],
    );
    const { rows: c } = await query<{ id: string }>(
      'INSERT INTO consents (user_id, version) VALUES ($1,$2) RETURNING id',
      [rows[0].id, `v-${CANARY}`],
    );
    const err = await realPgError(
      'INSERT INTO pilot_enrollments (user_id, state, consent_id) VALUES ($1,$2,$3)',
      [rows[0].id, `NOT_A_STATE_${CANARY}`, c[0].id],
    );

    expect(String(err.detail ?? '') + String(err.message)).toContain(CANARY);
    expect(serialize({ err })).not.toContain(CANARY);
  });

  it('a jsonb metadata value — the actual free-text field — is redacted from a real error', async () => {
    const { rows } = await query<{ id: string }>(
      'INSERT INTO users (email) VALUES ($1) RETURNING id',
      [`canary4-${Date.now()}@test.invalid`],
    );
    // FK violation on enrollment_id, with the canary inside the metadata jsonb.
    const err = await realPgError(
      `INSERT INTO pilot_events (user_id, enrollment_id, event_type, metadata)
       VALUES ($1, '00000000-0000-4000-8000-000000000000', 'feedback_submitted', $2::jsonb)`,
      [rows[0].id, JSON.stringify({ text: CANARY })],
    );

    expect(err.code).toBe('23503');
    expect(String(err.detail)).toContain('00000000-0000-4000-8000-000000000000');
    expect(serialize({ err })).not.toContain(CANARY);
  });

  it('the canary is absent from EVERY value-bearing field a real error can carry', async () => {
    const { rows } = await query<{ id: string }>(
      'INSERT INTO users (email) VALUES ($1) RETURNING id',
      [`canary5-${Date.now()}@test.invalid`],
    );
    const err = await realPgError(
      'INSERT INTO pilot_enrollments (user_id, state, consent_id) VALUES ($1,$2,NULL)',
      [rows[0].id, CANARY],
    );
    const out = serialize({ err, nested: { err } });

    for (const field of ['detail', 'where', 'query', 'internalQuery', 'hint']) {
      const present = typeof err[field] === 'string' && String(err[field]).includes(CANARY);
      if (present) expect(out, `err.${field} leaked`).not.toContain(CANARY);
    }
    expect(out).not.toContain(CANARY); // including the nested copy
  });
});
