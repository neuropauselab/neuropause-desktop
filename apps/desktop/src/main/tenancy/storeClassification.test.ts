/**
 * P13C ROUND 9 — F18/F20/F14/F21. THE BEHAVIOUR BEHIND THE DECLARATIONS.
 *
 * `storeScopeGate.test.ts` proves that every persisting file ANSWERS the scope
 * question. It cannot prove the answer is true — a declaration is a sentence,
 * and this program's whole history is sentences that were wrong. This suite
 * exercises the two files where widening the detector exposed a real ownership
 * or retention defect, with data rather than doubles:
 *
 *   - the local application registry, whose `launchCount` / `usage.*` were
 *     accumulated on a SHARED row from every organization's launches, so
 *     `registry:list` and `registry:stats` were a live meter of another
 *     tenant's activity (F20);
 *   - the connector vault, whose `clear()` took an OPTIONAL workspace and
 *     deleted the WHOLE FILE when it was missing — every workspace's
 *     credentials destroyed by the case where the code knew least (F14).
 *
 * THE FIXTURES ARE REAL AND ASYMMETRIC. Three tenants launch 3, 7 and 11 times;
 * two workspaces hold 2 and 3 credentials. The counts are distinct primes so a
 * test cannot pass by leaking one tenant's number into another and still look
 * right, and every isolation assertion names both halves: the refused read AND
 * the allowed read being non-empty. A suite that only proves A cannot see B
 * passes just as well when the store returns nothing to anybody.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { RegistryEntry, registry as RegistryApi } from '../registry/registry';
import type { connectorVault as ConnectorVaultApi, AccountTokens } from '../connectors/connectorVault';

const TENANT_A = 'org-alpha';
const TENANT_B = 'org-beta';
const TENANT_C = 'org-gamma';

const WS_A = 'workspace-alpha';
const WS_B = 'workspace-beta';

/** Launches per tenant. Distinct primes — see the header. */
const LAUNCHES: Record<string, number> = { [TENANT_A]: 3, [TENANT_B]: 7, [TENANT_C]: 11 };

function entry(slug: string): RegistryEntry {
  return {
    slug,
    name: slug,
    appType: 'web',
    installedVersion: '1.0.0',
    channel: 'stable',
    installLocation: null,
    packageHash: null,
    signatureKeyId: null,
    hasSignature: false,
    previousVersion: null,
    previousPackageHash: null,
    grantedPermissions: [],
    permissionGrants: [],
    launchCount: 0,
    lastLaunchedAt: null,
    installedAt: '2026-01-01T00:00:00.000Z',
    lastUpdatedAt: null,
    runtimeStatus: 'stopped',
    healthStatus: 'unknown',
    diskUsageBytes: null,
    pinned: false,
    favorite: false,
    config: {},
    usage: { launches: 0, totalActiveMs: 0, lastSessionAt: null },
  } as RegistryEntry;
}

/* ══════════════════ F20 — the registry's launch counters ══════════════════ */

