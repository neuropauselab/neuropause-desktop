/**
 * NP-PILOT-FIRST-009 — ENG-07, ENG-08 and ENG-10 against REAL Postgres.
 *
 * §33: every claim here concerns transaction ordering, uniqueness, or what a query actually
 * returns from persisted rows, so none of it may rest on an in-memory double.
 */
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { closePool, query } from '../db/pool';
import { closeRedis } from '../cache/redis';
import { runMigrations } from '../db/migrate';
import { sqlPilotMonitor } from '../pilot/monitor';
import { dispatchAlert, ledgerAlertSink, resolveAlertSink, createFileAlertSink, type AlertSink } from '../pilot/alerts';
import { governanceReadBack } from '../pilot/governanceReadBack';
import { setPilotCap } from '../pilot/capGovernance';
import { sqlPilotRepository } from '../pilot/repository';
import { PilotError } from '../pilot/types';
import { resolvePilotEnvironment, configurationDigest } from '../pilot/environment';

const ACTOR = '66666666-6666-4666-8666-000000000001';
const ENV_ID = 'NP009-PILOT-ENV';
const TARGET_ID = 'NP009-PILOT-TARGET';
const PILOT_ENV = async () => ({ environmentClass: 'PILOT', environmentId: ENV_ID });
const PROD_ENV = async () => ({ environmentClass: 'PRODUCTION', environmentId: 'prod' });
const NO_ENV = async () => null;
const ALLOW = { evaluate: () => 'ALLOW' as const };   // SYNTHETIC_TEST_IDENTITY — grants nothing in production
const DENY = { evaluate: () => 'DENY' as const };

beforeAll(async () => { await runMigrations(); });
afterAll(async () => { await closePool(); await closeRedis(); });

async function reset() {
  await query(`TRUNCATE pilot_alert_deliveries, pilot_cap_decisions, pilot_monitor_events,
               pilot_retention_log, pilot_retention_holds, pilot_closure,
               pilot_authority_decisions, pilot_role_bindings, pilot_environment_identity,
               pilot_lifecycle_events, pilot_events, human_decisions, pilot_enrollments,
               consents, pilot_terms RESTART IDENTITY CASCADE`);
  await query('DELETE FROM pilot_control');
  await query('INSERT INTO pilot_control (id, stopped) VALUES (true, false)');
  await query("INSERT INTO users (id, email, password_hash) VALUES ($1,$2,'x') ON CONFLICT (id) DO NOTHING",
    [ACTOR, `${ACTOR}@np009.invalid`]);
  await query(`INSERT INTO pilot_environment_identity (environment_class, environment_id, target_id, declared_by)
               VALUES ('PILOT', $1, $2, 'NP-009 harness')`, [ENV_ID, TARGET_ID]);
}

const escalatedEvent = async () =>
  (await sqlPilotMonitor.record({
    alertClass: 'PRODUCTION_PATH_ATTEMPT', outcome: 'BLOCKED',
    reasonCode: 'PRODUCTION_TARGET_DENIED', actorId: ACTOR, action: 'pilot.stop',
    detail: { note: 'synthetic' },
  }))!;

