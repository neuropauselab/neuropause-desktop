/**
 * NP-PILOT-FIRST-017 §4 §5 — REPRODUCTION of the retention execution-integrity defect.
 *
 * TEST CLASS: REAL_POSTGRES · real executeRetention · no stub · no mock.
 *
 * This file is written to FAIL against the implementation as NP-016 left it, and to pass only
 * once retention stops recording work it did not perform. It is the reproduction required by
 * §4 ("do not fix before reproducing") and the regression proof required by §5.
 *
 * Canary discipline: every identifiable value planted here is a literal that makes failure
 * obvious on sight, so a passing assertion cannot be confused with an empty fixture.
 */
import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { Client, type QueryResultRow } from 'pg';
import { closePool, query } from '../db/pool';
import { closeRedis } from '../cache/redis';
import { runMigrations } from '../db/migrate';
import { executeRetention, planRetention, RETENTION_CLASSES, EXECUTABLE_CLASSES } from '../pilot/retention';
import { exportParticipantPilotData } from '../pilot/export';
import { sqlPilotRepository } from '../pilot/repository';

const SUBJECT = 'a7000000-0000-4000-8000-000000000001';
const ACTOR   = 'a7000000-0000-4000-8000-000000000002';
const CANARY  = 'NP017-CANARY-ORIGINAL-001';

beforeAll(async () => { await runMigrations(); });
afterAll(async () => { await closePool(); await closeRedis(); });

/** A closed pilot, past its retention clock, with one participant and one row per class. */
async function seedClosedPilotWithData() {
  await query(`TRUNCATE pilot_retention_log, pilot_retention_holds, pilot_closure,
               pilot_monitor_events, pilot_lifecycle_events, pilot_events, human_decisions,
               pilot_enrollments, consents, pilot_terms RESTART IDENTITY CASCADE`);
  for (const [id, email] of [[SUBJECT, 'subject'], [ACTOR, 'actor']] as const)
    await query(`INSERT INTO users (id, email, password_hash) VALUES ($1,$2,'x')
                 ON CONFLICT (id) DO NOTHING`, [id, `${email}@np017.invalid`]);

  const { rows: [t] } = await query(
    `INSERT INTO pilot_terms (version,status,digest,content_reference,published_at)
     VALUES ('NP017-T','PUBLISHED','D','np017',now()) RETURNING *`);
  const { rows: [c] } = await query(
    `INSERT INTO consents (user_id, version, terms_id, terms_digest)
     VALUES ($1,'NP017-T',$2,$3) RETURNING *`, [SUBJECT, t.id, CANARY]);
  const { rows: [e] } = await query(
    `INSERT INTO pilot_enrollments (user_id, consent_id, state) VALUES ($1,$2,'PILOT_ACTIVE') RETURNING *`,
    [SUBJECT, c.id]);
  await query(`INSERT INTO pilot_events (user_id, enrollment_id, event_type, metadata)
               VALUES ($1,$2,'session_started',$3::jsonb)`,
    [SUBJECT, e.id, JSON.stringify({ canary: CANARY })]);
  await query(`INSERT INTO pilot_lifecycle_events
               (enrollment_id, subject_user_id, actor_user_id, kind, previous_state, new_state, reason)
               VALUES ($1,$2,$3,'WITHDRAWAL','ACTIVE','WITHDRAWN',$4)`,
    [e.id, SUBJECT, ACTOR, CANARY]);
  await query(`INSERT INTO human_decisions (actor_id, decision_type, subject, decision, reason)
               VALUES ($1,'NP017',$2,'APPROVE',$3)`, [ACTOR, CANARY, CANARY]);
  await query(`INSERT INTO pilot_monitor_events
               (alert_class, severity, outcome, reason_code, actor_id, subject_user_id)
               VALUES ('UNAUTHORIZED_AUTHORITY','WARNING','DENIED',$1,$2,$3)`,
    [CANARY, ACTOR, SUBJECT]);

  // Closed 91 days ago: the retention clock (90 days) has elapsed.
  await query(`INSERT INTO pilot_closure (closed_at, closed_by, closure_reason)
               VALUES (now() - interval '91 days', $1, 'np017 reproduction')`, [ACTOR]);
}

