/**
 * P13C ROUND 10 — NEW-H7, F22, NEW-M6, NEW-M7.
 *
 * FOUR FINDINGS, ONE PROPERTY: AN INSTALL-WIDE RESOURCE IS NOT ONE
 * ORGANIZATION'S TO CHANGE, AND A PATH IS NOT SAFE BECAUSE IT LOOKS SAFE.
 *
 * WHAT THIS SUITE REFUSES TO DO
 *
 * It does not assert that a map contains the string `'cloud:operate'`. A string
 * test passes when the enforcement is removed, and this program has already shipped
 * a declaration that said `PLATFORM_OPERATOR` while the channel it described took
 * an organization role — for two rounds — because nothing compared the two.
 *
 * SO EVERY AUTHORITY ASSERTION HERE RUNS THE REAL PATH: `withRuntimeAuthz` stamps
 * the def exactly as `runtimeCore` does, `runSecureHandler` applies the auth gate
 * and the RBAC check exactly as the bridge does, and `createAuthorize` resolves the
 * actor exactly as the enterprise gate does. The AXIS is what is asserted:
 *
 *   - an Owner holding EVERY permission an organization role can hold
 *     (`ALL_ENTERPRISE_PERMISSIONS` minus the platform-only set, asserted to be
 *     larger than 30 so no assertion can pass on an empty array) is REFUSED, and
 *     the handler's own counter proves it never ran;
 *   - a SECOND organization's Owner is refused identically, so creating an
 *     organization and owning it confers nothing;
 *   - an install-level platform operator, a member of no organization, is ALLOWED —
 *     the allow case is proved, not assumed.
 *
 * And every filesystem assertion runs against a REAL temporary directory with a
 * REAL file planted outside the backups root: the test that a traversal was refused
 * is the test that the file is still there afterwards.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mockState = vi.hoisted(() => ({ userDataDir: '' }));
vi.mock('electron', () => ({
  app: {
    getPath: () => mockState.userDataDir,
    getAppPath: () => mockState.userDataDir,
    getVersion: () => '1.0.0',
    getName: () => 'neuropause-test',
    isPackaged: false,
    on: () => undefined,
    once: () => undefined,
    whenReady: () => Promise.resolve(),
  },
  ipcMain: { handle: () => undefined, on: () => undefined },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  Notification: class {
    show(): void {
      /* no-op */
    }
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8'),
  },
  shell: { openPath: () => Promise.resolve('') },
}));

import {
  ALL_ENTERPRISE_PERMISSIONS,
  BackupIdRequest,
  BackupRestoreRequest,
  EmptyRequest,
  IpcChannel,
  isPlatformOnlyPermission,
} from '@neuropause/shared';
import type {
  EnterprisePermission,
  IpcChannelName,
  OrgRole,
  OrgUser,
  RuntimePermissionKey,
} from '@neuropause/shared';
import type { AnySecureHandlerDef, SecureHandlerDef } from '../ipc/secureBridge';
import { runSecureHandler } from '../ipc/secureBridge';
import { createAuthorize } from '../enterprise/authzGate';
import { BUILT_IN_ROLE_SPECS } from '../enterprise/org/seed';
import { PUBLIC_CHANNELS, RUNTIME_CHANNEL_PERMISSIONS, withRuntimeAuthz } from '../ipc/runtimeAuthz';
import {
  PLUGIN_FAMILY_CHANNELS,
  PLUGIN_MUTATION_CHANNELS,
  PLUGIN_STORE_NAME,
  assertPlatformStoreChannelAuthority,
  assertPluginChannelAuthority,
} from '../plugins/pluginAuthzGate';
import { BackupManager, type StoredBackupManifest } from '../backup/backupManager';
import { INSTALL_ARCHIVE, isSafeArchiveId } from '../backup/backupArchive';

/* ── identities ────────────────────────────────────────────────────────── */

const A_OWNER = 'owner@alpha.example';
const B_OWNER = 'owner@bravo.example';
const A_MEMBER = 'member@alpha.example';
const OPERATOR = 'operator@install.example';