/* ==================================================================================== */
describe('ENG-07 — alert delivery', () => {
  beforeEach(() => reset());

  it('§7 B a mandatory stop condition produces exactly one alert', async () => {
    const ev = await escalatedEvent();
    expect(await dispatchAlert(ev.id, { sink: ledgerAlertSink, environment: PILOT_ENV }))
      .toEqual({ status: 'DELIVERED', sink: 'ledger' });
    const { rows } = await query('SELECT * FROM pilot_alert_deliveries');
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('DELIVERED');
  });

  it('§7 A a non-escalated event produces NO alert', async () => {
    // Every class is CRITICAL by table, so a non-escalated row is constructed directly —
    // which is also the honest way to test it, since no caller can create one.
    const { rows } = await query(
      `INSERT INTO pilot_monitor_events (alert_class, severity, outcome, reason_code, escalated)
       VALUES ('SECURITY_INCIDENT','INFO','RECORDED','TEST', false) RETURNING id`);
    expect(await dispatchAlert(rows[0].id, { sink: ledgerAlertSink, environment: PILOT_ENV }))
      .toEqual({ status: 'NOT_ESCALATED' });
    expect((await query('SELECT count(*)::int AS n FROM pilot_alert_deliveries')).rows[0].n).toBe(0);
  });

  it('§7 C the alert carries id, class, timestamp, environment identity and escalation', async () => {
    const ev = await escalatedEvent();
    await dispatchAlert(ev.id, { sink: ledgerAlertSink, environment: PILOT_ENV });
    const p = (await query('SELECT payload FROM pilot_alert_deliveries')).rows[0].payload;
    expect(p).toMatchObject({
      monitorEventId: ev.id, alertClass: 'PRODUCTION_PATH_ATTEMPT', severity: 'CRITICAL',
      escalated: true, environmentClass: 'PILOT', environmentId: ENV_ID,
    });
    expect(typeof p.occurredAt).toBe('string');
  });

  it('§7 D the alert carries NO detail, reason text, credential or raw error', async () => {
    const ev = await escalatedEvent();
    await dispatchAlert(ev.id, { sink: ledgerAlertSink, environment: PILOT_ENV });
    const p = (await query('SELECT payload FROM pilot_alert_deliveries')).rows[0].payload;
    expect(p).not.toHaveProperty('detail');
    expect(p).not.toHaveProperty('actorId');
    const text = JSON.stringify(p).toLowerCase();
    for (const forbidden of ['synthetic', 'password', 'secret', 'postgres://', 'token', 'failing row'])
      expect(text).not.toContain(forbidden);
  });

  it('§7 E a sink failure records FAILED and LEAVES the monitor event intact', async () => {
    const ev = await escalatedEvent();
    const broken: AlertSink = { name: 'file', deliver: async () => { throw new Error('boom https://prod/hook?token=SECRET'); } };
    const r = await dispatchAlert(ev.id, { sink: broken, environment: PILOT_ENV });
    expect(r).toEqual({ status: 'FAILED', sink: 'file', failureReason: 'SINK_DELIVERY_FAILED' });
    // the detection survives
    expect((await query('SELECT count(*)::int AS n FROM pilot_monitor_events WHERE id=$1', [ev.id])).rows[0].n).toBe(1);
    // and the provider's error text does not reach the ledger
    const row = (await query('SELECT * FROM pilot_alert_deliveries')).rows[0];
    expect(row.status).toBe('FAILED');
    expect(row.failure_reason).toBe('SINK_DELIVERY_FAILED');
    expect(JSON.stringify(row)).not.toContain('SECRET');
    expect(JSON.stringify(row)).not.toContain('prod/hook');
  });

  it('§7 F a failure is reported as FAILED, never as success', async () => {
    const ev = await escalatedEvent();
    const broken: AlertSink = { name: 'ledger', deliver: async () => { throw new Error('x'); } };
    const r = await dispatchAlert(ev.id, { sink: broken, environment: PILOT_ENV });
    expect(r.status).toBe('FAILED');
    expect(r.status).not.toBe('DELIVERED');
  });

  it('§7 H a replayed alert creates no second delivery', async () => {
    const ev = await escalatedEvent();
    await dispatchAlert(ev.id, { sink: ledgerAlertSink, environment: PILOT_ENV });
    expect(await dispatchAlert(ev.id, { sink: ledgerAlertSink, environment: PILOT_ENV }))
      .toEqual({ status: 'ALREADY_DISPATCHED' });
    expect((await query('SELECT count(*)::int AS n FROM pilot_alert_deliveries')).rows[0].n).toBe(1);
  });

  it('§7 G an alert has no way to resume, enroll, decide or terminate', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(join(__dirname, '..', 'pilot', 'alerts.ts'), 'utf8');
    const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const verb of ['resumePilot', 'stopPilot', 'enroll(', 'applyHumanDecision', 'terminateParticipation', 'setPilotCap'])
      expect(body).not.toContain(verb);
  });

  it('§6 the default sink needs NO credential and NO network', async () => {
    expect(resolveAlertSink({} as NodeJS.ProcessEnv).name).toBe('ledger');
    // an unconfigured file sink falls back to the ledger, never to silence
    expect(resolveAlertSink({ PILOT_ALERT_SINK: 'file' } as NodeJS.ProcessEnv).name).toBe('ledger');
    expect(createFileAlertSink('/tmp/x').name).toBe('file');
  });

  it('an unknown monitor event cannot be alerted about', async () => {
    expect(await dispatchAlert('77777777-7777-4777-8777-000000000099',
      { sink: ledgerAlertSink, environment: PILOT_ENV })).toEqual({ status: 'EVENT_NOT_FOUND' });
  });

  it('an alert from an unestablished environment SAYS SO rather than omitting it', async () => {
    const ev = await escalatedEvent();
    await dispatchAlert(ev.id, { sink: ledgerAlertSink, environment: NO_ENV });
    const p = (await query('SELECT payload FROM pilot_alert_deliveries')).rows[0].payload;
    expect(p.environmentClass).toBe('NOT_ESTABLISHED');
  });
});