const countCanary = async (table: string, col: string) => {
  const { rows } = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ${table} WHERE ${col}::text = $1`, [CANARY]);
  return rows[0].n;
};
const logRows = async () => {
  const { rows } = await query<{ data_class: string; method: string }>(
    'SELECT data_class, method FROM pilot_retention_log ORDER BY data_class');
  return rows;
};

describe('§5 — retention must not record work it did not perform', () => {
  beforeEach(seedClosedPilotWithData);

  it('POSITIVE CONTROL: the fixture really is eligible, and the canaries really are present', async () => {
    const plan = await planRetention(new Date());
    expect(plan.closedAt).not.toBeNull();
    const eligible = plan.items.filter((i) => i.eligible);
    expect(eligible.length).toBeGreaterThan(0);
    // Without this the assertions below could pass against an empty database.
    expect(await countCanary('consents', 'terms_digest')).toBe(1);
    expect(await countCanary('pilot_lifecycle_events', 'reason')).toBe(1);
    expect(await countCanary('human_decisions', 'reason')).toBe(1);
    expect(await countCanary('pilot_monitor_events', 'reason_code')).toBe(1);
    const { rows } = await query<{ n: number }>('SELECT count(*)::int AS n FROM pilot_events');
    expect(rows[0].n).toBe(1);
  });

  it('DELETED class: pilot_events is actually removed', async () => {
    await executeRetention(new Date());
    const { rows } = await query<{ n: number }>('SELECT count(*)::int AS n FROM pilot_events');
    expect(rows[0].n).toBe(0);
  });

  it('THE DEFECT: no completion record may exist for a class whose data was never mutated', async () => {
    await executeRetention(new Date());
    const logged = await logRows();

    // For every class recorded as processed, the canary link MUST be gone.
    // §7: NO CLASS MAY BE SILENTLY OMITTED. The first version of this map left out
    // pilot_enrollments, which is also PSEUDONYMIZED - so a fifth falsely-claimed class would
    // have gone unreported by the very test written to catch false claims.
    //
    // THE LINK COLUMN, NOT THE CANARY. An earlier version of this assertion fell back to
    // searching for the canary string, and reported pilot_monitor_events as falsely claimed
    // when it had in fact been pseudonymized correctly: the canary lives in `reason_code`,
    // which is the GOVERNANCE EVIDENCE and is supposed to survive. Pseudonymization severs the
    // SUBJECT LINK, so the subject link is what must be checked.
    const linkColumns: Record<string, readonly string[]> = {
      consents: ['user_id'],
      pilot_enrollments: ['user_id'],
      pilot_lifecycle_events: ['subject_user_id'],
      human_decisions: ['actor_id'],
      pilot_monitor_events: ['actor_id', 'subject_user_id'],
    };
    const falselyClaimed: string[] = [];
    for (const [cls, cols] of Object.entries(linkColumns)) {
      const entry = logged.find((r) => r.data_class === cls);
      if (!entry || entry.method !== 'PSEUDONYMIZED') continue;   // not claimed -> nothing to prove
      const where = cols.map((c) => `${c} = $1`).join(' OR ');
      const { rows } = await query<{ n: number }>(
        `SELECT count(*)::int AS n FROM ${cls} WHERE ${where}`, [SUBJECT]);
      if (rows[0].n > 0) falselyClaimed.push(cls);
    }
    expect(falselyClaimed).toEqual([]);
  });

  it('every declared class is accounted for — none silently omitted', () => {
    expect(RETENTION_CLASSES.map((c) => c.name)).toEqual([
      'pilot_events', 'consents', 'pilot_enrollments', 'pilot_lifecycle_events',
      'human_decisions', 'pilot_monitor_events',
    ]);
  });
});

describe('§12 §13 — failure, retry and idempotency', () => {
  beforeEach(seedClosedPilotWithData);

  it('§12 NO FALSE COMPLETION: a class whose mutation is not executable is never claimed', async () => {
    await executeRetention(new Date());
    const claimed = (await logRows()).map((r) => r.data_class).sort();
    expect(claimed).toEqual([...EXECUTABLE_CLASSES].sort());
    // The four unexecutable classes must have NO record at all - absence is the non-completion,
    // because pilot_retention_log has no status column to express FAILED.
    for (const cls of ['consents', 'pilot_enrollments', 'pilot_lifecycle_events', 'human_decisions'])
      expect(claimed).not.toContain(cls);
  });

  it('§12 a forced mutation failure leaves NO completion record and NO mutation', async () => {
    // Force failure by making the DELETE impossible: a hold is honoured inside the transaction,
    // so the item is skipped entirely. The observable requirement is identical - no claim.
    await query(`INSERT INTO pilot_retention_holds (hold_class, reason, placed_by)
                 VALUES ('LEGAL','np017 forced failure',$1)`, [ACTOR]);
    const applied = await executeRetention(new Date());
    expect(applied).toEqual([]);
    expect(await logRows()).toEqual([]);
    const { rows } = await query<{ n: number }>('SELECT count(*)::int AS n FROM pilot_events');
    expect(rows[0].n).toBe(1);                      // the data is untouched, as it must be
  });

  it('§13 RETRY: a first attempt that recorded nothing does NOT suppress the second', async () => {
    await query(`INSERT INTO pilot_retention_holds (hold_class, reason, placed_by)
                 VALUES ('LEGAL','np017 blocks run one',$1)`, [ACTOR]);
    expect(await executeRetention(new Date())).toEqual([]);
    expect(await logRows()).toEqual([]);            // nothing was claimed, so nothing is suppressed

    await query(`UPDATE pilot_retention_holds SET released_at = now()`);
    const second = await executeRetention(new Date());
    expect(second.map((i) => i.dataClass).sort()).toEqual([...EXECUTABLE_CLASSES].sort());
    const { rows } = await query<{ n: number }>('SELECT count(*)::int AS n FROM pilot_events');
    expect(rows[0].n).toBe(0);                      // the retry actually did the work
  });

  it('§13 IDEMPOTENCY: a successful run is not repeated, and nothing is double-destroyed', async () => {
    const first = await executeRetention(new Date());
    expect(first.length).toBe(EXECUTABLE_CLASSES.length);
    const second = await executeRetention(new Date());
    expect(second).toEqual([]);
    expect((await logRows()).length).toBe(EXECUTABLE_CLASSES.length);
  });

  it('§20 CONCURRENCY: two runs produce one completion record per class, and no contradiction',
    async () => {
      const [a, b] = await Promise.all([executeRetention(new Date()), executeRetention(new Date())]);
      expect(a.length + b.length).toBe(EXECUTABLE_CLASSES.length);
      const log = await logRows();
      expect(log.length).toBe(EXECUTABLE_CLASSES.length);
      // no class recorded twice, and no class recorded under two different methods
      const byClass = new Map<string, Set<string>>();
      for (const r of log) byClass.set(r.data_class, (byClass.get(r.data_class) ?? new Set()).add(r.method));
      for (const [, methods] of byClass) expect(methods.size).toBe(1);
      expect(byClass.size).toBe(log.length);
    });

  it('§21 EXPORT: after retention the export exposes no deleted rows and no severed subject', async () => {
    await executeRetention(new Date());
    const exported = await exportParticipantPilotData(sqlPilotRepository, SUBJECT);
    const blob = JSON.stringify(exported);
    expect(blob).not.toContain('session_started');   // pilot_events was DELETED
    // pseudonymized monitor rows must no longer link to the subject
    const { rows } = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pilot_monitor_events
       WHERE actor_id = $1 OR subject_user_id = $1`, [SUBJECT]);
    expect(rows[0].n).toBe(0);
    // ...but the governance evidence itself survives
    expect(await countCanary('pilot_monitor_events', 'reason_code')).toBe(1);
  });
});