/** Every permission an ORGANIZATION ROLE can hold — the Owner wildcard. */
const ORG_OWNER_PERMISSIONS: readonly EnterprisePermission[] = ALL_ENTERPRISE_PERMISSIONS.filter(
  (p) => !isPlatformOnlyPermission(p),
);
const MEMBER_PERMISSIONS = BUILT_IN_ROLE_SPECS.find((r) => r.key === 'member')!.permissions;

function authorizeFor(input: {
  email: string;
  orgId: string;
  permissions: readonly EnterprisePermission[];
  operators?: readonly string[];
}): (permission: EnterprisePermission) => void {
  const roleId = `role-${input.orgId}`;
  const member = {
    id: `user-${input.email}`,
    orgId: input.orgId,
    kind: 'human',
    name: input.email,
    email: input.email,
    status: 'active',
    roleIds: [roleId],
  } as unknown as OrgUser;
  const role = {
    id: roleId,
    orgId: input.orgId,
    name: 'Fixture',
    permissions: [...input.permissions],
  } as unknown as OrgRole;
  const operators = new Set((input.operators ?? []).map((e) => e.toLowerCase()));
  return createAuthorize({
    sessionEmail: () => input.email,
    activeOrgId: () => input.orgId,
    usersFor: () => [member],
    rolesFor: () => [role],
    ownerMember: () => null,
    isPlatformOperator: (e) => operators.has(e.toLowerCase()),
  });
}

const orgOwnerOfAlpha = (): ((p: EnterprisePermission) => void) =>
  authorizeFor({ email: A_OWNER, orgId: 'org-alpha', permissions: ORG_OWNER_PERMISSIONS });
const orgOwnerOfBravo = (): ((p: EnterprisePermission) => void) =>
  authorizeFor({ email: B_OWNER, orgId: 'org-bravo', permissions: ORG_OWNER_PERMISSIONS });
const orgMember = (): ((p: EnterprisePermission) => void) =>
  authorizeFor({ email: A_MEMBER, orgId: 'org-alpha', permissions: MEMBER_PERMISSIONS });
/** An install-level operator, a member of NO organization. */
const platformOperator = (): ((p: EnterprisePermission) => void) =>
  authorizeFor({ email: OPERATOR, orgId: 'org-none', permissions: [], operators: [OPERATOR] });

/* ── the channel under test, stamped by the production annotator ───────── */

interface Probe {
  def: AnySecureHandlerDef;
  ran: () => number;
}

function probe(channel: IpcChannelName): Probe {
  let ran = 0;
  const raw = {
    channel,
    schema: EmptyRequest,
    handler: () => {
      ran += 1;
      return { ok: true };
    },
  } as unknown as SecureHandlerDef;
  const [stamped] = withRuntimeAuthz([raw]);
  return { def: stamped as unknown as AnySecureHandlerDef, ran: () => ran };
}

async function invoke(
  p: Probe,
  actor: { authorize?: (permission: EnterprisePermission) => void; authenticated?: boolean } = {},
): Promise<unknown> {
  return runSecureHandler(p.def, {}, {
    isAuthenticated: () => actor.authenticated ?? true,
    authorize: actor.authorize,
  });
}

/* ═══════════════════════════════════════════════════════════════════════
 * NEW-H7 — a plugin capability grant is not an organization's decision
 * ═══════════════════════════════════════════════════════════════════════ */