/* ==================================================================================== */
describe('ENG-08 — the governance read-back', () => {
  beforeEach(() => reset());

  it('§9 an unauthorized caller is DENIED and the refusal is recorded', async () => {
    await expect(governanceReadBack(
      { repo: sqlPilotRepository, authority: DENY, environment: PILOT_ENV, monitor: sqlPilotMonitor }, ACTOR))
      .rejects.toMatchObject({ code: 'not_authorized' });
    const { rows } = await query('SELECT alert_class, reason_code FROM pilot_monitor_events');
    expect(rows[0]).toMatchObject({ alert_class: 'UNAUTHORIZED_ACCESS', reason_code: 'READ_BACK_NOT_AUTHORIZED' });
  });

  it('§9 NO authority evaluator (the production shape) is also DENIED', async () => {
    await expect(governanceReadBack({ repo: sqlPilotRepository, environment: PILOT_ENV }, ACTOR))
      .rejects.toBeInstanceOf(PilotError);
  });

  it('an authorized caller receives the governance shape', async () => {
    const g = await governanceReadBack(
      { repo: sqlPilotRepository, authority: ALLOW, environment: PILOT_ENV }, ACTOR);
    expect(g.environment).toEqual({ established: true, environmentClass: 'PILOT', environmentId: ENV_ID });
    expect(g.pilot.maxParticipants).toBeNull();
    expect(g.pilot.capDecisionRecorded).toBe(false);
    expect(g.terms.publishedCount).toBe(0);
    expect(g.authority.roleBindings).toBe(0);
    expect(g.participation.total).toBe(0);
  });

  it('a MISSING control singleton reads as STOPPED, not as running', async () => {
    await query('DELETE FROM pilot_control');
    const g = await governanceReadBack(
      { repo: sqlPilotRepository, authority: ALLOW, environment: PILOT_ENV }, ACTOR);
    expect(g.pilot.stopped).toBe(true);
  });

  it('§10 it returns no free text, no operator reason, no email, no credential', async () => {
    // Plant the things that must NOT come back.
    await query(`INSERT INTO pilot_terms (version, status, digest, content_reference, published_at)
                 VALUES ('v1','PUBLISHED','DIGEST-1','/secret/path/to/terms.md', now())`);
    await sqlPilotMonitor.record({ alertClass: 'SECURITY_INCIDENT', outcome: 'DENIED',
      reasonCode: 'TEST', detail: { note: 'CANARY-OPERATOR-FREE-TEXT' } });
    const g = await governanceReadBack(
      { repo: sqlPilotRepository, authority: ALLOW, environment: PILOT_ENV }, ACTOR);
    const text = JSON.stringify(g);
    expect(text).not.toContain('CANARY-OPERATOR-FREE-TEXT');
    expect(text).not.toContain('/secret/path');       // content_reference is withheld
    expect(text).not.toContain('@np009.invalid');     // no email
    expect(text).not.toContain('postgres://');
    // but the governance facts ARE present
    expect(g.terms.versions).toEqual(['v1']);
    expect(g.terms.digests).toEqual(['DIGEST-1']);
  });

  it('§8 the module contains no write verb', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(join(__dirname, '..', 'pilot', 'governanceReadBack.ts'), 'utf8');
    const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const verb of ['INSERT ', 'UPDATE ', 'DELETE ', 'TRUNCATE ', 'DROP '])
      expect(body.toUpperCase()).not.toContain(verb);
  });
});