describe('NP-017 second correction — a NULL subject must not verify vacuously', () => {
  it('with NO enrolments the plan emits a NULL subject, and NOTHING is claimed', async () => {
    // planRetention falls back to [null] when pilot_enrollments is empty. Both executable
    // classes match on the subject, so with a NULL subject the mutation touches nothing AND the
    // verification counts nothing - which read as success until this guard existed.
    await query(`TRUNCATE pilot_retention_log, pilot_retention_holds, pilot_closure,
                 pilot_monitor_events, pilot_lifecycle_events, pilot_events, human_decisions,
                 pilot_enrollments, consents, pilot_terms RESTART IDENTITY CASCADE`);
    await query(`INSERT INTO users (id, email, password_hash) VALUES ($1,$2,'x')
                 ON CONFLICT (id) DO NOTHING`, [ACTOR, 'actor@np017.invalid']);
    // A row that a NULL-subject DELETE would NOT remove - the vacuity witness.
    await query(`INSERT INTO pilot_monitor_events (alert_class,severity,outcome,reason_code)
                 VALUES ('UNAUTHORIZED_AUTHORITY','INFO','DENIED',$1)`, [CANARY]);
    await query(`INSERT INTO pilot_closure (closed_at, closed_by, closure_reason)
                 VALUES (now() - interval '91 days', $1, 'np017 null-subject')`, [ACTOR]);

    const plan = await planRetention(new Date());
    expect(plan.items.every((i) => i.subjectUserId === null)).toBe(true);   // vacuity guard
    expect(plan.items.some((i) => i.eligible)).toBe(true);

    const applied = await executeRetention(new Date());
    expect(applied).toEqual([]);                    // nothing is applicable
    expect(await logRows()).toEqual([]);            // and therefore NOTHING is claimed
    expect(await countCanary('pilot_monitor_events', 'reason_code')).toBe(1);  // row untouched
  });
});

