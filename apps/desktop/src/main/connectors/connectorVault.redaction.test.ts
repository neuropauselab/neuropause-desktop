/**
 * NP-013 — the vault's decrypt/parse TRY SPLIT. The recon's one real MEDIUM:
 * `get()` had ONE try over safeStorage.decryptString AND JSON.parse of the
 * decrypted AccountTokens JSON — so a decrypt-succeeds/parse-fails state
 * (keychain rotation garbage) put a V8 SyntaxError whose message EMBEDS AN
 * EXCERPT OF THE DECRYPTED PLAINTEXT into console + app.log. The pin: drive
 * exactly that state through the real `get()` and prove no fragment of the
 * plaintext reaches any console argument — the parse failure is logged by
 * error NAME only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mockState = vi.hoisted(() => ({ userDataDir: '' }));
// decryptString "succeeds" and yields NON-JSON that looks like token material —
// the decrypt-garbage state the split exists for.
const GARBAGE_PLAINTEXT = 'xY{"accessToken":"eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9-GARBLED';
vi.mock('electron', () => ({
  app: {
    getPath: () => mockState.userDataDir,
    getAppPath: () => mockState.userDataDir,
    getVersion: () => '0.0.0-test',
    getName: () => 'neuropause-test',
    isPackaged: false,
    on: () => undefined,
    once: () => undefined,
    whenReady: () => Promise.resolve(),
  },
  ipcMain: { handle: () => undefined, on: () => undefined },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s, 'utf8'),
    decryptString: () => GARBAGE_PLAINTEXT,
  },
}));

describe('connectorVault.get — decrypt/parse split (NP-013)', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockState.userDataDir = mkdtempSync(join(tmpdir(), 'np013-vault-'));
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    errorSpy.mockRestore();
    rmSync(mockState.userDataDir, { recursive: true, force: true });
    vi.resetModules();
  });

  it('a decrypt-succeeds/parse-fails entry is dropped WITHOUT any plaintext fragment reaching the log', async () => {
    writeFileSync(
      join(mockState.userDataDir, 'connector-vault.bin'),
      JSON.stringify({
        schemaVersion: 2,
        workspaces: { ws_v: { slack: { acct_v: Buffer.from('anything').toString('base64') } } },
        legacy: {},
      }),
      { mode: 0o600 },
    );
    vi.resetModules();
    const { connectorVault } = await import('./connectorVault');

    const tokens = await connectorVault.get('ws_v', 'slack', 'acct_v');
    expect(tokens).toBeNull();

    // The failure WAS logged (the drop is not silent) …
    const parseCalls = errorSpy.mock.calls.filter((args) =>
      args.some((a) => typeof a === 'string' && a.includes('failed to parse')),
    );
    expect(parseCalls.length).toBe(1);
    // … but NO console argument carries any fragment of the decrypted plaintext.
    for (const args of errorSpy.mock.calls) {
      const flat = JSON.stringify(args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : a)));
      expect(flat).not.toContain('accessToken');
      expect(flat).not.toContain('eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9');
      expect(flat).not.toContain('GARBLED');
    }
  });
});
