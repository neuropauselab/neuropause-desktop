/**
 * NP-PILOT-FIRST-014 §19 §20 §21 — the pilot environment boundary, fail-closed.
 *
 * These drive `resolvePilotEnvironment` and `decidePilotMount` with a stubbed DATABASE assertion
 * so every CONFIGURATION path is reachable without a container. The two-sided assertion itself
 * (config must agree with a row the database asserts) is pinned against real Postgres in
 * `src/__integration__/`.
 *
 * WHAT THESE EXIST TO PREVENT, in one line: `DATABASE_URL` silently meaning either pilot or
 * production.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const dbIdentity = vi.hoisted(() => vi.fn());
/**
 * ENV04-A made the mock's shape matter. `resolvePilotEnvironment` now reads the identity row
 * through `pilotPool(url).query(...)` rather than the module-level `query`, and it compares the
 * database the URL NAMES against the database the connection REPORTS. So the stub has to behave
 * like a pool that is actually connected to the URL it was handed — a stub that always answered
 * 'pilot_db' would trip the new configured-vs-actual check on every well-formed input, and a
 * stub with no `.query` would throw.
 *
 * Deriving the reported name FROM THE URL is what keeps these tests measuring the declaration
 * boundary rather than the new check, while leaving the new check able to fire if the two ever
 * genuinely disagreed.
 */