/* ==================================================================================== */
describe('ENG-10 — the governed cap write path', () => {
  beforeEach(() => reset());

  const deps = (over = {}) => ({ repo: sqlPilotRepository, authority: ALLOW, environment: PILOT_ENV,
                                  monitor: sqlPilotMonitor, ...over });

  it('§15 the cap starts NOT_SET, and NOT_SET is not unlimited', async () => {
    const { rows } = await query('SELECT max_participants FROM pilot_control WHERE id = true');
    expect(rows[0].max_participants).toBeNull();
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    '§15 cap %p is refused, and nothing is written', async (value) => {
      await expect(setPilotCap(deps(), ACTOR, value as number, 'r'))
        .rejects.toMatchObject({ code: 'cap_value_invalid' });
      expect((await query('SELECT count(*)::int AS n FROM pilot_cap_decisions')).rows[0].n).toBe(0);
      expect((await query('SELECT max_participants FROM pilot_control WHERE id=true')).rows[0].max_participants).toBeNull();
    });

  it('§14 an unauthorized caller is refused, recorded, and writes nothing', async () => {
    await expect(setPilotCap(deps({ authority: DENY }), ACTOR, 1, 'r'))
      .rejects.toMatchObject({ code: 'not_authorized' });
    expect((await query('SELECT count(*)::int AS n FROM pilot_cap_decisions')).rows[0].n).toBe(0);
    const { rows } = await query('SELECT alert_class FROM pilot_monitor_events');
    expect(rows[0].alert_class).toBe('UNAUTHORIZED_AUTHORITY');
  });

  it('§14 NO authority evaluator (production) is refused', async () => {
    await expect(setPilotCap({ repo: sqlPilotRepository, environment: PILOT_ENV }, ACTOR, 1, 'r'))
      .rejects.toMatchObject({ code: 'not_authorized' });
  });

  it('§14 a PRODUCTION environment is refused and recorded as a production-path attempt', async () => {
    await expect(setPilotCap(deps({ environment: PROD_ENV }), ACTOR, 1, 'r'))
      .rejects.toMatchObject({ code: 'cap_environment_invalid' });
    const { rows } = await query('SELECT alert_class FROM pilot_monitor_events');
    expect(rows[0].alert_class).toBe('PRODUCTION_PATH_ATTEMPT');
  });

  it('§14 an unestablished environment is refused', async () => {
    await expect(setPilotCap(deps({ environment: NO_ENV }), ACTOR, 1, 'r'))
      .rejects.toMatchObject({ code: 'cap_environment_invalid' });
  });

  it('the environment is checked BEFORE authority, so a prod caller learns nothing about bindings', async () => {
    await expect(setPilotCap(deps({ environment: PROD_ENV, authority: DENY }), ACTOR, 1, 'r'))
      .rejects.toMatchObject({ code: 'cap_environment_invalid' });
  });

  it('an authorized decision records the decision AND makes the cap effective', async () => {
    const d = await setPilotCap(deps(), ACTOR, 1, 'first pilot, single participant');
    expect(d.maxParticipants).toBe(1);
    expect(d.decidedBy).toBe(ACTOR);
    expect(d.environmentId).toBe(ENV_ID);
    expect(d.instrument).toBe('NOT_ESTABLISHED');   // never attributed to a document nobody cited
    expect((await query('SELECT max_participants FROM pilot_control WHERE id=true')).rows[0].max_participants).toBe(1);
  });

  it('§15 a later decision SUPERSEDES rather than replacing — both remain readable', async () => {
    const first = await setPilotCap(deps(), ACTOR, 1, 'one');
    const second = await setPilotCap(deps(), ACTOR, 5, 'five');
    const { rows } = await query('SELECT id, max_participants, superseded_by FROM pilot_cap_decisions ORDER BY decided_at');
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === first.id)!.superseded_by).toBe(second.id);
    expect(rows.find((r) => r.id === second.id)!.superseded_by).toBeNull();
    expect((await query('SELECT max_participants FROM pilot_control WHERE id=true')).rows[0].max_participants).toBe(5);
  });

  it('§15 concurrent cap decisions leave EXACTLY ONE active', async () => {
    await Promise.all([
      setPilotCap(deps(), ACTOR, 2, 'a'),
      setPilotCap(deps(), ACTOR, 3, 'b'),
    ]);
    const active = await query('SELECT count(*)::int AS n FROM pilot_cap_decisions WHERE superseded_by IS NULL');
    expect(active.rows[0].n).toBe(1);
    expect((await query('SELECT count(*)::int AS n FROM pilot_cap_decisions')).rows[0].n).toBe(2);
  });

  it('the schema itself refuses a non-positive cap decision', async () => {
    await expect(query(
      `INSERT INTO pilot_cap_decisions (decided_by, role, instrument, environment_id, max_participants, reason)
       VALUES ($1,'R','I','E',0,'r')`, [ACTOR])).rejects.toThrow();
  });
});

