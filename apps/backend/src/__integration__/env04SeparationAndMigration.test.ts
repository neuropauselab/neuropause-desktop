/**
 * ENV04-R2 — REAL PILOT DATABASE PROVISIONING + SINGLE-SOURCE ENVIRONMENT RESOLUTION.
 *
 * TEST CLASS: REAL_POSTGRES, TWO GENUINELY SEPARATE DATABASES. No stub, no mock, no shared
 * database standing in for two.
 *
 * Requires TEST_PILOT_DATABASE_URL to name a database that is NOT TEST_DATABASE_URL. The suite
 * refuses to run otherwise rather than passing against a single store — a suite that silently
 * degrades to one database cannot measure isolation, and would report PASS for the exact
 * configuration ENV04 exists to forbid.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { pool as productPool } from '../db/pool';
import { pilotPool, identityOf, identityKey, resetPilotPool, PilotStoreNotConfigured } from '../db/pilotPool';
import {
  runMigrations, poolForTarget, assertTargetPool, MigrationTargetMismatch,
} from '../db/migrate';
import { loadPilotEnv, PILOT_RUNTIME_ENV_VARS } from '../config/pilotEnv';
import { resolvePilotEnvironment, configurationDigest, databaseNameOf } from '../pilot/environment';
import { sqlPilotMonitor } from '../pilot/monitor';
import { closeRedis } from '../cache/redis';

const PRODUCT_URL = process.env.DATABASE_URL!;
const PILOT_URL = process.env.PILOT_DATABASE_URL!;

const ENV_BASE: NodeJS.ProcessEnv = {
  PILOT_ENVIRONMENT_CLASS: 'PILOT',
  PILOT_ENVIRONMENT_ID: 'ENV04R2-ENV',
  PILOT_TARGET_ID: 'ENV04R2-TARGET',
  DATABASE_URL: PRODUCT_URL,
  PILOT_DATABASE_URL: PILOT_URL,
};

/** A second connection string reaching the SAME database as PRODUCT_URL, spelled differently. */
const disguisedProductUrl = (): string => {
  const u = new URL(PRODUCT_URL);
  u.hostname = u.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
  return u.toString();
};

beforeAll(async () => {
  expect(PRODUCT_URL, 'DATABASE_URL must be set').toBeTruthy();
  expect(PILOT_URL, 'PILOT_DATABASE_URL must be set').toBeTruthy();
  // THE PRECONDITION, ASSERTED NOT ASSUMED: two different databases, by server-reported identity.
  const [p, q] = await Promise.all([identityOf(productPool), identityOf(pilotPool(PILOT_URL))]);
  expect(identityKey(p), 'this suite requires a genuinely separate pilot database')
    .not.toBe(identityKey(q));

  // The pilot store must carry its own schema before anything can resolve against it - which is
  // ENV04-B's whole point, so it is exercised here as a precondition rather than mocked away.
  await runMigrations({ target: 'PILOT' });
  await pilotPool(PILOT_URL).query(
    `INSERT INTO pilot_environment_identity
       (id, environment_class, environment_id, target_id, declared_by)
     VALUES (true, 'PILOT', $1, $2, 'ENV04-R2 test harness')
     ON CONFLICT (id) DO UPDATE SET environment_id = $1, target_id = $2`,
    ['ENV04R2-ENV', 'ENV04R2-TARGET']);
}, 180_000);

afterAll(async () => { await resetPilotPool(); await productPool.end(); await closeRedis(); });

/* ===================== ENV04-A — ONE SOURCE OF TRUTH ===================== */