const seen = vi.hoisted(() => ({ pilotUrl: undefined as string | undefined }));
vi.mock('../db/pilotPool', () => ({
  query: dbIdentity,
  withTransaction: vi.fn(),
  pilotPool: (url?: string) => {
    seen.pilotUrl = url;
    return { tag: 'pilot', query: dbIdentity };
  },
  // The two pools must be DISTINGUISHABLE, or identityOf returns one identity for both and
  // the separation check correctly reports PILOT_STORE_SAME_DATABASE — denying upstream and
  // masking the declaration behaviour these tests exist to measure.
  identityOf: async (p: { tag?: string }) => ({
    database: p?.tag === 'pilot'
      ? (() => {
          try { return new URL(seen.pilotUrl ?? '').pathname.replace(/^\//, '') || 'pilot_db'; }
          catch { return 'pilot_db'; }
        })()
      : 'product_db',
    user: 'u', host: '10.0.0.1', port: 5432,
  }),
  identityKey: (i: { host: string; port: number; database: string }) => `${i.host}:${i.port}/${i.database}`,
}));
vi.mock('../db/pool', () => ({ pool: { tag: 'product' }, query: vi.fn(), withTransaction: vi.fn() }));

import { resolvePilotEnvironment, configurationDigest } from './environment';
import { decidePilotMount } from './mount';

const PILOT_STORE = 'postgres://pilot:x@pilot-host:5432/neuropause_pilot';
const PROD_STORE = 'postgres://prod:y@prod-host:5432/neuropause';
const ENV_ID = 'NP014-ENV';
const TARGET_ID = 'NP014-TARGET';

/** A fully valid configuration; individual tests remove or corrupt one field at a time. */
const full = (over: Record<string, string | undefined> = {}) => {
  const base: Record<string, string | undefined> = {
    PILOT_MODULE_ENABLED: 'true',
    PILOT_ENVIRONMENT_CLASS: 'PILOT',
    PILOT_ENVIRONMENT_ID: ENV_ID,
    PILOT_TARGET_ID: TARGET_ID,
    PILOT_DATABASE_URL: PILOT_STORE,
    DATABASE_URL: PROD_STORE,
    ...over,
  };
  for (const k of Object.keys(base)) if (base[k] === undefined) delete base[k];
  return base as NodeJS.ProcessEnv;
};

beforeEach(() => {
  dbIdentity.mockReset();
  // The database asserts the matching identity, so configuration is the only variable.
  dbIdentity.mockResolvedValue({
    rows: [{ environment_class: 'PILOT', environment_id: ENV_ID, target_id: TARGET_ID }],
  });
});
afterEach(() => { vi.restoreAllMocks(); });

describe('§19 — the pilot store must be DECLARED, or the pilot cannot start', () => {
  it('PILOT_DATABASE_URL absent -> PILOT_STORE_NOT_DECLARED', async () => {
    expect(await resolvePilotEnvironment(full({ PILOT_DATABASE_URL: undefined })))
      .toEqual({ ok: false, reason: 'PILOT_STORE_NOT_DECLARED' });
  });

  it.each(['', '   '])('PILOT_DATABASE_URL=%j is not a declaration', async (v) => {
    expect(await resolvePilotEnvironment(full({ PILOT_DATABASE_URL: v })))
      .toEqual({ ok: false, reason: 'PILOT_STORE_NOT_DECLARED' });
  });

  it('with the store declared and distinct, the environment RESOLVES', async () => {
    const r = await resolvePilotEnvironment(full());
    expect(r.ok).toBe(true);
  });

  it('the pilot cannot MOUNT without the store', async () => {
    expect(await decidePilotMount(full({ PILOT_DATABASE_URL: undefined })))
      .toEqual({ mounted: false, reason: 'PILOT_STORE_NOT_DECLARED' });
  });
});

describe('§20 — production contamination: DATABASE_URL must never mean either', () => {
  it('pilot store EQUAL to the production store -> PILOT_STORE_NOT_SEPARATED', async () => {
    expect(await resolvePilotEnvironment(full({ PILOT_DATABASE_URL: PROD_STORE })))
      .toEqual({ ok: false, reason: 'PILOT_STORE_NOT_SEPARATED' });
  });

  it('ONLY a production DATABASE_URL exists -> the pilot REFUSES TO START', async () => {
    // The shape §20 names: a deployment that has a database, and no pilot store.
    const prodOnly = { PILOT_MODULE_ENABLED: 'true', PILOT_ENVIRONMENT_CLASS: 'PILOT',
      PILOT_ENVIRONMENT_ID: ENV_ID, PILOT_TARGET_ID: TARGET_ID,
      DATABASE_URL: PROD_STORE } as NodeJS.ProcessEnv;
    expect(await decidePilotMount(prodOnly)).toEqual({ mounted: false, reason: 'PILOT_STORE_NOT_DECLARED' });
  });

  it('separation is judged on the DECLARED VALUES, and the digest never carries either', () => {
    const d = configurationDigest(full());
    expect(d).toMatch(/^[0-9a-f]{64}$/);
    // Changing only the SECRET portion must not change the digest: presence and separation are
    // what is recorded, never the connection strings themselves.
    const sameShape = configurationDigest(full({
      PILOT_DATABASE_URL: 'postgres://pilot:DIFFERENT@pilot-host:5432/neuropause_pilot',
      DATABASE_URL: 'postgres://prod:DIFFERENT@prod-host:5432/neuropause',
    }));
    expect(sameShape).toBe(d);
    // but REMOVING the pilot store changes it
    expect(configurationDigest(full({ PILOT_DATABASE_URL: undefined }))).not.toBe(d);
  });
});

describe('§21 — environment class: no implicit default in either direction', () => {
  it.each([
    ['PILOT', null],
    ['PRODUCTION', 'ENVIRONMENT_CLASS_NOT_PILOT'],
    ['UNKNOWN', 'ENVIRONMENT_CLASS_NOT_PILOT'],
    ['unknown', 'ENVIRONMENT_CLASS_NOT_PILOT'],
    ['pilot', 'ENVIRONMENT_CLASS_NOT_PILOT'],
    ['Pilot', 'ENVIRONMENT_CLASS_NOT_PILOT'],
    ['', 'ENVIRONMENT_CLASS_NOT_DECLARED'],
    ['   ', 'ENVIRONMENT_CLASS_NOT_DECLARED'],
  ])('class %j -> %s', async (cls, reason) => {
    const r = await resolvePilotEnvironment(full({ PILOT_ENVIRONMENT_CLASS: cls }));
    if (reason === null) expect(r.ok).toBe(true);
    else expect(r).toEqual({ ok: false, reason });
  });

  it('MISSING class -> DENY, never a default', async () => {
    expect(await resolvePilotEnvironment(full({ PILOT_ENVIRONMENT_CLASS: undefined })))
      .toEqual({ ok: false, reason: 'ENVIRONMENT_CLASS_NOT_DECLARED' });
  });

  it('there is no implicit default to PILOT anywhere in the resolver source', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(__dirname, 'environment.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // `?? 'PILOT'` or `|| 'PILOT'` would be a default; the literal may only appear in
    // comparisons and in the returned record of an already-validated environment.
    expect(src).not.toMatch(/\?\?\s*'PILOT'/);
    expect(src).not.toMatch(/\|\|\s*'PILOT'/);
    expect(src).not.toMatch(/\?\?\s*'PRODUCTION'/);
  });
});

describe('§21 — the DATABASE side is equally strict', () => {
  it('database asserts PRODUCTION -> TARGET_CLASS_NOT_PILOT', async () => {
    dbIdentity.mockResolvedValue({
      rows: [{ environment_class: 'PRODUCTION', environment_id: ENV_ID, target_id: TARGET_ID }],
    });
    expect(await resolvePilotEnvironment(full())).toEqual({ ok: false, reason: 'TARGET_CLASS_NOT_PILOT' });
  });

  it('database asserts NOTHING -> TARGET_IDENTITY_ABSENT (the production case)', async () => {
    dbIdentity.mockResolvedValue({ rows: [] });
    expect(await resolvePilotEnvironment(full())).toEqual({ ok: false, reason: 'TARGET_IDENTITY_ABSENT' });
  });

  it('database asserts a DIFFERENT target -> TARGET_IDENTITY_MISMATCH', async () => {
    dbIdentity.mockResolvedValue({
      rows: [{ environment_class: 'PILOT', environment_id: ENV_ID, target_id: 'SOMEWHERE-ELSE' }],
    });
    expect(await resolvePilotEnvironment(full())).toEqual({ ok: false, reason: 'TARGET_IDENTITY_MISMATCH' });
  });
});

/* ===================================================================================
 * NP-015 — the evidence record must carry MEASURED classes, not hard-coded literals.
 *
 * TEST CLASS: REAL resolver, IN_MEMORY env, no stub.
 *
 * NP-014 hard-coded `environmentClass: 'PILOT'` and `targetClass: 'PILOT'` into the record
 * after checking both. The values were correct, so nothing was wrong at runtime - but the
 * evaluator's downstream `PRODUCTION_TARGET_DENIED` guard became UNREACHABLE, because the only
 * real producer of an AuthorityEnvironment could no longer emit anything but 'PILOT'. A guard
 * whose input cannot vary is decoration, which is the ENG-13 lesson at a third site.
 * =================================================================================== */
describe('NP-015 — the record carries what was measured', () => {
  it('environmentClass is the CONFIGURED value, carried through rather than assumed', async () => {
    const r = await resolvePilotEnvironment(full());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.record.environmentClass).toBe('PILOT');
    // Falsifiability: this is the value the CONFIG declared. Re-hard-coding the literal would
    // make the assertion pass for the wrong reason, so the sibling below pins the mechanism.
    expect(r.record.targetClass).toBe('PILOT');
  });

  it('SOURCE INVARIANT: the record assigns no hard-coded class literal', () => {
    // A source-level pin, because the behavioural one cannot reach this: the upstream refusals
    // mean a non-PILOT value can never flow through in a correct build, so only a mutation or a
    // source read distinguishes a carried value from a hard-coded one. NP-013 recorded that
    // source-level invariants beat behavioural ones for exactly this class.
    //
    // MEASURED CONSEQUENCE of getting it wrong (NP-015 three-way mutation): with the class
    // hard-coded, removing the upstream refusal laundered a PRODUCTION environment into a PILOT
    // record and the evaluator's PRODUCTION_TARGET_DENIED guard NEVER FIRED. With the value
    // carried, the same mutation is caught downstream as DENY/PRODUCTION_TARGET_DENIED.
    const src = readFileSync(join(__dirname, 'environment.ts'), 'utf8');
    expect(src).toContain('environmentId');                       // vacuity guard, FIRST
    expect(src).not.toMatch(/environmentClass:\s*'PILOT'/);
    expect(src).not.toMatch(/targetClass:\s*'PILOT'/);
    expect(src).toMatch(/environmentClass:\s*declaredClass/);
    expect(src).toMatch(/targetClass:\s*row\.environment_class/);
  });

  it('targetClass provenance is NOT behaviourally observable, and here is why', async () => {
    // NP-016 CORRECTION. This test previously asserted only
    //     expect(typeof rec.environmentClass).toBe('string')
    //     expect(typeof rec.targetClass).toBe('string')
    // under the title "targetClass comes from the DATABASE ROW". A string LITERAL is also
    // typeof 'string', so reverting environment.ts to the hard-coded 'PILOT' left every
    // assertion true. It was a guard that could not fail, introduced by the very commit whose
    // subject was removing guards that cannot fail. Found by the NP-016 fan-out.
    //
    // The honest statement is that this property CANNOT be pinned behaviourally:
    //   0018_pilot_governance_controls.sql:27 declares
    //     environment_class text NOT NULL CHECK (environment_class = 'PILOT')
    //   so row.environment_class can only ever be 'PILOT' in any correctly migrated database,
    //   and environment.ts's `row.environment_class !== 'PILOT'` refusal is unreachable against
    //   one. That is the ENG-13 shape again - a guard masked by a CHECK the table owner can
    //   drop - and it is recorded rather than papered over.
    //
    // Provenance is therefore pinned at SOURCE level by the sibling test above, which IS
    // falsifiable (verified: re-hard-coding either field fails it). This test asserts only the
    // fact that makes the source pin necessary.
    const r = await resolvePilotEnvironment(full());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.record.targetClass).toBe('PILOT');   // the ONLY value the CHECK permits
    const ddl = readFileSync(
      join(__dirname, '..', 'db', 'migrations', '0018_pilot_governance_controls.sql'), 'utf8');
    expect(ddl).toContain("environment_class text NOT NULL CHECK (environment_class = 'PILOT')");
  });
});