/* ==================================================================================== */
describe('§18 — the two-sided environment assertion, all four cases', () => {
  beforeEach(() => reset());

  const cfg = (over: Record<string, string> = {}) => ({
    PILOT_ENVIRONMENT_CLASS: 'PILOT', PILOT_ENVIRONMENT_ID: ENV_ID, PILOT_TARGET_ID: TARGET_ID,
    // ENV-04 (NP-014): declared and distinct from the product store, or resolution refuses.
    PILOT_DATABASE_URL: 'postgres://pilot@pilot-host:5432/neuropause_pilot',
    DATABASE_URL: 'postgres://prod@prod-host:5432/neuropause',
    ...over,
  } as NodeJS.ProcessEnv);

  it('config=PILOT db=PRODUCTION -> DENY', async () => {
    // The schema forbids a PRODUCTION identity row, so "db=PRODUCTION" is modelled the only
    // way it can exist in reality: a database with NO pilot identity at all.
    await query('DELETE FROM pilot_environment_identity');
    const r = await resolvePilotEnvironment(cfg());
    expect(r).toEqual({ ok: false, reason: 'TARGET_IDENTITY_ABSENT' });
  });

  it('config=PRODUCTION db=PILOT -> DENY', async () => {
    const r = await resolvePilotEnvironment(cfg({ PILOT_ENVIRONMENT_CLASS: 'PRODUCTION' }));
    expect(r).toEqual({ ok: false, reason: 'ENVIRONMENT_CLASS_NOT_PILOT' });
  });

  it('config=PILOT db=PILOT identity MISMATCH -> DENY', async () => {
    const r = await resolvePilotEnvironment(cfg({ PILOT_TARGET_ID: 'A-DIFFERENT-DATABASE' }));
    expect(r).toEqual({ ok: false, reason: 'TARGET_IDENTITY_MISMATCH' });
  });

  it('config=PILOT db=PILOT identity MATCH -> ALLOW', async () => {
    const r = await resolvePilotEnvironment(cfg());
    expect(r.ok).toBe(true);
  });

  it('§17 production cannot accidentally satisfy the pilot identity query', async () => {
    await expect(query(
      `INSERT INTO pilot_environment_identity (environment_class, environment_id, target_id, declared_by)
       VALUES ('PRODUCTION','x','y','z')`)).rejects.toThrow();
    // and the singleton primary key means a second identity cannot be smuggled in beside it
    await expect(query(
      `INSERT INTO pilot_environment_identity (environment_class, environment_id, target_id, declared_by)
       VALUES ('PILOT','other','other','z')`)).rejects.toThrow();
  });
});

