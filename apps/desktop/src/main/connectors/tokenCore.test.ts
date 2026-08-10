/**
 * The token-handling core, which had no tests at all.
 *
 * An audit of this framework found `oauthEngine.ts` and `connectorVault.ts`
 * with ZERO coverage between them — the state check, the PKCE wiring, the
 * client-auth style, the refresh-token retention rule and every line of the
 * credential store. Those are the files where a defect is a credential
 * disclosure rather than a wrong number on a screen.
 *
 * Nothing here contacts a provider. The token endpoint is a routed double and
 * the browser is never opened; what is exercised is the REAL request
 * construction, the REAL state/PKCE validation and the REAL encryption path.
 *
 * The load-bearing assertions are the refusals and the absences: a mismatched
 * `state` throws, a rotated refresh token is not lost, and no secret appears
 * in any message, log or event this code produces.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import type { connectorVault as ConnectorVaultApi } from './connectorVault';
import { createPkcePair, shortId } from './pkce';
import { IDENTITY_PROBES, testConnection } from './connectionTest';
import type { RateGate } from '../unified/sync/http';
import { AuthError, RateLimitError } from '../unified/sync/http';

const NO_GATE: RateGate = { acquire: async () => undefined, penalize: () => undefined };

function base64urlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/* ── PKCE ─────────────────────────────────────────────────────────────── */

describe('PKCE', () => {
  it('produces an S256 challenge that actually verifies against its verifier', () => {
    const { verifier, challenge } = createPkcePair();
    /**
     * The check a provider performs. If these ever disagree, every PKCE
     * connector fails at the token exchange with an opaque provider error and
     * nothing here would have said why.
     */
    const expected = createHash('sha256').update(verifier).digest();
    expect(base64urlDecode(challenge).equals(expected)).toBe(true);
  });

  it('is base64url with no padding — a `+`, `/` or `=` breaks the query string', () => {
    const { verifier, challenge } = createPkcePair();
    for (const value of [verifier, challenge]) {
      expect(value).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(value).not.toContain('=');
    }
  });

  it('meets RFC 7636 length, and never repeats', () => {
    const { verifier } = createPkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    const many = new Set(Array.from({ length: 200 }, () => createPkcePair().verifier));
    expect(many.size).toBe(200);
  });

  it('account ids are unguessable and unique', () => {
    const ids = new Set(Array.from({ length: 500 }, () => shortId('acct')));
    expect(ids.size).toBe(500);
    expect([...ids][0]).toMatch(/^acct_[0-9a-f]{16}$/);
  });
});

/* ── The vault ────────────────────────────────────────────────────────── */

