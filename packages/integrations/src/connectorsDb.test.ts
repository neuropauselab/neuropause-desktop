import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createPgliteDriver } from '@neuropause/persistence';
import { FakeHttpClient, type HttpResponse } from './http';
import { github, slack, drainCursor, parseLinkHeaderNext, readPath } from './connectors';
import { SqlConnector, objectUrl } from './db';

describe('SaaS connector adapters (ADAPTER VERIFIED)', () => {
  it('GitHub: builds the repos request, parses rows + Link-header pagination', () => {
    const req = github.listReposRequest('tok', { perPage: 50, page: 2 });
    expect(req.url).toBe('https://api.github.com/user/repos?per_page=50&page=2');
    expect(req.headers?.Authorization).toBe('Bearer tok');
    const res: HttpResponse = {
      status: 200,
      ok: true,
      headers: { link: '<https://api.github.com/user/repos?page=3>; rel="next"' },
      body: JSON.stringify([{ id: 1, name: 'repo', full_name: 'o/repo', private: false }]),
    };
    const page = github.parseRepos(res);
    expect(page.items[0]).toEqual({ id: 1, name: 'repo', fullName: 'o/repo', private: false });
    expect(page.nextUrl).toBe('https://api.github.com/user/repos?page=3');
    expect(parseLinkHeaderNext(undefined)).toBeUndefined();
  });

  it('Slack: cursor pagination drains fully via drainCursor', async () => {
    let call = 0;
    const http = new FakeHttpClient(() => {
      call += 1;
      return {
        status: 200,
        ok: true,
        headers: {},
        body: JSON.stringify(
          call === 1
            ? { ok: true, channels: [{ id: 'C1', name: 'general' }], response_metadata: { next_cursor: 'cur2' } }
            : { ok: true, channels: [{ id: 'C2', name: 'random' }], response_metadata: { next_cursor: '' } },
        ),
      };
    });
    const all = await drainCursor(http, (cursor) => slack.listChannelsRequest('tok', cursor ? { cursor } : {}), slack.parseChannels);
    expect(all.map((c) => c.id)).toEqual(['C1', 'C2']);
    expect(call).toBe(2);
    expect(readPath({ a: { b: 'x' } }, 'a.b')).toBe('x');
  });

  it('Slack: surfaces an API error', () => {
    const res: HttpResponse = { status: 200, ok: true, headers: {}, body: JSON.stringify({ ok: false, error: 'invalid_auth' }) };
    expect(() => slack.parseChannels(res)).toThrow(/invalid_auth/);
  });

  it('builds object-storage URLs per provider', () => {
    expect(objectUrl({ kind: 's3', bucket: 'b', region: 'eu-west-1', credentialKey: 'k' }, 'f.txt')).toBe('https://b.s3.eu-west-1.amazonaws.com/f.txt');
    expect(objectUrl({ kind: 'gcs', bucket: 'b', credentialKey: 'k' }, 'f.txt')).toBe('https://storage.googleapis.com/b/f.txt');
  });
});

describe('PostgreSQL connector — real query (VERIFIED)', () => {
  let db: Awaited<ReturnType<typeof createPgliteDriver>>;
  beforeAll(async () => {
    db = await createPgliteDriver();
  });
  afterAll(async () => {
    await db.close();
  });

  it('executes a real query and pings via the persistence SqlDriver', async () => {
    const conn = new SqlConnector(db);
    await db.exec('CREATE TABLE widgets (id int, name text)');
    await db.query('INSERT INTO widgets (id, name) VALUES ($1,$2)', [1, 'gizmo']);
    const rows = await conn.query<{ name: string }>('SELECT name FROM widgets WHERE id = $1', [1]);
    expect(rows[0]?.name).toBe('gizmo');
    expect(await conn.ping()).toBe(true);
    expect(conn.dialect()).toBe('postgres');
  });
});
