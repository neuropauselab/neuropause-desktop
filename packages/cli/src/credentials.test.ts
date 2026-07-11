import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createFileCredentialStore, decodeTokenClaims, describeCredentials, maskSecret, type StoredCredentials } from './credentials';

function jwt(payload: unknown): string {
  const enc = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(payload)}.signature`;
}

describe('decodeTokenClaims', () => {
  it('decodes a JWT payload for display', () => {
    const token = jwt({ sub: 'dev_1', org: 'org_1', scopes: ['records:read'], exp: 2000000000 });
    expect(decodeTokenClaims(token)).toMatchObject({ sub: 'dev_1', org: 'org_1', scopes: ['records:read'] });
  });
  it('returns null for a non-JWT', () => {
    expect(decodeTokenClaims('npk_live_abc')).toBeNull();
    expect(decodeTokenClaims('a.b')).toBeNull();
  });
});

describe('maskSecret', () => {
  it('masks short and long secrets', () => {
    expect(maskSecret('short')).toBe('****');
    expect(maskSecret('npk_live_abcdef')).toBe('npk_…cdef');
  });
});

describe('describeCredentials', () => {
  it('never leaks the raw secret, and expands access-token claims', () => {
    const token = jwt({ sub: 'dev_9', org: 'org_9', scopes: ['graph:read'], exp: 1000 });
    const d = describeCredentials({ kind: 'access_token', token, savedAt: 'now' }, 2000 * 1000);
    expect(d.token).toBe(maskSecret(token));
    expect(d).toMatchObject({ developerId: 'dev_9', tenant: 'org_9', scopes: ['graph:read'], expired: true });
  });
  it('summarizes an api-key credential without claims', () => {
    const d = describeCredentials({ kind: 'api_key', token: 'npk_live_secret_value', baseUrl: 'https://x', savedAt: 'now' }, 0);
    expect(d).toEqual({ kind: 'api_key', token: maskSecret('npk_live_secret_value'), baseUrl: 'https://x', savedAt: 'now' });
  });
});

describe('createFileCredentialStore', () => {
  const dirs: string[] = [];
  afterAll(async () => {
    await Promise.all(dirs.map((d) => fs.rm(d, { recursive: true, force: true })));
  });

  it('round-trips save/load and clears', async () => {
    const base = await fs.mkdtemp(join(tmpdir(), 'np-cli-'));
    dirs.push(base);
    const store = createFileCredentialStore(join(base, '.neuropause'));
    expect(await store.load()).toBeNull();

    const creds: StoredCredentials = { kind: 'api_key', token: 'npk_live_x', savedAt: '2026-01-01T00:00:00.000Z' };
    await store.save(creds);
    expect(await store.load()).toEqual(creds);

    expect(await store.clear()).toBe(true);
    expect(await store.clear()).toBe(false);
    expect(await store.load()).toBeNull();
  });
});
