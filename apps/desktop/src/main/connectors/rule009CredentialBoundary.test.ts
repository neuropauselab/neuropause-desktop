/**
 * NP-013 — RULE-009 ADVERSARIAL PIN (ARCHITECTURE-SPEC §53): "credential
 * material cannot appear in connector metadata" — proven at the REAL
 * persistence path, not on the pure function alone. The attack is the one the
 * recon named: `label`, `error`, and `grantedScopes` are PROVIDER-CONTROLLED
 * strings (OAuth workspace/team name, error_description, raw scope string); a
 * hostile provider shapes them like tokens; the store must persist the
 * account WITHOUT the credential bytes ever reaching `connectors.json`.
 *
 * Harness pattern from round10RetentionBatch1: electron mocked to a per-test
 * temp dir so the durable half of each assertion (read the actual file bytes
 * back) is real disk I/O, not an in-memory illusion.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConnectedAccount } from '@neuropause/shared';
import { REDACTED_MARKER } from '@neuropause/shared';

const mockState = vi.hoisted(() => ({ userDataDir: '' }));
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
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8'),
  },
}));

import { scrubAccountMetadata } from './metadataCredentialGuard';

const JWT = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhdHRhY2tlciJ9.c2lnLXNpZy1zaWctc2ln';

const account = (over: Partial<ConnectedAccount>): ConnectedAccount => ({
  id: 'acct_r009',
  connectorId: 'slack',
  workspaceId: 'ws_r009',
  label: 'Acme Workspace',
  externalId: null,
  avatarUrl: null,
  status: 'connected',
  health: 'healthy',
  grantedScopes: ['chat:write'],
  connectedAt: '2026-08-20T00:00:00.000Z',
  lastSyncAt: null,
  lastSyncState: 'never',
  accessTokenExpiresAt: '2026-08-20T01:00:00.000Z',
  error: null,
  ...over,
});

describe('scrubAccountMetadata (pure)', () => {
  it('scrubs a JWT-shaped label, a Bearer error, and a token-shaped scope entry — and names the fields, never the values', () => {
    const hostile = account({
      label: `Acme ${JWT}`,
      error: 'provider rejected Bearer abc.def-ghi retry later',
      grantedScopes: ['chat:write', 'xoxb-1234567890-abcDEF'],
    });
    const { account: safe, scrubbedFields } = scrubAccountMetadata(hostile);
    expect(JSON.stringify(safe)).not.toContain(JWT);
    expect(JSON.stringify(safe)).not.toContain('abc.def-ghi');
    expect(JSON.stringify(safe)).not.toContain('xoxb-1234567890-abcDEF');
    expect(safe.grantedScopes[0]).toBe('chat:write');
    expect([...scrubbedFields].sort()).toEqual(['error', 'grantedScopes', 'label']);
  });

  it('divergence pin: an EMAIL label survives (RULE-009 is credentials, not identifiers) and ISO dates are untouched', () => {
    const legit = account({ label: 'user@example.com' });
    const { account: safe, scrubbedFields } = scrubAccountMetadata(legit);
    expect(safe).toBe(legit); // same identity — nothing scrubbed
    expect(scrubbedFields).toEqual([]);
    expect(safe.label).toBe('user@example.com');
    expect(safe.accessTokenExpiresAt).toBe('2026-08-20T01:00:00.000Z');
  });
});

describe('RULE-009 at the REAL persistence path', () => {
  beforeEach(() => {
    mockState.userDataDir = mkdtempSync(join(tmpdir(), 'np013-rule009-'));
  });
  afterEach(() => {
    rmSync(mockState.userDataDir, { recursive: true, force: true });
    vi.resetModules();
  });

  it('WRITE door: a hostile upsert persists the account, but the credential bytes never reach connectors.json', async () => {
    vi.resetModules();
    const { connectorStore } = await import('./connectorStore');
    connectorStore.bindWorkspace(() => 'ws_r009');
    await connectorStore.load();
    await connectorStore.upsert(
      account({ label: `Acme ${JWT}`, error: 'auth said Bearer abc.def-ghi', grantedScopes: ['xoxb-1234567890-abcDEF'] }),
    );
    const bytes = readFileSync(join(mockState.userDataDir, 'connectors.json'), 'utf8');
    expect(bytes).not.toContain(JWT);
    expect(bytes).not.toContain('abc.def-ghi');
    expect(bytes).not.toContain('xoxb-1234567890-abcDEF');
    expect(bytes).toContain(REDACTED_MARKER);
    expect(bytes).toContain('acct_r009'); // the account itself persisted — scrub, not refuse
  });

  it('READ door: a token already smuggled onto disk is scrubbed at load AND the file itself is cleaned', async () => {
    writeFileSync(
      join(mockState.userDataDir, 'connectors.json'),
      JSON.stringify([account({ label: `pre-guard ${JWT}` })]),
      { mode: 0o600 },
    );
    vi.resetModules();
    const { connectorStore } = await import('./connectorStore');
    connectorStore.bindWorkspace(() => 'ws_r009');
    await connectorStore.load();
    const listed = connectorStore.all();
    expect(listed).toHaveLength(1);
    expect(listed[0].label).not.toContain(JWT);
    const bytes = readFileSync(join(mockState.userDataDir, 'connectors.json'), 'utf8');
    expect(bytes).not.toContain(JWT); // the round-trip is dead: disk no longer carries the bytes
  });
});