describe('NEW-H7 — plugins:grant / plugins:revoke are on the platform axis', () => {
  it('the organization-owner permission set is large, so the refusals below mean something', () => {
    expect(ORG_OWNER_PERMISSIONS.length).toBeGreaterThan(30);
    // The exact permission the finding used, held by every tenant's Owner AND Admin.
    expect(ORG_OWNER_PERMISSIONS).toContain('marketplace:manage');
    expect(ORG_OWNER_PERMISSIONS).toContain('org:manage');
    expect(ORG_OWNER_PERMISSIONS).not.toContain('cloud:operate');
    const ownerRole = BUILT_IN_ROLE_SPECS.find((r) => r.key === 'owner')!;
    expect([...ownerRole.permissions]).toEqual([...ORG_OWNER_PERMISSIONS]);
  });

  it('every MUTATING plugin channel requires a permission no organization role can hold', () => {
    expect(PLUGIN_MUTATION_CHANNELS.length).toBe(8);
    for (const channel of PLUGIN_MUTATION_CHANNELS) {
      const permission = RUNTIME_CHANNEL_PERMISSIONS[channel];
      expect(permission, `${channel} must be classified`).toBeDefined();
      expect(
        isPlatformOnlyPermission(permission!),
        `${channel} carries ${permission}, which an organization role can hold`,
      ).toBe(true);
      expect(PUBLIC_CHANNELS.has(channel), `${channel} must not be public`).toBe(false);
      const p = probe(channel);
      expect(p.def.requireAuth, `${channel} must require a session`).toBe(true);
      expect(p.def.permission).toBe(permission);
    }
  });

  it('an Owner holding EVERY organization permission is REFUSED, and the handler never runs', async () => {
    for (const channel of [IpcChannel.PluginsGrant, IpcChannel.PluginsRevoke]) {
      const p = probe(channel);
      await expect(invoke(p, { authorize: orgOwnerOfAlpha() }), channel).rejects.toThrow(
        /not authorized/i,
      );
      expect(p.ran(), `${channel} ran despite the refusal`).toBe(0);
    }
  });

  it('a SECOND organization’s Owner is refused identically — owning an org confers nothing', async () => {
    const p = probe(IpcChannel.PluginsGrant);
    await expect(invoke(p, { authorize: orgOwnerOfBravo() })).rejects.toThrow(/not authorized/i);
    expect(p.ran()).toBe(0);
  });

  it('an ordinary Member and an unauthenticated caller are both refused', async () => {
    const member = probe(IpcChannel.PluginsGrant);
    await expect(invoke(member, { authorize: orgMember() })).rejects.toThrow(/not authorized/i);
    expect(member.ran()).toBe(0);
    const anon = probe(IpcChannel.PluginsGrant);
    await expect(invoke(anon, { authenticated: false })).rejects.toThrow(/sign in/i);
    expect(anon.ran()).toBe(0);
  });

  it('a platform operator IS allowed — the fix did not just break the feature', async () => {
    for (const channel of [IpcChannel.PluginsGrant, IpcChannel.PluginsRevoke]) {
      const p = probe(channel);
      await expect(invoke(p, { authorize: platformOperator() }), channel).resolves.toEqual({
        ok: true,
      });
      expect(p.ran()).toBe(1);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * NEW-H7 — the composition-time invariant that binds store to channel
 * ═══════════════════════════════════════════════════════════════════════ */

describe('the store↔channel authority invariant is checked at composition', () => {
  beforeAll(async () => {
    /**
     * Importing the plugin manager is what registers the store declaration AND
     * what runs `assertPluginChannelAuthority()` in production. If a mutating
     * plugin channel carried an organization permission, THIS IMPORT WOULD
     * THROW — so the import succeeding is itself the production-path assertion.
     */
    mockState.userDataDir = await fs.mkdtemp(join(tmpdir(), 'np-plugin-gate-'));
    await import('../plugins/pluginManager');
  });

  it('passes for the production tables (and the plugin store declares itself)', () => {
    expect(() => assertPluginChannelAuthority()).not.toThrow();
    expect(PLUGIN_FAMILY_CHANNELS.length).toBeGreaterThanOrEqual(12);
  });

  it('THROWS when a platform-store channel is given an ORGANIZATION permission', () => {
    // The exact regression this round fixed, re-introduced in the table only.
    expect(() =>
      assertPlatformStoreChannelAuthority({
        storeName: PLUGIN_STORE_NAME,
        family: PLUGIN_FAMILY_CHANNELS,
        mutations: PLUGIN_MUTATION_CHANNELS,
        permissionOf: (c) =>
          c === IpcChannel.PluginsGrant ? 'marketplace:manage' : RUNTIME_CHANNEL_PERMISSIONS[c],
      }),
    ).toThrow(/plugins:grant → marketplace:manage/);
  });

  it('THROWS for ANY organization permission, not a blocklist of known-bad ones', () => {
    for (const permission of ['org:manage', 'operations:manage', 'marketplace:read'] as const) {
      expect(() =>
        assertPlatformStoreChannelAuthority({
          storeName: PLUGIN_STORE_NAME,
          family: PLUGIN_FAMILY_CHANNELS,
          mutations: PLUGIN_MUTATION_CHANNELS,
          permissionOf: (c) =>
            c === IpcChannel.PluginsRemove ? permission : RUNTIME_CHANNEL_PERMISSIONS[c],
        }),
      ).toThrow(new RegExp(`plugins:remove → ${permission}`));
    }
  });

  it('THROWS when a mutation is left with no permission at all', () => {
    expect(() =>
      assertPlatformStoreChannelAuthority({
        storeName: PLUGIN_STORE_NAME,
        family: PLUGIN_FAMILY_CHANNELS,
        mutations: PLUGIN_MUTATION_CHANNELS,
        permissionOf: (c) =>
          c === IpcChannel.PluginsEnable ? undefined : RUNTIME_CHANNEL_PERMISSIONS[c],
        isPublic: () => true,
      }),
    ).toThrow(/a mutation may never be public/);
  });

  it('THROWS when a family channel is neither classified nor allowlisted', () => {
    expect(() =>
      assertPlatformStoreChannelAuthority({
        storeName: PLUGIN_STORE_NAME,
        family: PLUGIN_FAMILY_CHANNELS,
        mutations: PLUGIN_MUTATION_CHANNELS,
        permissionOf: (c) => RUNTIME_CHANNEL_PERMISSIONS[c],
        isPublic: () => false,
      }),
    ).toThrow(/no permission classification/);
  });

  it('THROWS when the store it guards has never declared a scope', () => {
    expect(() =>
      assertPlatformStoreChannelAuthority({
        storeName: 'a-store-nobody-declared',
        family: PLUGIN_FAMILY_CHANNELS,
        mutations: PLUGIN_MUTATION_CHANNELS,
      }),
    ).toThrow(/has no scope declaration/);
  });

  it('is silent for a store that is NOT on the platform axis — it is a predicate, not a blanket', () => {
    // A TENANT store with ORG_ROLE authority is exactly where an organization
    // permission belongs; the gate must not flag it.
    expect(() =>
      assertPlatformStoreChannelAuthority({
        storeName: 'a-tenant-store',
        family: PLUGIN_FAMILY_CHANNELS,
        mutations: PLUGIN_MUTATION_CHANNELS,
        permissionOf: () => 'marketplace:manage',
        declarations: () => [
          {
            name: 'a-tenant-store',
            scope: 'TENANT',
            persistence: 'file',
            authority: 'ORG_ROLE',
            classification: 'CUSTOMER_DERIVED',
            retention: 'fixture',
            reason: 'fixture',
          },
        ],
      }),
    ).not.toThrow();
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * NEW-H7 — a grant cannot exceed the plugin's own manifest
 * ═══════════════════════════════════════════════════════════════════════ */

describe('NEW-H7 — pluginManager.grant consults the manifest', () => {
  let pluginRoot: string;
  let manager: typeof import('../plugins/pluginManager')['pluginManager'];

  beforeEach(async () => {
    mockState.userDataDir = await fs.mkdtemp(join(tmpdir(), 'np-plugin-'));
    pluginRoot = join(mockState.userDataDir, 'plugins', 'demo.plugin');
    await fs.mkdir(pluginRoot, { recursive: true });
    await fs.writeFile(
      join(pluginRoot, 'neuropause.plugin.json'),
      JSON.stringify({
        id: 'demo.plugin',
        name: 'Demo',
        version: '1.0.0',
        engine: { neuropause: '*' },
        kind: 'ui',
        contributions: [],
        // The plugin asked for ONE capability, and the user saw one.
        permissions: ['notifications'],
      }),
    );
    manager = (await import('../plugins/pluginManager')).pluginManager;
    await manager.load();
  });

  afterEach(async () => {
    await fs.rm(mockState.userDataDir, { recursive: true, force: true });
  });

  it('grants a capability the manifest declared', async () => {
    const dto = await manager.grant('demo.plugin', 'notifications');
    expect(dto.grantedPermissions).toContain('notifications');
  });

  it('REFUSES a capability the manifest never declared, and persists nothing', async () => {
    await expect(
      manager.grant('demo.plugin', 'shell_execution' as RuntimePermissionKey),
    ).rejects.toThrow(/did not request "shell_execution" in its manifest/);
    expect(manager.get('demo.plugin')!.grantedPermissions).not.toContain('shell_execution');
    // …and nothing reached plugins.json either.
    const raw = await fs.readFile(join(mockState.userDataDir, 'plugins.json'), 'utf8').catch(() => '');
    expect(raw).not.toContain('shell_execution');
  });

  it('still lets a revoke narrow what a plugin may do', async () => {
    await manager.grant('demo.plugin', 'notifications');
    const dto = await manager.revoke('demo.plugin', 'notifications');
    expect(dto.grantedPermissions).not.toContain('notifications');
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * NEW-M7 — the backup family's authority matches what it copies
 * ═══════════════════════════════════════════════════════════════════════ */

describe('NEW-M7 — backup:create requires install authority', () => {
  const FAMILY: IpcChannelName[] = [
    IpcChannel.BackupCreate,
    IpcChannel.BackupList,
    IpcChannel.BackupValidate,
    IpcChannel.BackupRestore,
    IpcChannel.BackupDelete,
  ];

  it('the whole family sits on the platform axis, and none of it is public', () => {
    for (const channel of FAMILY) {
      const permission = RUNTIME_CHANNEL_PERMISSIONS[channel];
      expect(permission, `${channel} must be classified`).toBeDefined();
      expect(isPlatformOnlyPermission(permission!), `${channel} must be platform-only`).toBe(true);
      expect(PUBLIC_CHANNELS.has(channel), `${channel} must not be public`).toBe(false);
    }
  });

  it('backup:create refuses an unauthenticated caller — the disk-fill loop needs a session', async () => {
    const p = probe(IpcChannel.BackupCreate);
    expect(p.def.requireAuth).toBe(true);
    await expect(invoke(p, { authenticated: false })).rejects.toThrow(/sign in/i);
    expect(p.ran()).toBe(0);
  });

  it('backup:create and backup:list refuse an Owner holding every organization permission', async () => {
    for (const channel of [IpcChannel.BackupCreate, IpcChannel.BackupList]) {
      const p = probe(channel);
      await expect(invoke(p, { authorize: orgOwnerOfAlpha() }), channel).rejects.toThrow(
        /not authorized/i,
      );
      expect(p.ran()).toBe(0);
    }
  });

  it('a platform operator may still create and list', async () => {
    for (const channel of [IpcChannel.BackupCreate, IpcChannel.BackupList]) {
      const p = probe(channel);
      await expect(invoke(p, { authorize: platformOperator() }), channel).resolves.toEqual({
        ok: true,
      });
      expect(p.ran()).toBe(1);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * F22 / NEW-M6 — the archive declares itself, and every path is contained
 * ═══════════════════════════════════════════════════════════════════════ */

describe('F22 / NEW-M6 — the multi-tenant archive and its containment', () => {
  let root: string;
  let dataDir: string;
  let backupsDir: string;
  /** A real file OUTSIDE the backups root. Every refusal below is measured on it. */
  let victimDir: string;
  let victimFile: string;

  const ACK = { boundary: 'ALL_TENANTS_AT_ONCE', declaredBy: 'round10 test' } as const;

  function manager(now = () => 1_700_000_000_000): BackupManager {
    return new BackupManager({
      dataDir,
      backupsDir,
      appVersion: '1.0.0',
      dataVersion: () => 1,
      now,
      restoreBoundary: { ...ACK },
    });
  }

  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'np-r10-backup-'));
    dataDir = join(root, 'data');
    backupsDir = join(root, 'backups');
    victimDir = join(root, 'victim');
    victimFile = join(victimDir, 'precious.txt');
    await fs.mkdir(dataDir, { recursive: true });
    await fs.mkdir(backupsDir, { recursive: true });
    await fs.mkdir(victimDir, { recursive: true });
    await fs.writeFile(victimFile, 'DO-NOT-TOUCH');
    await fs.writeFile(join(dataDir, 'registry.json'), 'ORIGINAL');
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  /* ── the declaration ──────────────────────────────────────────────── */

  it('the archive is DECLARED, with a restoration boundary and platform authority', () => {
    expect(INSTALL_ARCHIVE.scope).toBe('MULTI_TENANT_INSTALL');
    expect(INSTALL_ARCHIVE.authority).toBe('PLATFORM_OPERATOR');
    expect(INSTALL_ARCHIVE.restoration.boundary).toBe('ALL_TENANTS_AT_ONCE');
    expect(INSTALL_ARCHIVE.restoration.authority).toBe('PLATFORM_OPERATOR');
    // The declaration must NAME what it does not isolate rather than imply one.
    expect(INSTALL_ARCHIVE.restoration.detail).toMatch(/all-or-nothing across tenants/i);
    expect(INSTALL_ARCHIVE.contents).toMatch(/unpartitioned/i);
  });

  it('a manager cannot be constructed without acknowledging the boundary', () => {
    const deps = { dataDir, backupsDir, appVersion: '1.0.0', dataVersion: () => 1 };
    expect(
      () =>
        new BackupManager({
          ...deps,
          restoreBoundary: undefined as unknown as typeof ACK,
        }),
    ).toThrow(/must acknowledge the restoration boundary/);
    expect(
      () =>
        new BackupManager({
          ...deps,
          restoreBoundary: { boundary: 'ALL_TENANTS_AT_ONCE', declaredBy: '  ' },
        }),
    ).toThrow(/name the surface/);
  });

  /* ── the allow case ───────────────────────────────────────────────── */

  it('a normal create/restore round-trips — the allowed path demonstrably works', async () => {
    const info = await manager().create('manual', ['registry']);
    expect((await manager().validate(info.id)).valid).toBe(true);

    await fs.writeFile(join(dataDir, 'registry.json'), 'CHANGED');
    const result = await manager(() => 1_700_000_500_000).restore(info.id, ['registry'], { ...ACK });
    expect(result.detail).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.restored).toContain('registry');
    expect(await fs.readFile(join(dataDir, 'registry.json'), 'utf8')).toBe('ORIGINAL');
    // The pre-restore safety snapshot exists and captured the CHANGED state.
    expect(result.safetyBackupId).not.toBeNull();
    expect((await manager().validate(result.safetyBackupId as string)).valid).toBe(true);
  });

  it('a restore that does not acknowledge the archive’s boundary is REFUSED', async () => {
    const info = await manager().create('manual', ['registry']);
    await fs.writeFile(join(dataDir, 'registry.json'), 'CHANGED');
    const result = await manager(() => 1_700_000_600_000).restore(info.id, ['registry'], {
      boundary: 'ONE_TENANT' as unknown as 'ALL_TENANTS_AT_ONCE',
      declaredBy: 'a caller pretending this is narrow',
    });
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/may not cross a boundary its caller did not name/);
    // Nothing moved, and no safety snapshot was left behind by the refusal.
    expect(await fs.readFile(join(dataDir, 'registry.json'), 'utf8')).toBe('CHANGED');
    expect(result.safetyBackupId).toBeNull();
  });

  it('an archive with NO declaration cannot be restored at all', async () => {
    const info = await manager().create('manual', ['registry']);
    const manifestPath = join(backupsDir, info.id, 'manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as StoredBackupManifest;
    delete manifest.archive;
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    await fs.writeFile(join(dataDir, 'registry.json'), 'CHANGED');

    const result = await manager(() => 1_700_000_700_000).restore(info.id, ['registry'], { ...ACK });
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/no scope declaration/);
    expect(await fs.readFile(join(dataDir, 'registry.json'), 'utf8')).toBe('CHANGED');
  });

  /* ── NEW-M6: malicious ids ────────────────────────────────────────── */

  describe('a malicious backup id is refused at both layers', () => {
    /** The traversal that reaches the planted victim from <root>/backups. */
    const TRAVERSALS = (): Array<[string, string]> => [
      ['relative traversal', '../victim'],
      ['deep traversal', '../../../../../../../../etc'],
      ['dot-slash prefixed traversal', './../victim'],
      ['windows-separator traversal', '..\\victim'],
      ['percent-encoded traversal', '%2e%2e%2fvictim'],
      ['partially encoded traversal', '..%2fvictim'],
      ['bare dot-dot', '..'],
      ['dotfile', '.hidden'],
      ['nul byte', 'ok\u0000/../victim'],
      ['nested path', 'sub/dir'],
      ['absolute path', victimDir],
    ];

    it('the wire schema refuses every one of them', () => {
      for (const [label, id] of TRAVERSALS()) {
        expect(BackupIdRequest.safeParse({ id }).success, `${label}: ${id}`).toBe(false);
        expect(BackupRestoreRequest.safeParse({ id }).success, `${label}: ${id}`).toBe(false);
        expect(isSafeArchiveId(id), `${label}: ${id}`).toBe(false);
      }
      // …and a legitimate generated id is still accepted, so this is a charset
      // check and not a blanket refusal.
      const real = '2023-11-14T22-13-20-000Z-manual';
      expect(BackupIdRequest.safeParse({ id: real }).success).toBe(true);
      expect(isSafeArchiveId(real)).toBe(true);
    });

    it('delete REFUSES them and the file outside the root is still there', async () => {
      for (const [label, id] of TRAVERSALS()) {
        expect(await manager().delete(id), `${label} was deleted`).toBe(false);
        expect(await fs.readFile(victimFile, 'utf8'), label).toBe('DO-NOT-TOUCH');
      }
      // The victim directory itself survived — `fs.rm(recursive, force)` never ran.
      expect((await fs.readdir(victimDir)).sort()).toEqual(['precious.txt']);
    });

    it('validate and restore REFUSE them without reading outside the root', async () => {
      /**
       * The victim directory is made to LOOK like a perfectly valid archive —
       * a complete manifest, carrying the archive declaration, that would pass
       * integrity. So these refusals can only come from containment: without it,
       * `validate('../victim')` returns valid and `restore` proceeds.
       */
      await fs.writeFile(
        join(victimDir, 'manifest.json'),
        JSON.stringify({
          id: 'planted',
          createdAt: '2020-01-01T00:00:00.000Z',
          appVersion: '1.0.0',
          dataVersion: 1,
          trigger: 'manual',
          entries: [],
          archive: {
            scope: 'MULTI_TENANT_INSTALL',
            tenants: 'ALL',
            authority: 'PLATFORM_OPERATOR',
            restoration: 'ALL_TENANTS_AT_ONCE',
            declaration: 'local-backup-archive',
          },
        }),
      );
      for (const [label, id] of TRAVERSALS()) {
        const validation = await manager().validate(id);
        expect(validation.valid, label).toBe(false);
        const result = await manager().restore(id, undefined, { ...ACK });
        expect(result.ok, label).toBe(false);
        expect(result.safetyBackupId, label).toBeNull();
      }
      expect(await fs.readFile(victimFile, 'utf8')).toBe('DO-NOT-TOUCH');
    });

    /**
     * THE CASE A STRING CHECK CANNOT SEE. `escape` is a legal id by every
     * character rule; the directory it names is a symlink out of the root. Only
     * resolving the REAL path catches it.
     */
    it('a symlinked archive directory is refused, and its target survives', async () => {
      await fs.symlink(victimDir, join(backupsDir, 'escape'), 'dir');
      expect(isSafeArchiveId('escape')).toBe(true); // the charset says yes…
      expect(BackupIdRequest.safeParse({ id: 'escape' }).success).toBe(true);

      // …and the real-path containment check says no.
      expect(await manager().delete('escape')).toBe(false);
      expect((await manager().validate('escape')).valid).toBe(false);
      const result = await manager().restore('escape', undefined, { ...ACK });
      expect(result.ok).toBe(false);
      expect(result.detail).toMatch(/escapes the backups directory/);

      expect(await fs.readFile(victimFile, 'utf8')).toBe('DO-NOT-TOUCH');
      // The symlink itself is untouched too: we refused, we did not "clean up".
      expect(await fs.readdir(backupsDir)).toContain('escape');
    });

    it('a symlinked directory is not offered by list() either', async () => {
      await fs.symlink(victimDir, join(backupsDir, 'escape'), 'dir');
      await fs.writeFile(join(victimDir, 'manifest.json'), JSON.stringify({ id: 'escape', createdAt: '2020-01-01T00:00:00.000Z', appVersion: '1', dataVersion: 1, trigger: 'manual', entries: [] }));
      expect((await manager().list()).map((b) => b.id)).not.toContain('escape');
    });
  });

  /* ── NEW-M6: planted manifests ────────────────────────────────────── */

  describe('a planted manifest cannot turn a restore into an arbitrary write', () => {
    async function plant(entries: unknown[]): Promise<string> {
      const info = await manager().create('manual', ['registry']);
      const manifestPath = join(backupsDir, info.id, 'manifest.json');
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as StoredBackupManifest;
      await fs.writeFile(
        manifestPath,
        JSON.stringify({ ...manifest, entries }, null, 2),
      );
      return info.id;
    }

    it('REFUSES an entry whose relativePath escapes, leaving the outside file intact', async () => {
      const id = await plant([
        {
          domain: 'registry',
          relativePath: '../../../victim/precious.txt',
          sizeBytes: 8,
          sha256: 'f'.repeat(64),
        },
      ]);
      const result = await manager(() => 1_700_000_800_000).restore(id, ['registry'], { ...ACK });
      expect(result.ok).toBe(false);
      expect(await fs.readFile(victimFile, 'utf8')).toBe('DO-NOT-TOUCH');
      expect(result.safetyBackupId).toBeNull();
    });

    it('REFUSES an absolute relativePath', async () => {
      const id = await plant([
        { domain: 'registry', relativePath: victimFile, sizeBytes: 8, sha256: 'f'.repeat(64) },
      ]);
      const result = await manager(() => 1_700_000_810_000).restore(id, ['registry'], { ...ACK });
      expect(result.ok).toBe(false);
      expect(await fs.readFile(victimFile, 'utf8')).toBe('DO-NOT-TOUCH');
    });

    /**
     * The harder case: an entry that is REALLY THERE, hashes correctly, and stays
     * inside both roots — but names a file the store-path registry does not cover
     * for its domain. Containment alone allows it; that is why the coverage check
     * exists. `settings-injected.json` stands in for any path inside userData
     * that a backup has no business carrying.
     */
    it('REFUSES an in-archive path the store-path registry does not cover for that domain', async () => {
      const info = await manager().create('manual', ['registry']);
      const archiveData = join(backupsDir, info.id, 'data');
      await fs.writeFile(join(archiveData, 'settings-injected.json'), 'PWNED');
      const { createHash } = await import('node:crypto');
      const sha = createHash('sha256').update('PWNED').digest('hex');
      const manifestPath = join(backupsDir, info.id, 'manifest.json');
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as StoredBackupManifest;
      await fs.writeFile(
        manifestPath,
        JSON.stringify({
          ...manifest,
          entries: [
            {
              domain: 'registry',
              relativePath: 'settings-injected.json',
              sizeBytes: 5,
              sha256: sha,
            },
          ],
        }),
      );

      // Integrity passes — the file is there and the hash matches. Coverage does not.
      expect((await manager().validate(info.id)).valid).toBe(true);
      const result = await manager(() => 1_700_000_820_000).restore(info.id, ['registry'], {
        ...ACK,
      });
      expect(result.ok).toBe(false);
      expect(result.detail).toMatch(/not a path backup covers for domain "registry"/);
      await expect(fs.access(join(dataDir, 'settings-injected.json'))).rejects.toThrow();
      expect(result.safetyBackupId).toBeNull();
    });

    it('still restores the paths the registry DOES cover — coverage is not a blanket refusal', async () => {
      await fs.mkdir(join(dataDir, 'timeline'), { recursive: true });
      await fs.writeFile(join(dataDir, 'timeline', 'part-1.ndjson'), 'EVENT');
      await fs.writeFile(join(dataDir, 'enterprise-module-finance.json'), '{"records":[1]}');
      const info = await manager().create('manual', ['timeline', 'business']);
      await fs.writeFile(join(dataDir, 'timeline', 'part-1.ndjson'), 'GONE');
      await fs.writeFile(join(dataDir, 'enterprise-module-finance.json'), '{}');

      const result = await manager(() => 1_700_000_830_000).restore(info.id, [
        'timeline',
        'business',
      ], { ...ACK });
      expect(result.detail).toBeNull();
      expect(result.ok).toBe(true);
      // A directory domain and a PREFIX domain both come back.
      expect(await fs.readFile(join(dataDir, 'timeline', 'part-1.ndjson'), 'utf8')).toBe('EVENT');
      expect(await fs.readFile(join(dataDir, 'enterprise-module-finance.json'), 'utf8')).toContain(
        '"records"',
      );
    });
  });
});
