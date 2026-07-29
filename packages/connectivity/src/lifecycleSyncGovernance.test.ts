import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime, type EnterpriseRuntime } from '@neuropause/runtime';
import { createPgliteDriver, type PgliteDriver } from '@neuropause/persistence';
import { FakeHttpClient } from '@neuropause/integrations';
import { createNemsPlatform, systemContext, type NemsPlatform } from '@neuropause/nems';
import { createConnectivityPlatform, type ConnectivityPlatform } from './platform';
import { functionSearchSource } from './search';

describe('Modules 1,3,12,13 — Lifecycle, Sync, Search & Governance (integration)', () => {
  let runtime: EnterpriseRuntime;
  let driver: PgliteDriver;
  let nems: NemsPlatform;
  let plat: ConnectivityPlatform;
  let clock: ManualClock;
  let acme: string;
  let globex: string;

  beforeAll(async () => {
    clock = new ManualClock(1_000_000);
    runtime = createEnterpriseRuntime({ clock });
    driver = await createPgliteDriver();
    nems = createNemsPlatform(runtime, { driver, clock });
    await nems.migrate();
    acme = (await nems.organizations().create({ name: 'Acme', slug: 'acme' })).id;
    globex = (await nems.organizations().create({ name: 'Globex', slug: 'globex' })).id;
    await nems.users().create(systemContext(acme), { email: 'ada@acme.test', password: 'pw', displayName: 'Ada Searchwell' });
    const http = new FakeHttpClient(() => ({ status: 200, ok: true, headers: {}, body: '[]' }));
    plat = createConnectivityPlatform(runtime, { clock, http, nems, driver });
  });
  afterAll(async () => {
    await driver.close();
  });

  it('installs the seven connector definitions and reports definition health', () => {
    expect(plat.connectors().definitions()).toEqual(
      expect.arrayContaining(['github', 'gmail', 'google-calendar', 'slack', 'jira', 'notion', 'postgresql']),
    );
    const health = plat.connectorHealth();
    expect(health.definitions.length).toBe(7);
    expect(health.definitions.every((d) => d.status === 'ok')).toBe(true);
  });

  it('drives the lifecycle installed → connected → healthy and gates permissions', () => {
    plat.connectors().install(acme, 'github', { permissions: ['github:read'] });
    expect(plat.connectors().state(acme, 'github')!.state).toBe('installed');
    plat.connectors().connect(acme, 'github');
    expect(plat.connectors().state(acme, 'github')!.state).toBe('connected');
    plat.lifecycle().markHealthy(acme, 'github');
    expect(plat.connectors().health(acme).find((h) => h.connectorId === 'github')!.healthy).toBe(true);
    expect(plat.connectors().can(acme, 'github', 'github:read')).toBe(true);
    expect(plat.connectors().can(acme, 'github', 'github:admin')).toBe(false);
  });

  it('rejects illegal transitions and reflects credential expiry in health/diagnostics', () => {
    plat.connectors().install(acme, 'slack');
    expect(() => plat.lifecycle().markHealthy(acme, 'slack')).toThrow(/illegal lifecycle transition/);
    plat.connectors().connect(acme, 'slack', { expiresAt: clock.now() + 1000 });
    clock.advance(2000); // credential now expired
    expect(plat.connectors().health(acme).find((h) => h.connectorId === 'slack')!.healthy).toBe(false);
    const diag = plat.connectors().diagnostics(acme, 'slack');
    expect(diag.checks.find((c) => c.name === 'not-expired')!.ok).toBe(false);
  });

  it('isolates tenants — connection state is per-tenant', () => {
    plat.connectors().install(globex, 'github');
    expect(plat.connectors().state(globex, 'github')!.state).toBe('installed');
    expect(plat.connectors().state(acme, 'github')!.state).not.toBe('installed'); // acme's is healthy
    expect(plat.connectors().list(globex).map((c) => c.connectorId)).toEqual(['github']);
  });

  it('runs a governed sync — audited on the one chain and published on the one bus', async () => {
    plat.sync().register('github', async () => ({ synced: 5, conflicts: 1 }));
    const auditBefore = runtime.audit().list().length;
    const syncEventsBefore = plat.governance().count('connectivity.sync');
    plat.sync().enqueue(acme, 'github', 'full');
    const outcomes = await plat.sync().drain();
    const gh = outcomes.find((o) => o.connectorId === 'github')!;
    expect(gh.ok).toBe(true);
    expect(gh.synced).toBe(5);
    expect(gh.correlationId).toBeTruthy();
    expect(gh.replayId).toBeTruthy();
    expect(runtime.audit().list().length).toBeGreaterThan(auditBefore);
    expect(runtime.audit().verify().valid).toBe(true);
    expect(plat.governance().count('connectivity.sync')).toBeGreaterThan(syncEventsBefore);
  });

  it('retries a transient failure, then succeeds', async () => {
    let n = 0;
    plat.sync().register('notion', async () => {
      n += 1;
      if (n < 2) throw new Error('transient');
      return { synced: 1, conflicts: 0 };
    });
    plat.connectors().install(acme, 'notion');
    plat.connectors().connect(acme, 'notion');
    plat.sync().enqueue(acme, 'notion', 'incremental');
    const out = await plat.sync().drain();
    expect(out.some((o) => o.connectorId === 'notion' && o.ok)).toBe(true);
    expect(n).toBe(2);
  });

  it('dead-letters a persistently failing sync and supports replay (Retry/DLQ Test)', async () => {
    let attempts = 0;
    plat.sync().register('jira', async () => {
      attempts += 1;
      throw new Error('boom');
    });
    plat.connectors().install(acme, 'jira');
    plat.connectors().connect(acme, 'jira');
    plat.sync().enqueue(acme, 'jira', 'manual');
    await plat.sync().drain();
    expect(attempts).toBe(3); // maxAttempts
    const dead = plat.sync().deadLetters().find((d) => d.job.connectorId === 'jira');
    expect(dead).toBeTruthy();
    expect(plat.connectors().state(acme, 'jira')!.state).toBe('error');
    const replayed = plat.sync().replay(dead!.job.id);
    expect(replayed).toBeTruthy();
    expect(plat.sync().queueDepth()).toBeGreaterThan(0);
  });

  it('unifies enterprise search across a live internal-NEMS source and a connector source', async () => {
    plat.search().register(
      functionSearchSource('github', async (_tenant, query) => (query.toLowerCase().includes('road') ? [{ source: 'github', type: 'repo', id: 'r1', title: 'roadmap-repo' }] : [])),
    );
    // internal NEMS (real DB) finds the seeded user
    const res = await plat.search().search(acme, 'Ada');
    expect(res.hits.some((h) => h.source === 'nems')).toBe(true);
    expect(res.bySource.nems).toBeGreaterThan(0);
    // connector source contributes to the merged result
    const res2 = await plat.search().search(acme, 'roadmap');
    expect(res2.hits.some((h) => h.source === 'github')).toBe(true);
    // tenant isolation — Globex does not see Acme's user
    const res3 = await plat.search().search(globex, 'Ada');
    expect(res3.hits.some((h) => h.source === 'nems')).toBe(false);
  });

  it('surfaces a connector dashboard from live lifecycle + sync state', () => {
    const ov = plat.dashboard().overview(acme);
    expect(ov.totals.connectors).toBeGreaterThan(0);
    expect(ov.connectors.find((c) => c.connectorId === 'github')!.syncs).toBeGreaterThan(0);
    expect(ov.totals.failures).toBeGreaterThan(0); // jira's failed attempts recorded above
    expect(ov.totals.retryQueue).toBeGreaterThan(0); // the replayed jira job is queued
  });

  it('keeps the anti-fabrication readiness honest', () => {
    const r = plat.readiness();
    expect(r.total).toBe(7);
    expect(r.liveVerified).toBe(1); // only postgresql
    expect(r.liveInfraPending).toBe(6);
  });
});
