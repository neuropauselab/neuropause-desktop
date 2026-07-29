import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { InMemorySecretVault } from '@neuropause/connectors';
import { createPgliteDriver, createPersistenceLayer, TableRepository, type PersistenceLayer } from '@neuropause/persistence';
import { SyncEngine, type SyncRecord, type SyncSource, type SourcePage } from './sync';
import { CredentialManager } from './vaultCredentials';
import { FakeHttpClient } from './http';
import { OAUTH_PROVIDERS } from './oauth';

function pagedSource(pages: Record<string, SourcePage<SyncRecord>>): SyncSource<SyncRecord> {
  return { pull: async (cursor) => pages[cursor ?? '__start__'] ?? { items: [], hasMore: false } };
}

describe('SyncEngine — incremental, checkpointed, resumable (real Postgres)', () => {
  let db: Awaited<ReturnType<typeof createPgliteDriver>>;
  let persistence: PersistenceLayer;
  const clock = new ManualClock(1000);
  let sink: TableRepository<SyncRecord>;
  let engine: SyncEngine;
  beforeAll(async () => {
    db = await createPgliteDriver();
    persistence = createPersistenceLayer({ driver: db, clock });
    await persistence.migrate();
    sink = new TableRepository<SyncRecord>(db, 'connectors', clock);
    engine = new SyncEngine(persistence, clock);
  });
  afterAll(async () => {
    await db.close();
  });

  it('syncs incrementally, persists a checkpoint, and resumes from it', async () => {
    const source = pagedSource({
      __start__: { items: [{ id: 'a', version: 1 }, { id: 'b', version: 1 }], nextCursor: 'c1', hasMore: true },
      c1: { items: [{ id: 'c', version: 1 }], hasMore: false },
    });
    const first = await engine.sync('t1', 'demo', source, sink, { maxPages: 1 });
    expect(first.synced).toBe(2);
    const cp = await engine.loadCheckpoint('t1', 'demo');
    expect(cp?.cursor).toBe('c1'); // checkpoint persisted to Postgres

    const second = await engine.sync('t1', 'demo', source, sink, {});
    expect(second.resumedFrom).toBe('c1');
    expect(second.synced).toBe(3); // resumed and finished
    expect(await sink.count('t1')).toBe(3);
  });

  it('detects a conflict when the incoming record is not newer', async () => {
    await sink.upsert('t2', { id: 'x', version: 5 });
    const source = pagedSource({ __start__: { items: [{ id: 'x', version: 3 }], hasMore: false } });
    const res = await engine.sync('t2', 'conflicts', source, sink, {});
    expect(res.conflicts).toBe(1); // v3 does not clobber v5
    expect((await sink.get('t2', 'x'))?.value.version).toBe(5);
  });

  it('recovers from an offline error without losing progress, then replays', async () => {
    const offline: SyncSource<SyncRecord> = { pull: async () => { throw new Error('ECONNREFUSED'); } };
    const res = await engine.sync('t3', 'flaky', offline, sink, {});
    expect(res.status).toBe('offline');
    expect((await engine.loadCheckpoint('t3', 'flaky'))?.status).toBe('offline');

    const working = pagedSource({ __start__: { items: [{ id: 'r1', version: 1 }], hasMore: false } });
    const replay = await engine.replay('t3', 'flaky', working, sink, {});
    expect(replay.status).toBe('idle');
    expect(replay.synced).toBe(1);
  });
});

describe('CredentialManager — Secret Vault, isolation, refresh', () => {
  it('stores/resolves/rotates/revokes and isolates tenants', async () => {
    const clock = new ManualClock(0);
    const cred = new CredentialManager(new InMemorySecretVault(clock), clock);
    await cred.store('tA', 'github', 'token', 'ghp_A');
    expect(await cred.resolve('tA', 'github', 'token')).toBe('ghp_A');
    // tenant isolation: tB cannot see tA's secret
    expect(await cred.resolve('tB', 'github', 'token')).toBeUndefined();
    await cred.rotate('tA', 'github', 'token', 'ghp_A2');
    expect(await cred.resolve('tA', 'github', 'token')).toBe('ghp_A2');
    await cred.revoke('tA', 'github', 'token');
    expect(await cred.resolve('tA', 'github', 'token')).toBeUndefined();
  });

  it('refreshes an OAuth token set through the refresh request', async () => {
    const clock = new ManualClock(0);
    const cred = new CredentialManager(new InMemorySecretVault(clock), clock);
    await cred.storeTokenSet('tA', 'salesforce', { accessToken: 'old', refreshToken: 'rt', expiresInSec: 100, tokenType: 'Bearer' });
    clock.advance(100_000); // past expiry
    expect(cred.needsRefresh('tA', 'salesforce')).toBe(true);
    const http = new FakeHttpClient(() => ({ status: 200, ok: true, headers: {}, body: JSON.stringify({ access_token: 'new', expires_in: 3600, token_type: 'Bearer' }) }));
    const tokens = await cred.refresh('tA', 'salesforce', http, OAUTH_PROVIDERS.salesforce!, { clientId: 'cid', clientSecret: 'sec' });
    expect(tokens.accessToken).toBe('new');
    expect(tokens.refreshToken).toBe('rt'); // preserved when the provider doesn't re-issue
    expect(await cred.resolve('tA', 'salesforce', 'access_token')).toBe('new');
  });
});
