/**
 * NP-PILOT-FIRST WORK ITEM 5 — THE D13 RETENTION CONTRACT, proven against real PostgreSQL.
 *
 * TEST CLASS: REAL_POSTGRES · real planRetention / executeRetention · no stub · no mock.
 *
 * Every assertion here traces to a clause of the completed D13 decision, and to nothing else.
 * Where D13 is silent this file is silent: no period, method or boundary is inferred.
 *
 *   D13-A  90 days after pilot closure
 *   D13-B  exactly six data classes, no seventh authorized
 *   D13-C  pilot_events / consents / pilot_enrollments / pilot_lifecycle_events /
 *          human_decisions -> PSEUDONYMIZE ;  pilot_monitor_events -> DELETE
 *   D13-D  P1: REPLACE the direct identifier with a STABLE pseudonym, preserving the authorized
 *          longitudinal association. Explicitly NOT by setting the FK to NULL. Never to be
 *          described as anonymization.
 *   D13-E  RETENTION_ELIGIBLE_AT = closed_at + 90 days, and NOW == eligible is ELIGIBLE.
 *
 * WHY THE FIXTURE PINS AN ABSOLUTE closed_at: a boundary measured against `now()` cannot
 * distinguish 90 days from 89 or 91 - every value is far from the edge, which is exactly the
 * hole NP-020 found in four of five temporal guards. The clock here is supplied, so the edge is
 * reachable to the millisecond.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
/*
 * ENV04-R2. Retention is PILOT code, so its fixtures are seeded through the PILOT pool and its
 * schema is migrated with the PILOT target. Before ENV04-B these suites seeded the product store
 * and the code under test read the pilot store; with a genuinely separate pilot database that
 * means every fixture is invisible and the suite passes on empty tables. Same pool for the
 * fixture and the code under test, or the suite proves nothing.
 */
import { closePool } from '../db/pool';
import { query, resetPilotPool } from '../db/pilotPool';
import { closeRedis } from '../cache/redis';
import { runMigrations } from '../db/migrate';
import {
  EXECUTABLE_CLASSES, RETENTION_CLASSES, RETENTION_DAYS_AFTER_CLOSURE,
  executeRetention, planRetention,
} from '../pilot/retention';

const S1     = 'd1300000-0000-4000-8000-000000000001'; // participant one
const S2     = 'd1300000-0000-4000-8000-000000000002'; // participant two
const ACTOR  = 'd1300000-0000-4000-8000-0000000000aa'; // staff actor - NOT enrolled, never a subject
const CANARY = 'D13-CANARY-001';

const CLOSED_AT = new Date('2026-01-01T00:00:00.000Z');
const DAY = 86_400_000;
const ELIGIBLE_AT = new Date(CLOSED_AT.getTime() + RETENTION_DAYS_AFTER_CLOSURE * DAY);

/** The direct-subject-identifier columns, restated here from the SCHEMA rather than imported. */
const SUBJECT_COLUMNS: Record<string, readonly string[]> = {
  pilot_events: ['user_id'],
  consents: ['user_id'],
  pilot_enrollments: ['user_id'],
  pilot_lifecycle_events: ['actor_user_id', 'subject_user_id'],
  human_decisions: ['actor_id'],
  pilot_monitor_events: ['actor_id', 'subject_user_id'],
};

beforeAll(async () => { await runMigrations({ target: 'PILOT' }); });
afterAll(async () => { await resetPilotPool(); await closePool(); await closeRedis(); });

