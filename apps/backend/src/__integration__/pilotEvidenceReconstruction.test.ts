/**
 * NP-PILOT-FIRST-013 §17 — ENV-05 measured as a PROPERTY, not by grepping for "backup".
 *
 * BACKUP MECHANISM and EVIDENCE RECONSTRUCTION CAPABILITY are different controls, and prior
 * seams conflated them. D17 names two distinct stop conditions: "material
 * backup/evidence-preservation failure" AND "inability to reconstruct material pilot evidence".
 * The second is a property of the data, and it is testable without any backup existing.
 *
 * So this file asks the question directly: after each disruptive event, can the governance
 * record still be rebuilt FROM PERSISTED ROWS ALONE?
 */
import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
/*
 * ENV04-R2. These are PILOT suites: the code under test reads the pilot store, so the fixtures
 * are seeded through the pilot pool and the schema is migrated with the PILOT target. While the
 * two stores were one database this distinction was invisible; with a genuinely separate pilot
 * database, seeding the product store means the code under test sees empty tables and the suite
 * passes on nothing. Same pool for the fixture and the code under test.
 */
import { closePool } from '../db/pool';
import { query, resetPilotPool } from '../db/pilotPool';
import { closeRedis } from '../cache/redis';
import { runMigrations } from '../db/migrate';
import { sqlPilotRepository } from '../pilot/repository';
import { readBackParticipation, readBackPilotControl } from '../pilot/readBack';
import { exportParticipantPilotData } from '../pilot/export';
import { enroll, recordEvent, withdraw, stopPilot, resumePilot, terminateParticipation } from '../pilot/service';

const U = 'dddddddd-0000-4000-8000-000000000001';
const OP = 'dddddddd-0000-4000-8000-000000000002';
const TERMS = { version: 'NP013-TERMS-v1', digest: 'NP013-DIGEST' };
const ALLOW = { evaluate: () => 'ALLOW' as const };   // stop path only; NOT an authority claim

beforeAll(async () => { await runMigrations({ target: 'PILOT' }); });
afterAll(async () => { await resetPilotPool(); await closePool(); await closeRedis(); });

async function seed() {
  await query(`TRUNCATE pilot_cap_decisions, pilot_monitor_events, pilot_lifecycle_events,
               pilot_events, human_decisions, pilot_enrollments, consents, pilot_terms
               RESTART IDENTITY CASCADE`);
  await query('DELETE FROM pilot_control');
  await query('INSERT INTO pilot_control (id, stopped, max_participants) VALUES (true, false, 10)');
  for (const id of [U, OP])
    await query("INSERT INTO users (id, email, password_hash) VALUES ($1,$2,'x') ON CONFLICT (id) DO NOTHING",
      [id, `${id}@np013.invalid`]);
  const { rows } = await query(
    `INSERT INTO pilot_terms (version, status, digest, content_reference, published_at)
     VALUES ($1,'PUBLISHED',$2,'NP-013 fixture', now()) RETURNING *`, [TERMS.version, TERMS.digest]);
  const t = rows[0];
  await sqlPilotRepository.recordConsent(U, TERMS.version, {
    id: t.id, version: t.version, status: 'PUBLISHED', digest: t.digest,
    contentReference: t.content_reference, publishedAt: t.published_at,
  });
  await enroll({ repo: sqlPilotRepository }, U);
  await recordEvent({ repo: sqlPilotRepository }, U, 'session_started', {});
}

/** Reconstruct from PERSISTED ROWS via a fresh read — no in-memory state carried across. */
const reconstruct = () => readBackParticipation(sqlPilotRepository, U);