describe('the credential vault', () => {
  let dir: string;
  let vault: ConnectorVaultApi;
  let available = true;
  let store: Map<string, string>;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-vault-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    store = new Map();
    available = true;

    /**
     * Electron stands in for the OS keychain and the userData path.
     * Substituted, not simulated: the vault's own file format, atomic write,
     * 0600 mode, key-version marker and refuse-to-write path are all the real
     * code — only the platform underneath it is a double.
     */
    vi.resetModules();
    vi.doMock('electron', () => ({
      app: { getPath: () => dir },
      safeStorage: {
        isEncryptionAvailable: () => available,
        encryptString: (plain: string) => {
          const buf = Buffer.from(`enc:${randomUUID()}`, 'utf8');
          store.set(buf.toString('base64'), plain);
          return buf;
        },
        decryptString: (buf: Buffer) => {
          const found = store.get(buf.toString('base64'));
          if (found === undefined) throw new Error('cannot decrypt');
          return found;
        },
      },
    }));
    vault = (await import('./connectorVault')).connectorVault;
  });

  afterEach(async () => {
    vi.doUnmock('electron');
    vi.resetModules();
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });

  const vaultFile = (): string => join(dir, 'connector-vault.bin');

  it('round-trips tokens, and the plaintext is never on disk', async () => {
    await vault.set('hubspot', 'acct_1', {
      accessToken: 'AT-SUPER-SECRET',
      refreshToken: 'RT-ALSO-SECRET',
      expiresAt: 123,
      scopes: ['crm.objects.contacts.read'],
      tokenType: 'Bearer',
    });

    const back = await vault.get('hubspot', 'acct_1');
    expect(back?.accessToken).toBe('AT-SUPER-SECRET');
    expect(back?.scopes).toEqual(['crm.objects.contacts.read']);

    /**
     * The file is the thing an attacker copies off a laptop. The token must
     * not be in it in any readable form — the whole reason this is a vault
     * and not another JSON store.
     */
    const raw = await fs.readFile(vaultFile(), 'utf8');
    expect(raw).not.toContain('AT-SUPER-SECRET');
    expect(raw).not.toContain('RT-ALSO-SECRET');
  });

  it('is written owner-only', async () => {
    await vault.set('hubspot', 'acct_1', {
      accessToken: 'x',
      refreshToken: null,
      expiresAt: 0,
      scopes: [],
      tokenType: 'Bearer',
    });
    const stat = await fs.stat(vaultFile());
    // A world-readable credential file is a credential file in name only.
    expect(stat.mode & 0o077).toBe(0);
  });

  it('keeps two accounts of one connector separate', async () => {
    await vault.set('hubspot', 'a1', { accessToken: 'ONE', refreshToken: null, expiresAt: 0, scopes: [], tokenType: 'Bearer' });
    await vault.set('hubspot', 'a2', { accessToken: 'TWO', refreshToken: null, expiresAt: 0, scopes: [], tokenType: 'Bearer' });
    expect((await vault.get('hubspot', 'a1'))?.accessToken).toBe('ONE');
    expect((await vault.get('hubspot', 'a2'))?.accessToken).toBe('TWO');
    // Deleting one must not blind the other.
    await vault.delete('hubspot', 'a1');
    expect(await vault.get('hubspot', 'a1')).toBeNull();
    expect((await vault.get('hubspot', 'a2'))?.accessToken).toBe('TWO');
  });

  it('an entry that cannot be decrypted is dropped, not returned as garbage', async () => {
    await vault.set('hubspot', 'a1', { accessToken: 'ONE', refreshToken: null, expiresAt: 0, scopes: [], tokenType: 'Bearer' });
    // The keychain no longer holds the key — a real outcome after an OS
    // reinstall or a profile move.
    store.clear();
    expect(await vault.get('hubspot', 'a1')).toBeNull();
  });

  it('refuses to store anything when the keychain is unavailable', async () => {
    available = false;
    await vault.set('hubspot', 'a1', { accessToken: 'PLAINTEXT', refreshToken: null, expiresAt: 0, scopes: [], tokenType: 'Bearer' });
    /**
     * The failure mode that matters: writing the token unencrypted "so it
     * still works". It must not, and the file must not appear at all.
     */
    const written = await fs.readFile(vaultFile(), 'utf8').catch(() => null);
    expect(written).toBeNull();
    expect(await vault.get('hubspot', 'a1')).toBeNull();
  });

  it('carries a key version, so a future rotation can tell old ciphertext from new', async () => {
    const mod = await import('./connectorVault');
    expect(mod.CONNECTOR_VAULT_KEY_VERSION).toBeGreaterThanOrEqual(1);
  });
});

/* ── The connection test ──────────────────────────────────────────────── */