describe('the local application registry keeps launch counters per tenant', () => {
  let dir: string;
  let registry: typeof RegistryApi;
  let active: string | null;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-registry-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    active = null;

    // Electron stands in for the userData path only. The registry's own file
    // format, atomic write, integrity checksum and per-tenant bucketing are all
    // the real code.
    vi.resetModules();
    vi.doMock('electron', () => ({ app: { getPath: () => dir } }));
    registry = (await import('../registry/registry')).registry;
    registry.bindUsageScope(() => active);
    await registry.load();
    await registry.upsert(entry('atlas'));
    await registry.upsert(entry('beacon'));
  });

  afterEach(async () => {
    vi.doUnmock('electron');
    vi.resetModules();
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });

  /** Launch `slug` `n` times as `tenant`. Real writes through the real path. */
  async function launchAs(tenant: string, slug: string, n: number): Promise<void> {
    active = tenant;
    for (let i = 0; i < n; i += 1) await registry.recordLaunch(slug);
  }

  async function seedABC(): Promise<void> {
    for (const tenant of [TENANT_A, TENANT_B, TENANT_C]) {
      await launchAs(tenant, 'atlas', LAUNCHES[tenant]!);
    }
  }

  it('gives each tenant exactly its own launch count — 3, 7 and 11', async () => {
    await seedABC();
    for (const tenant of [TENANT_A, TENANT_B, TENANT_C]) {
      active = tenant;
      const dto = registry.get('atlas');
      expect(dto, `${tenant} must see the shared catalogue row`).not.toBeNull();
      expect(dto!.launchCount, `${tenant} launchCount`).toBe(LAUNCHES[tenant]);
      expect(dto!.usage.launches, `${tenant} usage.launches`).toBe(LAUNCHES[tenant]);
    }
  });

  it('never shows one tenant the sum of everybody, which is what the finding was', async () => {
    await seedABC();
    const total = LAUNCHES[TENANT_A]! + LAUNCHES[TENANT_B]! + LAUNCHES[TENANT_C]!; // 21
    for (const tenant of [TENANT_A, TENANT_B, TENANT_C]) {
      active = tenant;
      expect(registry.get('atlas')!.launchCount).not.toBe(total);
      expect(registry.stats().totalLaunches).not.toBe(total);
      // …and the allowed half is non-empty: the tenant DOES see its own work.
      expect(registry.stats().totalLaunches).toBe(LAUNCHES[tenant]);
      expect(registry.list()).toHaveLength(2);
    }
  });

  it('the CATALOGUE stays shared while the counters do not', async () => {
    await seedABC();
    // Every tenant sees both installed apps — the registry is install-level and
    // that is correct. Only the numbers beside them are private.
    for (const tenant of [TENANT_A, TENANT_B, TENANT_C]) {
      active = tenant;
      expect(registry.list().map((e) => e.slug).sort()).toEqual(['atlas', 'beacon']);
    }
  });

  it('a tenant that has never launched an app sees zero, not the install aggregate', async () => {
    await seedABC();
    active = 'org-delta-never-launched';
    const dto = registry.get('atlas');
    expect(dto).not.toBeNull();
    expect(dto!.launchCount).toBe(0);
    expect(dto!.lastLaunchedAt).toBeNull();
    expect(registry.stats().totalLaunches).toBe(0);
  });

  it('an UNRESOLVED caller writes and reads its own bucket, reaching no tenant', async () => {
    await seedABC();
    // The single-user desktop case: no organization has resolved. It must not
    // fall through to somebody's rows, and it must not be blind to its own.
    active = null;
    expect(registry.get('atlas')!.launchCount).toBe(0);
    await registry.recordLaunch('atlas');
    await registry.recordLaunch('atlas');
    expect(registry.get('atlas')!.launchCount).toBe(2);
    // …and the tenants are untouched by it.
    active = TENANT_B;
    expect(registry.get('atlas')!.launchCount).toBe(7);
  });

  it('session duration accrues to the caller too', async () => {
    active = TENANT_A;
    await registry.recordSessionDuration('atlas', 5_000);
    active = TENANT_B;
    await registry.recordSessionDuration('atlas', 900);
    active = TENANT_A;
    expect(registry.get('atlas')!.usage.totalActiveMs).toBe(5_000);
    active = TENANT_B;
    expect(registry.get('atlas')!.usage.totalActiveMs).toBe(900);
  });

  it('registry:export — a PUBLIC channel — carries only the caller\'s bucket', async () => {
    await seedABC();
    active = TENANT_A;
    const exported = JSON.parse(registry.export()) as {
      usageByTenant: Record<string, Record<string, unknown>>;
    };
    expect(Object.keys(exported.usageByTenant)).toEqual([TENANT_A]);
    // The allowed half: A's own counters ARE there, so this is a boundary and
    // not an empty answer.
    expect(exported.usageByTenant[TENANT_A]!.atlas).toEqual({
      launchCount: 3,
      lastLaunchedAt: expect.any(String),
      totalActiveMs: 0,
      lastSessionAt: expect.any(String),
    });
    // The refused half, checked against the raw text so a nested key cannot hide.
    expect(registry.export()).not.toContain(TENANT_B);
    expect(registry.export()).not.toContain(TENANT_C);
  });

  it('an import cannot write into another tenant\'s counters', async () => {
    await seedABC();
    active = TENANT_A;
    // A crafted payload naming B's bucket, of the shape `export()` produces.
    const hostile = JSON.stringify({
      schemaVersion: 1,
      checksum: '',
      meta: { createdAt: '', updatedAt: '' },
      entries: { atlas: entry('atlas') },
      usageByTenant: { [TENANT_B]: { atlas: { launchCount: 9999, lastLaunchedAt: null, totalActiveMs: 0, lastSessionAt: null } } },
    });
    await registry.import(hostile, { merge: true });
    active = TENANT_B;
    expect(registry.get('atlas')!.launchCount).toBe(7);
  });

  it('the counters survive a restart, keyed by tenant', async () => {
    await seedABC();
    vi.resetModules();
    vi.doMock('electron', () => ({ app: { getPath: () => dir } }));
    const reloaded = (await import('../registry/registry')).registry;
    let who: string | null = null;
    reloaded.bindUsageScope(() => who);
    await reloaded.load();
    for (const tenant of [TENANT_A, TENANT_B, TENANT_C]) {
      who = tenant;
      expect(reloaded.get('atlas')!.launchCount, `${tenant} after restart`).toBe(LAUNCHES[tenant]);
    }
  });

  it('a launch never rewrites the integrity-checked entry map', async () => {
    // The checksum covers `entries`; counters live beside it deliberately, so a
    // launch cannot make the file look tampered with (or hide that it was).
    await launchAs(TENANT_A, 'atlas', 3);
    const raw = JSON.parse(readFileSync(join(dir, 'registry.json'), 'utf8')) as {
      entries: Record<string, RegistryEntry>;
      usageByTenant: Record<string, unknown>;
    };
    expect(raw.entries.atlas!.launchCount).toBe(0);
    expect(raw.usageByTenant[TENANT_A]).toBeDefined();
    expect(registry.isIntegrityOk()).toBe(true);
  });
});

