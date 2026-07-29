import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ManualClock } from '@neuropause/cloud-core';
import { InMemorySecretVault } from './vault';
import { AuthFramework } from './auth';
import { defineConnector } from './sdk';

describe('SecretVault', () => {
  it('stores refs, reveals values, lists metadata only, rotates + revokes', async () => {
    const audit: string[] = [];
    const vault = new InMemorySecretVault(new ManualClock(1000), (e) => audit.push(e.action));
    const ref = await vault.put('github', 'token', 'ghp_secret');
    expect(ref).toEqual({ scope: 'github', key: 'token' });
    expect(await vault.reveal(ref)).toBe('ghp_secret');

    const list = vault.list('github');
    expect(list[0]).toMatchObject({ scope: 'github', key: 'token', version: 1, revoked: false });
    expect(JSON.stringify(list)).not.toContain('ghp_secret'); // metadata only

    const meta = await vault.rotate('github', 'token', 'ghp_new');
    expect(meta.version).toBe(2);
    expect(await vault.reveal(ref)).toBe('ghp_new');

    await vault.revoke('github', 'token');
    expect(await vault.reveal(ref)).toBeUndefined();
    expect(vault.has('github', 'token')).toBe(false);
    expect(audit).toEqual(['put', 'reveal', 'rotate', 'reveal', 'revoke']);
  });
  it('refuses an empty secret', async () => {
    const vault = new InMemorySecretVault(new ManualClock(0));
    await expect(vault.put('s', 'k', '')).rejects.toThrow(/empty/);
  });
});

describe('AuthFramework', () => {
  function setup() {
    const clock = new ManualClock(0);
    const vault = new InMemorySecretVault(clock);
    return { clock, vault, auth: new AuthFramework(vault, clock) };
  }
  it('resolves bearer / api_key / basic headers from the vault', async () => {
    const { vault, auth } = setup();
    const tokenRef = await vault.put('gh', 'token', 't0k');
    expect((await auth.resolve({ type: 'bearer', secretRefs: { token: tokenRef } })).header).toEqual({
      name: 'Authorization',
      value: 'Bearer t0k',
    });
    expect((await auth.resolve({ type: 'api_key', secretRefs: { token: tokenRef } })).header).toEqual({
      name: 'X-API-Key',
      value: 't0k',
    });
    const u = await vault.put('x', 'username', 'user');
    const p = await vault.put('x', 'password', 'pass');
    const basic = await auth.resolve({ type: 'basic', secretRefs: { username: u, password: p } });
    expect(basic.header?.value).toBe('Basic ' + Buffer.from('user:pass').toString('base64'));
    expect((await auth.resolve({ type: 'none' })).header).toBeUndefined();
  });
  it('validates required secret refs per type', async () => {
    const { auth } = setup();
    expect(auth.validate({ type: 'bearer' }).ok).toBe(false);
    expect(auth.validate({ type: 'basic', secretRefs: { username: { scope: 'x', key: 'u' } } }).missing).toEqual(['password']);
    expect(auth.validate({ type: 'none' }).ok).toBe(true);
  });
  it('detects when a token needs refresh', () => {
    const { auth } = setup();
    expect(auth.needsRefresh({ accessToken: 'a', expiresAt: -1 })).toBe(true);
    expect(auth.needsRefresh({ accessToken: 'a', expiresAt: 1000 })).toBe(false);
  });
});

describe('Connector SDK', () => {
  it('defineConnector validates and returns the definition', () => {
    const c = defineConnector({
      id: 'demo',
      name: 'Demo',
      version: '1.0.0',
      category: 'test',
      auth: { type: 'api_key' },
      capabilities: ['read'],
      permissions: ['demo:read'],
      actions: [{ name: 'ping', permissions: [], schema: z.object({}), execute: async () => ({ pong: true }) }],
    });
    expect(c.id).toBe('demo');
    expect(() => defineConnector({ ...c, actions: [c.actions[0], c.actions[0]] })).toThrow(/duplicate action/);
    expect(() => defineConnector({ ...c, version: '' })).toThrow(/version/);
  });
});