async function seedSubject(subjectId: string, tag: string, termsId: string) {
  const { rows: [c] } = await query(
    `INSERT INTO consents (user_id, version, terms_id, terms_digest)
     VALUES ($1,'D13-T',$2,$3) RETURNING *`, [subjectId, termsId, `${CANARY}-${tag}`]);
  const { rows: [e] } = await query(
    `INSERT INTO pilot_enrollments (user_id, consent_id, state)
     VALUES ($1,$2,'PILOT_ACTIVE') RETURNING *`, [subjectId, c.id]);
  await query(
    `INSERT INTO pilot_events (user_id, enrollment_id, event_type, metadata)
     VALUES ($1,$2,'session_started',$3::jsonb)`,
    [subjectId, e.id, JSON.stringify({ canary: `${CANARY}-${tag}` })]);
  // Actor = the participant themselves: a self-withdrawal, the case where the ACTOR column
  // holds a direct participant identifier.
  await query(
    `INSERT INTO pilot_lifecycle_events
       (enrollment_id, subject_user_id, actor_user_id, kind, previous_state, new_state, reason)
     VALUES ($1,$2,$2,'WITHDRAWAL','ACTIVE','WITHDRAWN',$3)`,
    [e.id, subjectId, `${CANARY}-${tag}`]);
  await query(
    `INSERT INTO human_decisions (actor_id, decision_type, subject, decision, reason)
     VALUES ($1,'D13',$2,'APPROVE',$2)`, [subjectId, `${CANARY}-${tag}`]);
  await query(
    `INSERT INTO pilot_monitor_events
       (alert_class, severity, outcome, reason_code, actor_id, subject_user_id)
     VALUES ('UNAUTHORIZED_AUTHORITY','WARNING','DENIED',$1,$2,$2)`,
    [`${CANARY}-${tag}`, subjectId]);
  return e.id as string;
}

/** Two enrolled participants, one un-enrolled staff actor, a pilot closed at a FIXED instant. */
async function seed() {
  await query(`TRUNCATE pilot_retention_log, pilot_retention_holds, pilot_closure,
               pilot_subject_pseudonyms, pilot_monitor_events, pilot_lifecycle_events,
               pilot_events, human_decisions, pilot_enrollments, consents, pilot_terms
               RESTART IDENTITY CASCADE`);
  await query('DELETE FROM users WHERE email LIKE $1', ['%@d13.invalid']);
  await query('DELETE FROM users WHERE email LIKE $1', ['pseudonym-%@pseudonymous.invalid']);
  for (const [id, name] of [[S1, 's1'], [S2, 's2'], [ACTOR, 'actor']] as const)
    await query(`INSERT INTO users (id, email, password_hash) VALUES ($1,$2,'x')
                 ON CONFLICT (id) DO NOTHING`, [id, `${name}@d13.invalid`]);

  const { rows: [t] } = await query(
    `INSERT INTO pilot_terms (version,status,digest,content_reference,published_at)
     VALUES ('D13-T','PUBLISHED','D','d13',now()) RETURNING *`);
  await seedSubject(S1, 's1', t.id);
  await seedSubject(S2, 's2', t.id);

  // SCOPE CONTROL: a staff actor who never enrolled. Nothing here may be pseudonymized, because
  // the actor is not a pilot subject - and a test that only watches the subjects cannot tell a
  // correctly-scoped run from one that rewrote every row in the table.
  await query(`INSERT INTO human_decisions (actor_id, decision_type, subject, decision, reason)
               VALUES ($1,'D13','STAFF','APPROVE',$2)`, [ACTOR, `${CANARY}-staff`]);

  await query(`INSERT INTO pilot_closure (closed_at, closed_by, closure_reason)
               VALUES ($1, $2, 'd13 contract')`, [CLOSED_AT.toISOString(), ACTOR]);
}