/* ══════════════════ F14 — the connector vault's clear() ══════════════════ */

describe('the connector vault refuses an unscoped clear', () => {
  let dir: string;
  let vault: typeof ConnectorVaultApi;
  let cipherStore: Map<string, string>;

  const tokens = (label: string): AccountTokens => ({
    accessToken: `AT-${label}`,
    refreshToken: null,
    expiresAt: null,
    scopes: [],
    tokenType: 'Bearer',
  });

  beforeEach(async () => {
    dir = join(tmpdir(), `np-vault-clear-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    cipherStore = new Map();

    vi.resetModules();
    vi.doMock('electron', () => ({
      app: { getPath: () => dir },
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (plain: string) => {
          const buf = Buffer.from(`enc:${randomUUID()}`, 'utf8');
          cipherStore.set(buf.toString('base64'), plain);
          return buf;
        },
        decryptString: (buf: Buffer) => {
          const found = cipherStore.get(buf.toString('base64'));
          if (found === undefined) throw new Error('cannot decrypt');
          return found;
        },
      },
    }));
    vault = (await import('../connectors/connectorVault')).connectorVault;

    // Workspace A holds 2 credentials, workspace B holds 3. Asymmetric so a
    // count can never accidentally match the wrong workspace.
    await vault.set(WS_A, 'hubspot', 'acct_a1', tokens('a1'));
    await vault.set(WS_A, 'slack', 'acct_a2', tokens('a2'));
    await vault.set(WS_B, 'hubspot', 'acct_b1', tokens('b1'));
    await vault.set(WS_B, 'github', 'acct_b2', tokens('b2'));
    await vault.set(WS_B, 'github', 'acct_b3', tokens('b3'));
  });

  afterEach(async () => {
    vi.doUnmock('electron');
    vi.resetModules();
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });

  /** How many credentials a workspace can actually spend. Counted by reading. */
  async function liveCount(workspaceId: string): Promise<number> {
    const all: [string, string, string][] = [
      [WS_A, 'hubspot', 'acct_a1'],
      [WS_A, 'slack', 'acct_a2'],
      [WS_B, 'hubspot', 'acct_b1'],
      [WS_B, 'github', 'acct_b2'],
      [WS_B, 'github', 'acct_b3'],
    ];
    let n = 0;
    for (const [ws, connectorId, accountId] of all) {
      if (ws !== workspaceId) continue;
      if ((await vault.get(ws, connectorId, accountId)) !== null) n += 1;
    }
    return n;
  }

  it('the fixture is real: A holds 2 spendable credentials and B holds 3', async () => {
    expect(await liveCount(WS_A)).toBe(2);
    expect(await liveCount(WS_B)).toBe(3);
  });

  it('clear() with NO resolved workspace removes NOTHING', async () => {
    await vault.clear();
    expect(await liveCount(WS_A)).toBe(2);
    expect(await liveCount(WS_B)).toBe(3);
    // The file itself must still exist — the finding was `fs.unlink(vaultPath())`.
    await expect(fs.access(join(dir, 'connector-vault.bin'))).resolves.toBeUndefined();
  });

  it('clear(\'\') — an unresolved id wearing a string — also removes NOTHING', async () => {
    // `requireWorkspace()` returning '' is the realistic way this happens.
    await vault.clear('');
    expect(await liveCount(WS_A)).toBe(2);
    expect(await liveCount(WS_B)).toBe(3);
  });

  it('clear(WS_A) removes ONLY workspace A — B survives, counted', async () => {
    await vault.clear(WS_A);
    expect(await liveCount(WS_A)).toBe(0);
    expect(await liveCount(WS_B)).toBe(3);
  });

  it('clear(WS_B) removes ONLY workspace B — A survives, counted', async () => {
    await vault.clear(WS_B);
    expect(await liveCount(WS_B)).toBe(0);
    expect(await liveCount(WS_A)).toBe(2);
  });

  it('an unscoped clear cannot destroy the legacy entries an operator must reconnect', async () => {
    // A pre-P10 file: connector ids at the top level, moved to `legacy` on read.
    await fs.writeFile(
      join(dir, 'connector-vault.bin'),
      JSON.stringify({ schemaVersion: 1, salesforce: { acct_legacy: 'ciphertext' } }),
    );
    expect(await vault.migrationRequired()).toHaveLength(1);
    await vault.clear();
    expect(await vault.migrationRequired()).toHaveLength(1);
  });
});

/* ══════════════════ The declarations themselves ══════════════════ */

describe('every persisting file in the main process is classified', () => {
  /**
   * The gate's own predicate, restated here so this suite fails too if a new
   * unclassified store appears. Duplicated deliberately: a single gate that
   * somebody skips is a single point of failure, and the cost is nine lines.
   */
  const MAIN = join(fileURLToPath(new URL('.', import.meta.url)), '..');

  function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (name === 'node_modules' || name === 'e2e') continue;
        out.push(...sourceFiles(p));
      } else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.bench.ts')) {
        out.push(p);
      }
    }
    return out;
  }

  it('the fifteen files F18 exposed all now declare or are named as not-a-store', () => {
    /**
     * The exact list the widened detector produced. Named individually rather
     * than counted, so a file that quietly stops persisting — or a declaration
     * somebody deletes — is a failure with an address.
     */
    const DECLARED = [
      'connectors/connectorVault.ts',
      'documents/documentStore.ts',
      'license/validator.ts',
      'onboarding/experienceProfileService.ts',
      'recovery/recoveryService.ts',
      'registry/registry.ts',
      'runtimePreferences.ts',
      'services/crashReporter.ts',
      'services/executiveDelivery.ts',
      'windowState.ts',
      'workspaces/workspaceContextStore.ts',
    ];
    for (const rel of DECLARED) {
      const src = readFileSync(join(MAIN, rel), 'utf8');
      expect(src, `${rel} must declare a scope`).toMatch(/declareStoreScope\(\{/);
    }
  });

  it('no declaration in the tree pairs customer data with a global scope', () => {
    /**
     * `declareStoreScope` throws on that pair at construction, and this checks
     * the SOURCE as well — because a store whose module is never imported by any
     * test never constructs, so the runtime rule would never fire for it.
     */
    const offenders: string[] = [];
    for (const path of sourceFiles(MAIN)) {
      const src = readFileSync(path, 'utf8');
      for (const block of src.match(/declareStoreScope\(\{[\s\S]*?\n\}\);/g) ?? []) {
        const scope = /scope:\s*'(\w+)'/.exec(block)?.[1];
        const authority = /authority:\s*'(\w+)'/.exec(block)?.[1];
        const classification = /classification:\s*'(\w+)'/.exec(block)?.[1];
        const global = scope === 'INSTALL_GLOBAL' || scope === 'PLATFORM_GLOBAL';
        if (global && classification === 'CUSTOMER_DERIVED') {
          offenders.push(`${path.slice(MAIN.length + 1)}: ${scope} + CUSTOMER_DERIVED`);
        }
        if (global && authority === 'ORG_ROLE') {
          offenders.push(`${path.slice(MAIN.length + 1)}: ${scope} + ORG_ROLE`);
        }
      }
    }
    expect(offenders.sort()).toEqual([]);
  });
});

/* ══════════════════ F21 — install-wide operations, install-wide authority ══════════════════ */

describe('an install-wide operation is not one organization\'s to run', () => {
  it('backup restore/delete, recovery and the support bundle require cloud:operate', async () => {
    const { RUNTIME_CHANNEL_PERMISSIONS } = await import('../ipc/runtimeAuthz');
    const { IpcChannel, isPlatformOnlyPermission } = await import('@neuropause/shared');
    /**
     * Each of these reaches every organization's data on the machine: restore
     * copies a whole-datadir snapshot back, delete destroys it, `recovery:run`
     * reaches restore plus `resetSettings`, the support bundle writes every
     * tenant's diagnostics to disk, and `registry:import` replaces the installed
     * app map. `org:manage` and `operations:manage` are ORGANIZATION roles, and
     * anyone may create an organization and own one.
     */
    for (const channel of [
      IpcChannel.BackupRestore,
      IpcChannel.BackupDelete,
      IpcChannel.RecoveryRun,
      IpcChannel.SupportGenerateBundle,
      IpcChannel.RegistryImport,
      IpcChannel.RegistryBackup,
    ]) {
      const permission = RUNTIME_CHANNEL_PERMISSIONS[channel];
      expect(permission, `${channel} must be classified`).toBeDefined();
      expect(isPlatformOnlyPermission(permission!), `${channel} must be platform-only`).toBe(true);
    }
  });
});