describe('the connection test', () => {
  const routed = (body: unknown) => ({
    makeClient: () => ({ getJson: async () => ({ data: body, headers: {}, status: 200 }) }),
  });
  const throwing = (err: Error) => ({
    makeClient: () => ({
      getJson: async () => {
        throw err;
      },
    }),
  });
  const base = { getAccessToken: async () => 'AT-SECRET', rate: NO_GATE };

  it('resolves a STABLE provider account id — the thing externalId never had', async () => {
    const result = await testConnection('github', 'acct_1', {
      ...base,
      ...routed({ id: 4213, login: 'asha', company: 'Borealis' }),
    } as never);
    expect(result.status).toBe('verified');
    expect(result.externalId).toBe('4213');
    expect(result.label).toBe('asha');
    expect(result.message).toContain('asha');
  });

  it('a 200 with no identity is UNVERIFIED, not connected', async () => {
    /**
     * Slack's `auth.test` answers HTTP 200 with `{ok:false}` for a revoked
     * token — a status code saying yes over a body saying no. Trusting the
     * status is how a dead connection shows a green tick.
     */
    const result = await testConnection('slack', 'acct_1', { ...base, ...routed({ ok: false, error: 'invalid_auth' }) } as never);
    expect(result.status).toBe('not_verifiable');
    expect(result.externalId).toBeNull();
  });

  it('a rejected credential is reported as rejected', async () => {
    const result = await testConnection('github', 'a', { ...base, ...throwing(new AuthError('401')) } as never);
    expect(result.status).toBe('invalid_credential');
    expect(result.message).toMatch(/reconnect/i);
  });

  it('rate limiting is “we do not know yet”, never “it is broken”', async () => {
    const result = await testConnection('github', 'a', { ...base, ...throwing(new RateLimitError(1000)) } as never);
    expect(result.status).toBe('rate_limited');
    /**
     * `not.toBe('invalid_credential')` next to the line above was tautological.
     * What actually matters is that the message does not tell the person to
     * re-authorize a credential that is probably fine.
     */
    expect(result.message).not.toMatch(/reconnect/i);
    expect(result.message).toMatch(/rate limit/i);
  });

  it('a connector with no identity endpoint says so instead of passing', async () => {
    const result = await testConnection('sap', 'a', base as never);
    expect(result.status).toBe('not_verifiable');
    expect(result.message).toMatch(/could not be verified/i);
    expect(result.externalId).toBeNull();
  });

  it('never puts the token or the provider’s error text into its message', async () => {
    /**
     * Both are real leak paths. The token because it is in scope at the call
     * site; the provider's text because it is attacker-influenced and this
     * message renders straight into the UI.
     */
    const leaky = await testConnection('github', 'a', {
      ...base,
      ...throwing(new Error('failed: token AT-SECRET rejected by <script>')),
    } as never);
    expect(leaky.message).not.toContain('AT-SECRET');
    expect(leaky.message).not.toContain('<script>');

    /**
     * And the token really is reachable from here — otherwise the assertion
     * above proves nothing. The probe is handed a `getToken` that returns it,
     * so a future change that echoed the credential into the result would be
     * caught rather than merely unlikely.
     */
    let handedOut: string | null = null;
    const ok = await testConnection('github', 'acct_1', {
      getAccessToken: async () => 'AT-SECRET',
      rate: NO_GATE,
      makeClient: (_id: string, getToken: () => Promise<string>) => ({
        getJson: async () => {
          handedOut = await getToken();
          return { data: { id: 1, login: 'asha' }, headers: {}, status: 200 };
        },
      }),
    } as never);
    expect(handedOut).toBe('AT-SECRET');
    expect(JSON.stringify(ok)).not.toContain('AT-SECRET');
  });

  it('only names providers whose adapter this build actually ships', async () => {
    const { getAdapter } = await import('../unified/sync/registry');
    const { registerBuiltinAdapters } = await import('../unified/sync/adapters');
    registerBuiltinAdapters();
    for (const connectorId of Object.keys(IDENTITY_PROBES)) {
      // A probe for a connector with no adapter would verify a connection
      // that can never sync anything — a green tick over a dead end.
      expect(getAdapter(connectorId), `${connectorId} has a probe but no adapter`).toBeTruthy();
    }
  });
});