describe('ENV04-A — the declared, configured and connected pilot store are one value', () => {
  it('THE DEFECT, DIRECTLY: process.env cannot override the configuration it was handed', async () => {
    /*
     * This is the ENV04-A regression test, and it is the whole point of the seam.
     *
     * BEFORE: `resolvePilotEnvironment(env)` read the DECLARED store from `env` and the
     * CONNECTED store from `process.env` via `pilotPool()`. So poisoning `process.env` changed
     * which database the function actually reached while the argument said otherwise, and
     * nothing could observe the disagreement.
     *
     * AFTER: the argument is the only source. Poisoning process.env with an unreachable
     * database must change NOTHING.
     */
    const saved = process.env.PILOT_DATABASE_URL;
    process.env.PILOT_DATABASE_URL = 'postgres://nobody@127.0.0.1:1/definitely-not-a-database';
    try {
      await resetPilotPool();
      const r = await resolvePilotEnvironment(ENV_BASE);
      // Resolution followed the ARGUMENT. Under the old two-source code the poisoned global
      // would have been dialled instead and this would be PILOT_STORE_UNREACHABLE.
      expect(r).toEqual({ ok: true, record: expect.objectContaining({ environmentClass: 'PILOT' }) });
      const reached = await identityOf(pilotPool(PILOT_URL));
      expect(reached.database).toBe(databaseNameOf(PILOT_URL));
    } finally {
      if (saved === undefined) delete process.env.PILOT_DATABASE_URL;
      else process.env.PILOT_DATABASE_URL = saved;
      await resetPilotPool();
    }
  }, 30_000);

  it('loadPilotEnv is the one reader, and blank is ABSENT rather than ""', () => {
    expect(loadPilotEnv({ PILOT_DATABASE_URL: '   ' }).databaseUrl).toBeUndefined();
    expect(loadPilotEnv({ PILOT_DATABASE_URL: ` ${PILOT_URL} ` }).databaseUrl).toBe(PILOT_URL);
    expect(loadPilotEnv({}).databaseUrl).toBeUndefined();          // absent stays absent
  });

  it('SOURCE INVARIANT: neither pilotPool nor environment.ts reads process.env outside its entry default',
    async () => {
      const { readFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      for (const rel of [['db', 'pilotPool.ts'], ['pilot', 'environment.ts']]) {
        const body = readFileSync(join(__dirname, '..', ...rel), 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        expect(body, `${rel.join('/')} must not read process.env`).toContain('loadPilotEnv');
        // The ONLY permitted occurrence is a default parameter value.
        for (const m of body.matchAll(/process\.env(\.[A-Z_]+)?/g)) {
          const line = body.slice(0, m.index).split('\n').pop() ?? '';
          expect(line, `${rel.join('/')}: unexpected process.env read -> ${line.trim()}`)
            // The slice ends BEFORE the match, so a legitimate default parameter leaves a
            // line ending in `=`. Anything else is a mid-function read.
            .toMatch(/=\s*$/);
        }
      }
    });

  it('N4 — genuinely distinct databases RESOLVE', async () => {
    const r = await resolvePilotEnvironment(ENV_BASE);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.record.environmentId).toBe('ENV04R2-ENV');
      expect(r.record.targetId).toBe('ENV04R2-TARGET');
    }
  }, 20_000);

  it('N3 — the SAME url for both stores refuses before anything is dialled', async () => {
    const r = await resolvePilotEnvironment({ ...ENV_BASE, PILOT_DATABASE_URL: PRODUCT_URL });
    expect(r).toEqual({ ok: false, reason: 'PILOT_STORE_NOT_SEPARATED' });
  });

  it('N5 — TWO DIFFERENT URLS REACHING ONE DATABASE STILL FAIL ISOLATION', async () => {
    /*
     * The load-bearing test for "identity, not string comparison". The two strings differ, so
     * the cheap PILOT_STORE_NOT_SEPARATED check passes; only asking both servers which database
     * answered can catch it. localhost and 127.0.0.1 are the same PostgreSQL database here.
     */
    const disguised = disguisedProductUrl();
    expect(disguised).not.toBe(PRODUCT_URL);                       // control: the strings differ
    await resetPilotPool();
    try {
      const r = await resolvePilotEnvironment({ ...ENV_BASE, PILOT_DATABASE_URL: disguised });
      expect(r).toEqual({ ok: false, reason: 'PILOT_STORE_SAME_DATABASE' });
    } finally { await resetPilotPool(); }
  }, 30_000);

  it('an undeclared pilot store refuses, and never means "use the product database"', async () => {
    const env = { ...ENV_BASE }; delete env.PILOT_DATABASE_URL;
    expect(await resolvePilotEnvironment(env)).toEqual({ ok: false, reason: 'PILOT_STORE_NOT_DECLARED' });
  });

  it('the configuration digest carries neither connection string', () => {
    const d = configurationDigest(ENV_BASE);
    expect(d).toMatch(/^[0-9a-f]{64}$/);
    expect(d).not.toContain(PILOT_URL);
    // and it CHANGES when separation changes — a digest that ignored it would be decoration
    expect(configurationDigest({ ...ENV_BASE, PILOT_DATABASE_URL: PRODUCT_URL })).not.toBe(d);
  });
});