const count = async (table: string, cols: readonly string[], id: string) => {
  const pred = cols.map((c) => `${c} = $1`).join(' OR ');
  const { rows } = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ${table} WHERE ${pred}`, [id]);
  return rows[0].n;
};
const total = async (table: string) => {
  const { rows } = await query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
  return rows[0].n;
};
const pseudonymOf = async (subjectId: string): Promise<string | null> => {
  const { rows } = await query<{ pseudonym_user_id: string }>(
    'SELECT pseudonym_user_id FROM pilot_subject_pseudonyms WHERE subject_user_id = $1',
    [subjectId]);
  return rows[0]?.pseudonym_user_id ?? null;
};

/* ============================ D13-B — the class set ============================ */

describe('D13-B — exactly the six decided classes, and no seventh', () => {
  it('RETENTION_CLASSES is the decided set, in name and in count', () => {
    expect(RETENTION_CLASSES.map((c) => c.name).sort()).toEqual([
      'consents', 'human_decisions', 'pilot_enrollments', 'pilot_events',
      'pilot_lifecycle_events', 'pilot_monitor_events',
    ]);
    expect(RETENTION_CLASSES).toHaveLength(6);
  });

  it('every decided class is executable — no class is declared and then quietly skipped', () => {
    expect([...EXECUTABLE_CLASSES].sort()).toEqual(RETENTION_CLASSES.map((c) => c.name).sort());
  });
});

/* ============================ D13-C — the method matrix ============================ */

describe('D13-C — the method decided for each class', () => {
  it('records exactly the decided methods, including the two that INVERTED', () => {
    const m = new Map(RETENTION_CLASSES.map((c) => [c.name, c.method]));
    expect(m.get('pilot_events')).toBe('PSEUDONYMIZED');        // was DELETED before D13-C
    expect(m.get('consents')).toBe('PSEUDONYMIZED');
    expect(m.get('pilot_enrollments')).toBe('PSEUDONYMIZED');
    expect(m.get('pilot_lifecycle_events')).toBe('PSEUDONYMIZED');
    expect(m.get('human_decisions')).toBe('PSEUDONYMIZED');
    expect(m.get('pilot_monitor_events')).toBe('DELETED');      // was PSEUDONYMIZED before D13-C
  });
});

/* ============================ D13-A / D13-E — the clock ============================ */

describe('D13-A and D13-E — 90 days after closure, inclusive at the boundary', () => {
  beforeEach(seed);

  it('D13-A: the period is 90 days, and eligibility is computed from CLOSURE', async () => {
    expect(RETENTION_DAYS_AFTER_CLOSURE).toBe(90);
    const plan = await planRetention(ELIGIBLE_AT);
    expect(plan.closedAt).toBe(CLOSED_AT.toISOString());
    expect(plan.eligibleFrom).toBe(ELIGIBLE_AT.toISOString());
  });

  it('T0 = closed_at + 90d - 1ms  ->  NOT ELIGIBLE', async () => {
    const plan = await planRetention(new Date(ELIGIBLE_AT.getTime() - 1));
    expect(plan.items.every((i) => i.reason === 'WITHIN_RETENTION')).toBe(true);
    expect(plan.items.some((i) => i.eligible)).toBe(false);
  });

  it('T1 = closed_at + 90d exactly  ->  ELIGIBLE (D13-E: equal is eligible)', async () => {
    const plan = await planRetention(ELIGIBLE_AT);
    expect(plan.items.every((i) => i.reason === 'ELIGIBLE')).toBe(true);
    expect(plan.items.every((i) => i.eligible)).toBe(true);
  });

  it('T2 = closed_at + 90d + 1ms  ->  ELIGIBLE', async () => {
    const plan = await planRetention(new Date(ELIGIBLE_AT.getTime() + 1));
    expect(plan.items.every((i) => i.eligible)).toBe(true);
  });

  it('MUTATION M1 CATCHER: at closed_at + 89 days nothing is eligible', async () => {
    // Shortening the period to 89 makes this instant eligible; it must not be.
    const plan = await planRetention(new Date(CLOSED_AT.getTime() + 89 * DAY));
    expect(plan.items.some((i) => i.eligible)).toBe(false);
  });

  it('MUTATION M6 CATCHER: executing before expiry mutates nothing and claims nothing', async () => {
    const applied = await executeRetention(new Date(ELIGIBLE_AT.getTime() - 1));
    expect(applied).toEqual([]);
    expect(await total('pilot_retention_log')).toBe(0);
    for (const [t, cols] of Object.entries(SUBJECT_COLUMNS))
      expect({ t, n: await count(t, cols, S1) }).toEqual({ t, n: expect.any(Number) });
    expect(await count('pilot_events', ['user_id'], S1)).toBe(1);
    expect(await count('pilot_monitor_events', ['actor_id', 'subject_user_id'], S1)).toBe(1);
    expect(await pseudonymOf(S1)).toBeNull();   // not even a pseudonym was minted
  });
});

/* ============================ D13-C / D13-D — execution ============================ */

describe('D13-C and D13-D — what the six classes actually do', () => {
  beforeEach(seed);

  it('POSITIVE CONTROL: before the run, every class names the participant', async () => {
    for (const [t, cols] of Object.entries(SUBJECT_COLUMNS))
      expect({ t, n: await count(t, cols, S1) }).toEqual({ t, n: 1 });
  });

  it('THE SIX-CLASS MATRIX: five pseudonymize, one deletes', async () => {
    await executeRetention(ELIGIBLE_AT);
    const p1 = await pseudonymOf(S1);
    expect(p1).not.toBeNull();

    for (const c of RETENTION_CLASSES) {
      const cols = SUBJECT_COLUMNS[c.name];
      // In every class, nothing names the participant any more.
      expect({ c: c.name, named: await count(c.name, cols, S1) })
        .toEqual({ c: c.name, named: 0 });

      if (c.method === 'PSEUDONYMIZED') {
        // ...and the row SURVIVES under the pseudonym. This is the assertion that separates
        // D13-D's REPLACE from a deletion, which would satisfy the line above just as well.
        expect({ c: c.name, carried: await count(c.name, cols, p1!) })
          .toEqual({ c: c.name, carried: 1 });
      } else {
        // DELETE means the rows are gone from the table, not merely unlinked.
        expect({ c: c.name, carried: await count(c.name, cols, p1!) })
          .toEqual({ c: c.name, carried: 0 });
        expect({ c: c.name, rows: await total(c.name) }).toEqual({ c: c.name, rows: 0 });
      }
    }
  });

  it('D13-D: the FK is REPLACED, never set to NULL', async () => {
    await executeRetention(ELIGIBLE_AT);
    // pilot_lifecycle_events.subject_user_id is the one nullable subject column among the
    // pseudonymized classes, so it is the only place a P2 "sever by nulling" could hide.
    const { rows } = await query<{ n: number }>(
      'SELECT count(*)::int AS n FROM pilot_lifecycle_events WHERE subject_user_id IS NULL');
    expect(rows[0].n).toBe(0);
    for (const t of ['pilot_events', 'consents', 'pilot_enrollments', 'human_decisions',
                     'pilot_lifecycle_events'])
      expect(await total(t)).toBeGreaterThan(0);
  });

  it('D13-D: ONE STABLE PSEUDONYM per participant — the longitudinal association survives',
    async () => {
      await executeRetention(ELIGIBLE_AT);
      const p1 = await pseudonymOf(S1);
      const p2 = await pseudonymOf(S2);
      expect(p1).not.toBeNull();
      expect(p2).not.toBeNull();
      expect(p1).not.toBe(p2);                    // distinct participants stay distinguishable

      // event A and consent C, which belonged to the same participant, still point at the SAME
      // row afterwards. That is the association D13-D says to preserve.
      const { rows } = await query<{ ev: string; co: string; en: string; hd: string; le: string }>(
        `SELECT (SELECT user_id       FROM pilot_events           LIMIT 1) AS ev,
                (SELECT user_id       FROM consents               WHERE terms_digest = $2) AS co,
                (SELECT user_id       FROM pilot_enrollments      WHERE user_id = $1) AS en,
                (SELECT actor_id      FROM human_decisions        WHERE reason = $2) AS hd,
                (SELECT subject_user_id FROM pilot_lifecycle_events WHERE reason = $2) AS le`,
        [p1, `${CANARY}-s1`]);
      expect(rows[0].co).toBe(p1);
      expect(rows[0].en).toBe(p1);
      expect(rows[0].hd).toBe(p1);
      expect(rows[0].le).toBe(p1);
    });

  it('the pseudonym is NOT derived from the subject — nothing about the id is recoverable',
    async () => {
      await executeRetention(ELIGIBLE_AT);
      const p1 = (await pseudonymOf(S1))!;
      expect(p1).not.toBe(S1);
      const { rows } = await query<{ email: string }>(
        'SELECT email::text AS email FROM users WHERE id = $1', [p1]);
      const email = rows[0].email;
      // NP-018 measured that the pre-existing `deleted_${users.id}@...` form leaves the subject
      // id readable in the address. No fragment of the subject may appear here.
      expect(email).not.toContain(S1);
      for (const part of S1.split('-')) expect(email).not.toContain(part);
      expect(email).toMatch(/^pseudonym-[0-9a-f-]{36}@pseudonymous\.invalid$/);
    });

  it('SCOPE: a user who never enrolled is never pseudonymized', async () => {
    await executeRetention(ELIGIBLE_AT);
    // The staff actor's decision row still names the staff actor.
    const { rows } = await query<{ n: number }>(
      'SELECT count(*)::int AS n FROM human_decisions WHERE actor_id = $1', [ACTOR]);
    expect(rows[0].n).toBe(1);
    expect(await pseudonymOf(ACTOR)).toBeNull();
  });

  it('every claim names the method D13-C decided', async () => {
    await executeRetention(ELIGIBLE_AT);
    const { rows } = await query<{ data_class: string; method: string }>(
      'SELECT DISTINCT data_class, method FROM pilot_retention_log ORDER BY data_class');
    const byClass = new Map(rows.map((r) => [r.data_class, r.method]));
    for (const c of RETENTION_CLASSES)
      expect({ c: c.name, m: byClass.get(c.name) }).toEqual({ c: c.name, m: c.method });
  });
});

/* ============================ integrity after the run ============================ */

describe('the database is still intact after retention', () => {
  beforeEach(seed);

  it('FK VALIDATION: every rewritten subject column points at a real users row', async () => {
    await executeRetention(ELIGIBLE_AT);
    for (const [t, cols] of Object.entries(SUBJECT_COLUMNS)) {
      for (const col of cols) {
        const { rows } = await query<{ n: number }>(
          `SELECT count(*)::int AS n FROM ${t} x
           WHERE x.${col} IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = x.${col})`);
        expect({ t, col, dangling: rows[0].n }).toEqual({ t, col, dangling: 0 });
      }
    }
  });

  it('NO CONSTRAINT WAS RELAXED: the NOT NULL subject columns are still NOT NULL', async () => {
    const { rows } = await query<{ k: string }>(
      `SELECT table_name||'.'||column_name AS k FROM information_schema.columns
       WHERE table_schema = 'public' AND is_nullable = 'NO'
         AND table_name||'.'||column_name IN
             ('consents.user_id','pilot_enrollments.user_id','human_decisions.actor_id',
              'pilot_events.user_id','pilot_lifecycle_events.actor_user_id')`);
    expect(rows.map((r) => r.k).sort()).toEqual([
      'consents.user_id', 'human_decisions.actor_id', 'pilot_enrollments.user_id',
      'pilot_events.user_id', 'pilot_lifecycle_events.actor_user_id',
    ]);
  });

  it('WITHDRAWAL TERMINALITY holds THROUGH retention: a WITHDRAWN row stays WITHDRAWN', async () => {
    await query(`UPDATE pilot_enrollments SET state = 'WITHDRAWN' WHERE user_id = $1`, [S1]);
    await executeRetention(ELIGIBLE_AT);
    const p1 = (await pseudonymOf(S1))!;
    const { rows } = await query<{ state: string }>(
      'SELECT state FROM pilot_enrollments WHERE user_id = $1', [p1]);
    // The row moved to the pseudonym AND the terminal state survived the move. The 0023 trigger
    // refuses a transition OUT of WITHDRAWN, so pseudonymizing a withdrawn participant is only
    // possible because retention rewrites the SUBJECT and never the STATE.
    expect(rows[0].state).toBe('WITHDRAWN');
  });

  it('IDEMPOTENCY / FIXPOINT: a second run does nothing, and mints no second pseudonym', async () => {
    const first = await executeRetention(ELIGIBLE_AT);
    expect(first.length).toBe(EXECUTABLE_CLASSES.length * 2);   // six classes x two participants
    const p1 = await pseudonymOf(S1);
    const mappingsAfterFirst = await total('pilot_subject_pseudonyms');
    const usersAfterFirst = await total('users');

    const second = await executeRetention(ELIGIBLE_AT);
    expect(second).toEqual([]);
    // The pseudonym is the SAME one, no chain P(P(X)) was built, and no users row was minted.
    expect(await pseudonymOf(S1)).toBe(p1);
    expect(await total('pilot_subject_pseudonyms')).toBe(mappingsAfterFirst);
    expect(await total('users')).toBe(usersAfterFirst);
  });

  it('A HOLD still blocks, and a held run mutates nothing', async () => {
    await query(`INSERT INTO pilot_retention_holds (hold_class, reason, placed_by)
                 VALUES ('LEGAL','d13 hold',$1)`, [ACTOR]);
    expect(await executeRetention(ELIGIBLE_AT)).toEqual([]);
    expect(await total('pilot_retention_log')).toBe(0);
    expect(await count('pilot_events', ['user_id'], S1)).toBe(1);
    expect(await total('pilot_subject_pseudonyms')).toBe(0);
  });
});