describe('NP-019 §14 §15 §16 — transactional atomicity, observed from a SEPARATE connection', () => {
  beforeEach(seedClosedPilotWithData);

  /** A genuinely separate connection, so nothing is observed through the transaction's own client. */
  async function observe<T extends QueryResultRow>(sql: string, params: unknown[] = []) {
    const c = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await c.connect();
    try { return (await c.query<T>(sql, params)).rows; } finally { await c.end(); }
  }

  it('§15 SUCCESS is atomic: mutation AND completion record are both visible externally', async () => {
    const applied = await executeRetention(new Date());
    expect(applied.map((i) => i.dataClass).sort()).toEqual([...EXECUTABLE_CLASSES].sort());
    const events = await observe<{ n: number }>('SELECT count(*)::int AS n FROM pilot_events');
    const log = await observe<{ n: number }>('SELECT count(*)::int AS n FROM pilot_retention_log');
    expect(events[0].n).toBe(0);                       // the DELETE committed
    expect(log[0].n).toBe(EXECUTABLE_CLASSES.length);  // the claim committed
  });

  it('§14 THE CRITICAL TEST: a failure AFTER the mutation leaves NOTHING committed', async () => {
    // A real post-mutation failure path, not an injected fault: the interleave inserts the claim
    // row between planning and the transaction, so the mutation runs and the claim INSERT then
    // conflicts (ON CONFLICT DO NOTHING -> rowCount 0). Before NP-019 that returned false and
    // withTransaction COMMITTED the mutation anyway.
    const before = await observe<{ n: number }>('SELECT count(*)::int AS n FROM pilot_events');
    expect(before[0].n).toBe(1);                       // positive control: there IS work to undo

    const plan = await planRetention(new Date());
    const closure = plan.closedAt;
    let planted = false;
    const applied = await executeRetention(new Date(), {
      beforeItem: async (item) => {
        if (planted || item.dataClass !== 'pilot_events') return;
        planted = true;
        await query(
          `INSERT INTO pilot_retention_log (data_class, subject_user_id, method, closure_at)
           VALUES ($1,$2,$3,$4)`, [item.dataClass, item.subjectUserId, item.method, closure]);
      },
    });

    expect(applied.map((i) => i.dataClass)).not.toContain('pilot_events');
    // THE ASSERTION THAT MATTERS: the DELETE must have been rolled back.
    const after = await observe<{ n: number }>('SELECT count(*)::int AS n FROM pilot_events');
    expect(after[0].n).toBe(1);                        // original state preserved
  });

  it('§16 F-series: a hold landing mid-run leaves no mutation and no completion record', async () => {
    let placed = false;
    const applied = await executeRetention(new Date(), {
      beforeItem: async () => {
        if (placed) return;
        placed = true;
        await query(`INSERT INTO pilot_retention_holds (hold_class, reason, placed_by)
                     VALUES ('LEGAL','np019 mid-run',$1)`, [ACTOR]);
      },
    });
    expect(applied).toEqual([]);
    const events = await observe<{ n: number }>('SELECT count(*)::int AS n FROM pilot_events');
    const log = await observe<{ n: number }>('SELECT count(*)::int AS n FROM pilot_retention_log');
    expect(events[0].n).toBe(1);                       // untouched
    expect(log[0].n).toBe(0);                          // nothing claimed
  });

  it('§20 the null-subject guard must NOT bypass the hold control for a REAL subject', async () => {
    // The NP-018 regression, pinned from the other side: with a real subject the item reaches
    // the in-transaction hold re-check, so deleting that check is detectable.
    const plan = await planRetention(new Date());
    expect(plan.items.every((i) => i.subjectUserId !== null)).toBe(true);   // vacuity guard
    let placed = false;
    const applied = await executeRetention(new Date(), {
      beforeItem: async () => {
        if (placed) return;
        placed = true;
        await query(`INSERT INTO pilot_retention_holds (hold_class, reason, placed_by)
                     VALUES ('LEGAL','np019 reaches the in-transaction guard',$1)`, [ACTOR]);
      },
    });
    expect(applied).toEqual([]);
  });
});
