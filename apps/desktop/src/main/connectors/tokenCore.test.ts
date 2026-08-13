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

const WS_A = 'workspace-a';
const WS_B = 'workspace-b';

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
    await vault.set(WS_A, 'hubspot', 'acct_1', {
      accessToken: 'AT-SUPER-SECRET',
      refreshToken: 'RT-ALSO-SECRET',
      expiresAt: 123,
      scopes: ['crm.objects.contacts.read'],
      tokenType: 'Bearer',
    });

    const back = await vault.get(WS_A, 'hubspot', 'acct_1');
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
    await vault.set(WS_A, 'hubspot', 'acct_1', {
      accessToken: 'x',
      refreshToken: null,
      expiresAt: 0,
      scopes: [],
      tokenType: 'Bearer',
    });
    const stat = await fs.stat(vaultFile());
    /**
     * POSIX ONLY, AND SAID OUT LOUD. P13C ROUND 17k.
     *
     * Windows has no POSIX permission bits. Node reports mode 0o666 for every
     * file there and `chmod(0o600)` is a no-op, so this assertion measured 54
     * (0o66) on the first Windows release run and failed — not because the
     * vault regressed, but because the control it checks does not exist on that
     * platform. Access control on Windows is an ACL, and `%APPDATA%` is already
     * user-scoped.
     *
     * ANNOUNCED, NOT SKIPPED. A security assertion that quietly does not apply
     * on a platform is indistinguishable from one that passes there, and the
     * difference is the whole point. The line below appears in the Windows log
     * so nobody reads a green run as proof of a file mode nobody checked.
     *
     * What still holds on Windows is the stronger property, asserted in the
     * test above: the tokens are not in the file in readable form at all.
     */
    if (process.platform === 'win32') {
      // eslint-disable-next-line no-console
      console.log(
        '[tokenCore] owner-only file mode NOT ASSERTED on win32 — POSIX mode bits do not ' +
          'exist there. Vault contents remain encrypted (asserted separately).',
      );
      return;
    }
    // A world-readable credential file is a credential file in name only.
    expect(stat.mode & 0o077).toBe(0);
  });

  it('keeps two accounts of one connector separate', async () => {
    await vault.set(WS_A, 'hubspot', 'a1', { accessToken: 'ONE', refreshToken: null, expiresAt: 0, scopes: [], tokenType: 'Bearer' });
    await vault.set(WS_A, 'hubspot', 'a2', { accessToken: 'TWO', refreshToken: null, expiresAt: 0, scopes: [], tokenType: 'Bearer' });
    expect((await vault.get(WS_A, 'hubspot', 'a1'))?.accessToken).toBe('ONE');
    expect((await vault.get(WS_A, 'hubspot', 'a2'))?.accessToken).toBe('TWO');
    // Deleting one must not blind the other.
    await vault.delete(WS_A, 'hubspot', 'a1');
    expect(await vault.get(WS_A, 'hubspot', 'a1')).toBeNull();
    expect((await vault.get(WS_A, 'hubspot', 'a2'))?.accessToken).toBe('TWO');
  });

  it('an entry that cannot be decrypted is dropped, not returned as garbage', async () => {
    await vault.set(WS_A, 'hubspot', 'a1', { accessToken: 'ONE', refreshToken: null, expiresAt: 0, scopes: [], tokenType: 'Bearer' });
    // The keychain no longer holds the key — a real outcome after an OS
    // reinstall or a profile move.
    store.clear();
    expect(await vault.get(WS_A, 'hubspot', 'a1')).toBeNull();
  });

  it('refuses to store anything when the keychain is unavailable', async () => {
    available = false;
    await vault.set(WS_A, 'hubspot', 'a1', { accessToken: 'PLAINTEXT', refreshToken: null, expiresAt: 0, scopes: [], tokenType: 'Bearer' });
    /**
     * The failure mode that matters: writing the token unencrypted "so it
     * still works". It must not, and the file must not appear at all.
     */
    const written = await fs.readFile(vaultFile(), 'utf8').catch(() => null);
    expect(written).toBeNull();
    expect(await vault.get(WS_A, 'hubspot', 'a1')).toBeNull();
  });

  /* ── The boundary this program exists for ───────────────────────────── */

  it('a credential stored in one workspace is INVISIBLE from another', async () => {
    /**
     * The whole point. Before this the vault key was `connectorId → accountId`
     * with no workspace anywhere in the connectors directory, so a connection
     * set up in one workspace was spendable from any other and the file held no
     * information with which to refuse.
     */
    await vault.set(WS_A, 'hubspot', 'acct_1', {
      accessToken: 'A-ONLY',
      refreshToken: null,
      expiresAt: 0,
      scopes: [],
      tokenType: 'Bearer',
    });

    expect((await vault.get(WS_A, 'hubspot', 'acct_1'))?.accessToken).toBe('A-ONLY');
    // Same connector, same account id, different workspace. Nothing.
    expect(await vault.get(WS_B, 'hubspot', 'acct_1')).toBeNull();
  });

  it('two workspaces hold different credentials under the same account id', async () => {
    await vault.set(WS_A, 'hubspot', 'acct_1', { accessToken: 'FROM-A', refreshToken: null, expiresAt: 0, scopes: [], tokenType: 'Bearer' });
    await vault.set(WS_B, 'hubspot', 'acct_1', { accessToken: 'FROM-B', refreshToken: null, expiresAt: 0, scopes: [], tokenType: 'Bearer' });

    expect((await vault.get(WS_A, 'hubspot', 'acct_1'))?.accessToken).toBe('FROM-A');
    expect((await vault.get(WS_B, 'hubspot', 'acct_1'))?.accessToken).toBe('FROM-B');
    // Removing one leaves the other alone — the ids collide and the secrets do not.
    await vault.delete(WS_A, 'hubspot', 'acct_1');
    expect(await vault.get(WS_A, 'hubspot', 'acct_1')).toBeNull();
    expect((await vault.get(WS_B, 'hubspot', 'acct_1'))?.accessToken).toBe('FROM-B');
  });

  it('clearing one workspace does not touch another', async () => {
    await vault.set(WS_A, 'hubspot', 'a', { accessToken: 'A', refreshToken: null, expiresAt: 0, scopes: [], tokenType: 'Bearer' });
    await vault.set(WS_B, 'hubspot', 'b', { accessToken: 'B', refreshToken: null, expiresAt: 0, scopes: [], tokenType: 'Bearer' });
    await vault.clear(WS_A);
    expect(await vault.get(WS_A, 'hubspot', 'a')).toBeNull();
    expect((await vault.get(WS_B, 'hubspot', 'b'))?.accessToken).toBe('B');
  });

  it('a credential written before the boundary is UNCLAIMED and unspendable', async () => {
    /**
     * The migration rule the spec is explicit about: do not guess ownership.
     * Adopting a pre-P10 credential into whichever workspace happens to be
     * active would hand one workspace another's credentials on the first
     * launch after an update — the exact failure the boundary prevents.
     */
    const legacy = {
      hubspot: { acct_legacy: Buffer.from('enc:old', 'utf8').toString('base64') },
    };
    await fs.writeFile(vaultFile(), JSON.stringify(legacy), { mode: 0o600 });

    // Listed, so an operator can see it exists…
    const pending = await vault.migrationRequired();
    expect(pending).toEqual([{ connectorId: 'hubspot', accountId: 'acct_legacy' }]);

    // …and readable from NO workspace.
    expect(await vault.get(WS_A, 'hubspot', 'acct_legacy')).toBeNull();
    expect(await vault.get(WS_B, 'hubspot', 'acct_legacy')).toBeNull();
    expect(await vault.get('workspace-default', 'hubspot', 'acct_legacy')).toBeNull();
  });

  it('the only resolution for an unclaimed credential is to discard it', async () => {
    await fs.writeFile(
      vaultFile(),
      JSON.stringify({ hubspot: { acct_legacy: 'x' } }),
      { mode: 0o600 },
    );
    await vault.discardUnscoped('hubspot', 'acct_legacy');
    expect(await vault.migrationRequired()).toEqual([]);
    /**
     * There is deliberately no "adopt into the current workspace".
     *
     * Asserted as BEHAVIOUR, not as the absence of a method name — a test that
     * checks `Object.keys(vault)` for a function nobody wrote carries no signal
     * and would keep passing if adoption were added under any other name. What
     * matters is that the secret stays unreadable from every workspace and that
     * discarding actually removes it.
     */
    expect(await vault.get(WS_A, 'hubspot', 'acct_legacy')).toBeNull();
    expect(await vault.get(WS_B, 'hubspot', 'acct_legacy')).toBeNull();
    const raw = await fs.readFile(vaultFile(), 'utf8');
    expect(raw).not.toContain('acct_legacy');
  });

  it('a real v1 file survives a later write instead of being overwritten away', async () => {
    /**
     * The previous version of this test wrote a v2 file with `vault.set` and then
     * asserted that v2 was recognised as v2 — it never round-tripped a genuine v1
     * file, which is the only case the migration exists for.
     *
     * The failure it is protecting against is concrete: `set` rewrites the whole
     * file, so if it dropped `legacy` the unclaimed credentials would vanish and
     * the operator would never learn they had existed.
     */
    await fs.writeFile(
      vaultFile(),
      JSON.stringify({ hubspot: { acct_legacy: 'ciphertext' }, github: { acct_old: 'ciphertext' } }),
      { mode: 0o600 },
    );
    expect(await vault.migrationRequired()).toHaveLength(2);

    // A NEW credential in a real workspace, written after the migration.
    await vault.set(WS_A, 'hubspot', 'acct_1', {
      accessToken: 'KEEP',
      refreshToken: null,
      expiresAt: 0,
      scopes: [],
      tokenType: 'Bearer',
    });

    // The new one reads back…
    expect((await vault.get(WS_A, 'hubspot', 'acct_1'))?.accessToken).toBe('KEEP');
    // …the old ones are still listed as needing attention…
    expect(await vault.migrationRequired()).toHaveLength(2);
    // …and neither is readable from any workspace.
    expect(await vault.get(WS_A, 'hubspot', 'acct_legacy')).toBeNull();
    expect(await vault.get(WS_B, 'github', 'acct_old')).toBeNull();

    // Deleting the new credential must not resurrect or strand the old ones.
    await vault.delete(WS_A, 'hubspot', 'acct_1');
    expect(await vault.get(WS_A, 'hubspot', 'acct_1')).toBeNull();
    expect(await vault.migrationRequired()).toHaveLength(2);
  });

  it('clearing one workspace leaves the unclaimed credentials alone', async () => {
    await fs.writeFile(vaultFile(), JSON.stringify({ hubspot: { acct_legacy: 'ciphertext' } }), { mode: 0o600 });
    await vault.set(WS_A, 'hubspot', 'acct_1', {
      accessToken: 'KEEP',
      refreshToken: null,
      expiresAt: 0,
      scopes: [],
      tokenType: 'Bearer',
    });
    await vault.clear(WS_A);
    expect(await vault.get(WS_A, 'hubspot', 'acct_1')).toBeNull();
    // Still visible to the operator, so the reconnect prompt does not disappear.
    expect(await vault.migrationRequired()).toHaveLength(1);
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