/* ===================== ENV04-B — REAL PILOT MIGRATION ===================== */

describe('ENV04-B — the pilot store has a migration path of its own', () => {
  it('the PILOT target migrates the PILOT database and creates the pilot tables', async () => {
    await runMigrations({ target: 'PILOT' });
    const db = pilotPool(PILOT_URL);
    const got = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' ORDER BY table_name`);
    const names = got.rows.map((r) => r.table_name);
    // The tables the first-pilot path actually needs, enumerated - never prefix-matched.
    for (const t of ['users', 'pilot_terms', 'consents', 'pilot_enrollments', 'pilot_events',
                     'pilot_lifecycle_events', 'human_decisions', 'pilot_monitor_events',
                     'pilot_closure', 'pilot_retention_log', 'pilot_retention_holds',
                     'pilot_subject_pseudonyms', 'pilot_environment_identity',
                     'schema_migrations'])
      expect(names, `missing pilot table ${t}`).toContain(t);
  }, 120_000);

  it('the pilot NOT NULL subject FKs are really enforced in the PILOT database', async () => {
    const db = pilotPool(PILOT_URL);
    const { rows } = await db.query<{ k: string }>(
      `SELECT table_name||'.'||column_name AS k FROM information_schema.columns
       WHERE table_schema='public' AND is_nullable='NO'
         AND table_name||'.'||column_name IN
             ('consents.user_id','pilot_enrollments.user_id','human_decisions.actor_id',
              'pilot_events.user_id','pilot_lifecycle_events.actor_user_id')`);
    expect(rows.map((r) => r.k).sort()).toEqual([
      'consents.user_id', 'human_decisions.actor_id', 'pilot_enrollments.user_id',
      'pilot_events.user_id', 'pilot_lifecycle_events.actor_user_id',
    ]);
    // ...and the 12 FKs into users resolve LOCALLY, which is what makes a separate database
    // possible at all (NP-014's cross-database impossibility applies to FKs pointing at the
    // PRODUCT users; here users lives in the pilot database).
    const fk = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_constraint c
       JOIN pg_class r ON r.oid = c.confrelid
       WHERE c.contype='f' AND r.relname='users'`);
    expect(fk.rows[0].n).toBeGreaterThanOrEqual(12);
  }, 30_000);

  it('IDEMPOTENT: a second pilot run applies nothing new and the ledger stays coherent', async () => {
    const db = pilotPool(PILOT_URL);
    const before = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM schema_migrations');
    await runMigrations({ target: 'PILOT' });
    const after = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM schema_migrations');
    expect(after.rows[0].n).toBe(before.rows[0].n);
    const dup = await db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM (SELECT filename FROM schema_migrations GROUP BY filename HAVING count(*) > 1) d');
    expect(dup.rows[0].n).toBe(0);
  }, 120_000);

  it('PRODUCT migrations remain product-only and the two ledgers are independent', async () => {
    await runMigrations({ target: 'PRODUCT' });
    const [prod, pil] = await Promise.all([
      identityOf(productPool), identityOf(pilotPool(PILOT_URL)),
    ]);
    expect(identityKey(prod)).not.toBe(identityKey(pil));
    // Each database carries its OWN ledger; neither is a view of the other.
    const a = await productPool.query<{ n: number }>('SELECT count(*)::int AS n FROM schema_migrations');
    const b = await pilotPool(PILOT_URL).query<{ n: number }>('SELECT count(*)::int AS n FROM schema_migrations');
    expect(a.rows[0].n).toBeGreaterThan(0);
    expect(b.rows[0].n).toBeGreaterThan(0);
  }, 180_000);
});

/* ===================== ENV04-E — CROSS-TARGET NEGATIVE CONTROLS ===================== */

describe('ENV04-E — a migration cannot be pointed at the wrong store', () => {
  it('X1 — PILOT target with the PRODUCT pool is REFUSED', async () => {
    await expect(runMigrations({ target: 'PILOT', pool: productPool }))
      .rejects.toBeInstanceOf(MigrationTargetMismatch);
  }, 30_000);

  it('X2 — PRODUCT target with the PILOT pool is REFUSED', async () => {
    await expect(runMigrations({ target: 'PRODUCT', pool: pilotPool(PILOT_URL) }))
      .rejects.toBeInstanceOf(MigrationTargetMismatch);
  }, 30_000);

  it('X3 — with no pilot store configured, the PILOT target THROWS rather than falling back', async () => {
    const saved = process.env.PILOT_DATABASE_URL;
    delete process.env.PILOT_DATABASE_URL;
    try {
      await resetPilotPool();
      expect(() => poolForTarget('PILOT')).toThrow(PilotStoreNotConfigured);
    } finally {
      if (saved !== undefined) process.env.PILOT_DATABASE_URL = saved;
      await resetPilotPool();
    }
  });

  it('X4 — the PRODUCT target never resolves to the pilot store, even with one configured', async () => {
    expect(process.env.PILOT_DATABASE_URL).toBeTruthy();           // control: pilot IS configured
    const chosen = poolForTarget('PRODUCT');
    expect(chosen).toBe(productPool);
    const [c, p] = await Promise.all([identityOf(chosen), identityOf(pilotPool(PILOT_URL))]);
    expect(identityKey(c)).not.toBe(identityKey(p));
  }, 30_000);

  it('THE DEFAULT TARGET IS PRODUCT — found by mutation M7, which nothing else caught', async () => {
    /*
     * M7 flipped `opts.target ?? 'PRODUCT'` to `?? 'PILOT'` and the whole suite stayed green,
     * because every test here passes an explicit target. That is a real behaviour change, not an
     * inert mutation: roughly a dozen suites and any future caller use the no-argument form, so
     * under M7 a bare `runMigrations()` would migrate the PILOT database.
     *
     * The observable: with no pilot store configured, the PRODUCT default succeeds while a PILOT
     * default cannot even resolve a pool. So unsetting the variable makes the default's identity
     * visible without needing to inspect it.
     */
    const saved = process.env.PILOT_DATABASE_URL;
    delete process.env.PILOT_DATABASE_URL;
    try {
      await resetPilotPool();
      await expect(runMigrations()).resolves.toBeUndefined();
    } finally {
      if (saved !== undefined) process.env.PILOT_DATABASE_URL = saved;
      await resetPilotPool();
    }
  }, 60_000);

  it('a matching pool is ACCEPTED — the control proving X1/X2 refuse for the right reason',
    async () => {
      await expect(assertTargetPool('PILOT', pilotPool(PILOT_URL))).resolves.toBeUndefined();
      await expect(assertTargetPool('PRODUCT', productPool)).resolves.toBeUndefined();
      // and a DIFFERENT pool object reaching the same database is also accepted: the check is
      // on identity, not object equality
      const twin = new Pool({ connectionString: PILOT_URL, max: 1 });
      try { await expect(assertTargetPool('PILOT', twin)).resolves.toBeUndefined(); }
      finally { await twin.end(); }
    }, 30_000);
});

/* ===================== §18 — THE ENV CENSUS ===================== */

describe('§18 — the declared pilot runtime variables are exactly those the runtime reads', () => {
  it('every declared name is read somewhere in the runtime, and every read name is declared', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    const read = new Set<string>();
    for (const dir of ['pilot', 'db', 'config']) {
      const d = join(__dirname, '..', dir);
      for (const f of readdirSync(d).filter((x) => x.endsWith('.ts') && !x.endsWith('.test.ts'))) {
        const body = readFileSync(join(d, f), 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        for (const m of body.matchAll(/\benv\.(PILOT_[A-Z0-9_]+)/g)) read.add(m[1]);
        for (const m of body.matchAll(/\bPILOT_[A-Z0-9_]+:\s*present/g))
          read.add(m[0].split(':')[0].trim());
      }
    }
    expect(read.size).toBeGreaterThan(5);                          // vacuity guard
    expect([...read].sort()).toEqual([...PILOT_RUNTIME_ENV_VARS].sort());
  });
});

/* ===================== ENV04-D — PILOT MODULES REACH THE PILOT STORE ===================== */

describe('ENV04-D — the eight pilot modules connect to the pilot database, not the product one', () => {
  const PILOT_MODULES = [
    'alerts.ts', 'authorityStore.ts', 'capGovernance.ts', 'environment.ts',
    'governanceReadBack.ts', 'monitor.ts', 'repository.ts', 'retention.ts',
  ] as const;

  it('SOURCE: every pilot module that opens a connection opens the PILOT one', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    for (const f of PILOT_MODULES) {
      const body = readFileSync(join(__dirname, '..', 'pilot', f), 'utf8');
      expect(body, `${f} must import the pilot pool`).toContain("from '../db/pilotPool'");
      if (body.includes("from '../db/pool'")) {
        /*
         * environment.ts is the ONE permitted importer of the product pool, and only as
         * `productPool` for the separation comparison — it must never run pilot statements on
         * it. Any other module importing it, or this one importing `query`, is the crossover
         * ENV04 exists to forbid.
         */
        expect(f, `${f} imports the product pool`).toBe('environment.ts');
        expect(body).toContain("import { pool as productPool } from '../db/pool';");
        expect(body).not.toMatch(/import \{[^}]*\bquery\b[^}]*\} from '\.\.\/db\/pool'/);
      }
    }
  });

  it('CANARY: a write made through a real pilot module lands in the PILOT database only',
    async () => {
      /*
       * NP-014's canary, inverted. It configured a pilot, wrote through the pilot path, and
       * measured `current_database() = np014` — the PRODUCT store — which is how ENV04 was
       * proven open. The same measurement must now come back the other way round.
       *
       * Counted through SEPARATE connections to each database, not through the pools under
       * test: asking the suspect where it put something is not independent.
       */
      const canary = `ENV04R2-CANARY-${process.pid}`;
      const recorded = await sqlPilotMonitor.record({
        alertClass: 'UNAUTHORIZED_ACCESS', outcome: 'DENIED', reasonCode: canary,
      });
      expect(recorded, 'the pilot module must actually have written').not.toBeNull();

      const countIn = async (url: string): Promise<number> => {
        const c = new Pool({ connectionString: url, max: 1 });
        try {
          const { rows } = await c.query<{ n: number }>(
            'SELECT count(*)::int AS n FROM pilot_monitor_events WHERE reason_code = $1', [canary]);
          return rows[0].n;
        } finally { await c.end(); }
      };
      expect(await countIn(PILOT_URL), 'the row must be in the PILOT database').toBe(1);
      expect(await countIn(PRODUCT_URL), 'the row must NOT be in the product database').toBe(0);
    }, 60_000);

  it('PRODUCT REGRESSION: the product pool is still the product database', async () => {
    const id = await identityOf(productPool);
    expect(id.database).toBe(databaseNameOf(PRODUCT_URL));
    expect(id.database).not.toBe(databaseNameOf(PILOT_URL));
  }, 20_000);
});