/* ==================================================================================== */
describe('§6/§21 — the pilot alert sink is DEMONSTRABLY separate from production', () => {
  it('the pilot module never references the production alert webhook', async () => {
    const fs = await import('node:fs');
    const dir = join(__dirname, '..', 'pilot');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    expect(files.length).toBeGreaterThan(8);           // vacuity guard
    for (const f of files) {
      const src = fs.readFileSync(join(dir, f), 'utf8');
      // The production sink is src/observability/alertWebhookSink.ts and is reached via
      // ALERT_WEBHOOK_URL. If the pilot ever imports it, a pilot stop condition could page a
      // production channel - which is precisely the coupling §6 forbids.
      expect(src).not.toContain('ALERT_WEBHOOK');
      expect(src).not.toContain('alertWebhookSink');
    }
  });

  it('§21 the pilot module reaches no deploy, publish, release, mail or cloud surface', async () => {
    const fs = await import('node:fs');
    const dir = join(__dirname, '..', 'pilot');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    for (const f of files) {
      const body = fs.readFileSync(join(dir, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const forbidden of ['AWS_', 'AZURE_', 'GCP_', 'CLOUDFLARE_', 'SMTP_', 'MAIL_',
                               'DEPLOY_', 'SSH_', 'PUBLISH_', 'RELEASE_', 'nodemailer', 'fetch('])
        expect(body, `${f} references ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('§20 the pilot reads only PILOT_* configuration, plus DATABASE_URL PRESENCE', async () => {
    const fs = await import('node:fs');
    const dir = join(__dirname, '..', 'pilot');
    const reads = new Set<string>();
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.ts') && !x.endsWith('.test.ts'))) {
      const body = fs.readFileSync(join(dir, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const m of body.matchAll(/env\.([A-Z][A-Z0-9_]+)/g)) reads.add(m[1]);
    }
    // DATABASE_URL appears only as `env.DATABASE_URL !== undefined` — presence, never value.
    expect([...reads].sort()).toEqual([
      // DATABASE_URL appears only as a PRESENCE check and as the value PILOT_DATABASE_URL is
      // compared against for separation — never as a connection the pilot opens.
      'DATABASE_URL', 'NODE_ENV', 'PILOT_ALERT_DIR', 'PILOT_ALERT_SINK',
      'PILOT_DATABASE_URL', 'PILOT_ENVIRONMENT_CLASS', 'PILOT_ENVIRONMENT_ID',
      'PILOT_MODULE_ENABLED', 'PILOT_TARGET_ID',
    ]);
  });
});

/* ===================================================================================
 * §35 (environment) — the two cases nothing covered: the declared pilot store is
 * UNREACHABLE, and REACHABLE BUT WITH WRONG CREDENTIALS.
 *
 * These document a GAP, and they are written to fail the day it closes. ENV-04 (NP-014) makes
 * the pilot refuse unless a pilot store is DECLARED and DISTINCT from the product store. It
 * does not make anything connect to it: `src/db/pool.ts:8` builds the single pool from
 * `DATABASE_URL`, `pilot/repository.ts` imports `query` from that pool, and outside
 * `environment.ts` there is no non-test read of PILOT_DATABASE_URL anywhere in src/.
 *
 * So a pilot store that does not exist, is switched off, or rejects its own password resolves
 * EXACTLY as well as a healthy one. The §18 canary measured the same thing from the other
 * side: configured with a separate pilot store, the application reported
 * current_database()=np014 - the PRODUCT store - and every statement landed there.
 * =================================================================================== */
describe('§35 — a declared pilot store is never contacted, so its health is unmeasured', () => {
  beforeEach(() => reset());
  const base = {
    PILOT_ENVIRONMENT_CLASS: 'PILOT', PILOT_ENVIRONMENT_ID: ENV_ID, PILOT_TARGET_ID: TARGET_ID,
    DATABASE_URL: 'postgres://prod@prod-host:5432/neuropause',
  };
  // Port 1 is reserved and nothing listens there; these never resolve to a live server.
  const UNREACHABLE = 'postgres://pilot@127.0.0.1:1/neuropause_pilot';
  const WRONG_CREDS = 'postgres://pilot:definitely-not-the-password@127.0.0.1:55443/neuropause_pilot';

  it('POSITIVE CONTROL: a well-formed, separated pilot store resolves', async () => {
    const r = await resolvePilotEnvironment({
      ...base, PILOT_DATABASE_URL: 'postgres://pilot@pilot-host:5432/neuropause_pilot',
    } as NodeJS.ProcessEnv);
    expect(r.ok).toBe(true);
  });

  it('an UNREACHABLE pilot store resolves identically — nothing dials it', async () => {
    const r = await resolvePilotEnvironment({ ...base, PILOT_DATABASE_URL: UNREACHABLE } as NodeJS.ProcessEnv);
    expect(r.ok).toBe(true);          // <-- the gap: unreachable is indistinguishable from healthy
  });

  it('WRONG CREDENTIALS for the pilot store resolve identically — nothing authenticates', async () => {
    const r = await resolvePilotEnvironment({ ...base, PILOT_DATABASE_URL: WRONG_CREDS } as NodeJS.ProcessEnv);
    expect(r.ok).toBe(true);          // <-- same gap, second shape
  });

  it('and the two failure modes are not even distinguishable from each other in the digest', () => {
    // The digest records PRESENCE and SEPARATION. Both strings are present and both differ from
    // DATABASE_URL, so a dead store and a mis-credentialled one produce the SAME evidence value.
    expect(configurationDigest({ ...base, PILOT_DATABASE_URL: UNREACHABLE } as NodeJS.ProcessEnv))
      .toBe(configurationDigest({ ...base, PILOT_DATABASE_URL: WRONG_CREDS } as NodeJS.ProcessEnv));
  });
});