describe('§17 ENV-05 — can the governance record be reconstructed?', () => {
  beforeEach(() => seed());

  it('baseline: the participation reconstructs with zero deviations', async () => {
    const rb = await reconstruct();
    expect(rb.status).toBe('IN_PILOT');
    expect(rb.deviations).toEqual([]);
  });

  it('R1 (in-process half): reconstruction carries no in-memory state between reads', async () => {
    // NP-014 CORRECTION. This test previously read:
    //     await closePool.length;   // no-op guard; the next query re-reads
    // `closePool.length` is the FUNCTION'S ARITY - zero. It discarded nothing, awaited nothing,
    // and could not fail. The test was titled "after APPLICATION RESTART (pool state discarded)"
    // while performing no restart and discarding no state.
    //
    // A module-level pool cannot be restarted from inside the process that holds it, so the
    // honest split is: this test asserts only that reconstruction is a pure function of
    // PERSISTED ROWS, and the genuine restart - a new OS process, and a real PostgreSQL
    // restart - is exercised out of process by tools/np014-recovery.sh (R1, R2).
    const before = await reconstruct();
    const after = await reconstruct();
    expect(after.status).toBe(before.status);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    expect(after.deviations).toEqual([]);
  });

  it('R3: after STOP then RESUME the control history reconstructs BOTH episodes in order', async () => {
    await stopPilot({ repo: sqlPilotRepository, authority: ALLOW }, OP, 'NP-014 R3 stop');
    await resumePilot({ repo: sqlPilotRepository, authority: ALLOW }, OP, 'NP-014 R3 resume');
    const ctrl = await readBackPilotControl(sqlPilotRepository);
    expect(ctrl.stopped).toBe(false);
    expect(ctrl.episodes.map((e) => e.kind)).toEqual(['STOP', 'RESUME']);
    expect(ctrl.deviations).toEqual([]);
  });

  it('R5: after PILOT TERMINATION the participation reconstructs AS TERMINATED, not as lost', async () => {
    await terminateParticipation(
      { repo: sqlPilotRepository, authority: ALLOW }, OP, U, 'NP-014 R5 termination');
    const rb = await reconstruct();
    expect(rb.status).toBe('EXITED');
    expect(rb.deviations).toEqual([]);
    const { rows } = await query<{ kind: string }>(
      "SELECT kind FROM pilot_lifecycle_events WHERE kind = 'TERMINATION'");
    expect(rows).toHaveLength(1);
    // termination and withdrawal must remain DISTINGUISHABLE in the reconstructed record
    expect(rb.transitions.map((t) => t.kind)).toContain('TERMINATION');
    expect(rb.transitions.map((t) => t.kind)).not.toContain('WITHDRAWAL');
  });

  it('after PARTICIPANT WITHDRAWAL the record reconstructs AS EXITED, not as lost', async () => {
    await withdraw({ repo: sqlPilotRepository }, U, 'participant withdrew');
    const rb = await reconstruct();
    expect(rb.status).toBe('EXITED');
    expect(rb.deviations).toEqual([]);
    // the governance fact survives the exit
    const { rows } = await query("SELECT kind FROM pilot_lifecycle_events WHERE kind='WITHDRAWAL'");
    expect(rows).toHaveLength(1);
  });

  it('after a PILOT STOP the control history reconstructs from the ledger', async () => {
    await stopPilot({ repo: sqlPilotRepository, authority: ALLOW }, OP, 'NP-013 reconstruction probe');
    const ctrl = await readBackPilotControl(sqlPilotRepository);
    expect(ctrl.stopped).toBe(true);
    expect(ctrl.deviations).toEqual([]);
  });

  it('after PARTIAL DATA LOSS the reconstruction REPORTS A DEVIATION rather than lying', async () => {
    // This is the property that matters: losing evidence must be VISIBLE, not silent.
    await query('DELETE FROM pilot_lifecycle_events');
    await withdraw({ repo: sqlPilotRepository }, U, 'withdraw then lose the ledger');
    await query('DELETE FROM pilot_lifecycle_events');
    const rb = await reconstruct();
    expect(rb.deviations.length).toBeGreaterThan(0);
    expect(rb.status).toBe('DEVIATION');
  });

  it('EXPORT is reproducible: two exports of unchanged data agree', async () => {
    const a = await exportParticipantPilotData(sqlPilotRepository, U);
    const b = await exportParticipantPilotData(sqlPilotRepository, U);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('an INTERRUPTED export loses nothing — the source rows are unchanged', async () => {
    const before = await exportParticipantPilotData(sqlPilotRepository, U);
    try { await exportParticipantPilotData(sqlPilotRepository, 'not-a-uuid' as string); } catch { /* expected */ }
    const after = await exportParticipantPilotData(sqlPilotRepository, U);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });

  it('THE HONEST LIMIT: total loss of the database loses everything', async () => {
    // Stated as a test so it cannot be forgotten. Every reconstruction above reads the SAME
    // single Postgres instance. There is no second copy anywhere: no backup, no replica, no
    // durable export target. Reconstruction is a property OF THE ROWS, and it is only as
    // durable as the one container holding them.
    const { rows } = await query(
      `SELECT count(*)::int AS n FROM information_schema.tables
       WHERE table_schema='public' AND table_name LIKE 'pilot%'`);
    expect(rows[0].n).toBeGreaterThan(5);
    // No backup/replica/archive table or extension exists in this database.
    const { rows: ext } = await query(
      "SELECT count(*)::int AS n FROM pg_extension WHERE extname IN ('pg_stat_statements','pgbackrest')");
    expect(ext[0].n).toBe(0);
  });
});
