/**
 * A CHANNEL MAY NOT EXPOSE A RESOURCE ON THE WRONG AUTHORITY AXIS.
 *
 * P13C ROUND 9 — F20 (the executive-memory family was public, including its
 * destructive writes), F21 (`aiConfig:migrate` was public over an install-wide
 * resource) and F4 (`registry:setFlags` is a public write).
 *
 * WHAT THIS SUITE ASSERTS, AND WHY IT IS NOT A STRING TEST
 *
 * It would be trivial — and worthless — to assert that a map contains the string
 * `'cloud:operate'`. The property that matters is the AXIS:
 *
 *   - an INSTALL-GLOBAL resource cannot be reached with an ORGANIZATION
 *     permission, so an Owner holding EVERY organization permission there is
 *     (`ALL_ENTERPRISE_PERMISSIONS` minus the platform-only ones — asserted to be
 *     a large set, so the test cannot pass on an empty array) is REFUSED, while an
 *     install-level platform operator is ALLOWED;
 *   - a TENANT resource is the mirror image: the organization Owner is ALLOWED and
 *     the platform operator, who is a member of nothing, is REFUSED. That pair is
 *     what proves the classification was derived per-resource rather than by the
 *     heuristic "sensitive ⇒ platform".
 *
 * Every gate assertion runs the REAL enforcement path — `runSecureHandler` from
 * the secure bridge, with `createAuthorize` from the enterprise gate — so a test
 * passes only if the channel would actually refuse the call at runtime, and the
 * handler's own invocation counter proves it never ran.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

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

import {
  ALL_ENTERPRISE_PERMISSIONS,
  EmptyRequest,
  IpcChannel,
  RegistrySetFlagsRequest,
  RUNTIME_INVOKABLE_CHANNELS,
  isPlatformOnlyPermission,
} from '@neuropause/shared';
import type {
  EnterprisePermission,
  IpcChannelName,
  MemoryViewer,
  OrgRole,
  OrgUser,
} from '@neuropause/shared';
import type { AnySecureHandlerDef, SecureHandlerDef } from '../ipc/secureBridge';
import { runSecureHandler } from '../ipc/secureBridge';
import { createAuthorize } from '../enterprise/authzGate';
import { BUILT_IN_ROLE_SPECS } from '../enterprise/org/seed';
import { PUBLIC_CHANNELS, RUNTIME_CHANNEL_PERMISSIONS } from '../ipc/runtimeAuthz';
import {
  MEMORY_CHANNEL_AUTHORITY,
  MEMORY_WRITE_CHANNELS,
  withMemoryAuthz,
} from '../memory/memoryAuthzGate';
import { AI_CHANNEL_AUTHORITY, AI_WRITE_CHANNELS, withAiAuthz } from '../ai/aiAuthzGate';
import { MemoryStore } from '../memory/memoryStore';
import { registry, type RegistryEntry } from '../registry/registry';

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

/** Build the live `authorize` the secure bridge calls, for one actor. */
function authorizeFor(input: {
  email: string;
  orgId: string;
  permissions: readonly EnterprisePermission[];
  /** Install-level operators. Nothing about this is keyed on an organization. */
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
  authorizeFor({
    email: OPERATOR,
    orgId: 'org-none',
    permissions: [],
    operators: [OPERATOR],
  });

/* ── the channel under test, stamped by its real family gate ───────────── */

interface Probe {
  def: AnySecureHandlerDef;
  ran: () => number;
}

/** Put a channel through the production gate and keep hold of whether it ran. */
function probe(channel: IpcChannelName, family: 'memory' | 'ai'): Probe {
  let ran = 0;
  const raw = {
    channel,
    schema: EmptyRequest,
    handler: () => {
      ran += 1;
      return { ok: true };
    },
  } as unknown as SecureHandlerDef;
  const [stamped] = family === 'memory' ? withMemoryAuthz([raw]) : withAiAuthz([raw]);
  return { def: stamped as unknown as AnySecureHandlerDef, ran: () => ran };
}

/** Invoke through the REAL bridge core: auth gate → RBAC → schema → handler. */
async function invoke(
  p: Probe,
  actor: { authorize?: (permission: EnterprisePermission) => void; authenticated?: boolean } = {},
): Promise<unknown> {
  return runSecureHandler(
    p.def,
    {},
    {
      isAuthenticated: () => actor.authenticated ?? true,
      authorize: actor.authorize,
    },
  );
}

/* ── the two family maps, as data the tests can iterate ────────────────── */

const MEMORY_PREFIX = 'memory:';
const AI_CONFIG_PREFIXES = ['aiConfig:', 'ai:config.', 'ai:routing.'];

const MEMORY_FAMILY = RUNTIME_INVOKABLE_CHANNELS.filter((c) => c.startsWith(MEMORY_PREFIX));
const AI_CONFIG_FAMILY = RUNTIME_INVOKABLE_CHANNELS.filter((c) =>
  AI_CONFIG_PREFIXES.some((p) => c.startsWith(p)),
);

/* ═══════════════════════════════════════════════════════════════════════
 * F21 — the AI configuration is INSTALL-GLOBAL, so the authority must be too
 * ═══════════════════════════════════════════════════════════════════════ */

describe('F21 — aiConfig:migrate operates on an install-global resource', () => {
  it('the organization-owner permission set is large, so the refusals below mean something', () => {
    // Guard against the failure mode where every assertion passes because the
    // "every organization permission" array is empty or tiny.
    expect(ORG_OWNER_PERMISSIONS.length).toBeGreaterThan(30);
    expect(ORG_OWNER_PERMISSIONS).toContain('org:manage');
    expect(ORG_OWNER_PERMISSIONS).toContain('cloud:manage');
    expect(ORG_OWNER_PERMISSIONS).toContain('operations:manage');
    // …and it is exactly what a built-in Owner role gets, minus the platform-only set.
    const ownerRole = BUILT_IN_ROLE_SPECS.find((r) => r.key === 'owner')!;
    expect([...ownerRole.permissions]).toEqual([...ORG_OWNER_PERMISSIONS]);
    expect(ORG_OWNER_PERMISSIONS).not.toContain('cloud:operate');
  });

  it('is no longer public: the channel demands a permission and authentication', () => {
    expect(AI_CHANNEL_AUTHORITY[IpcChannel.AiConfigMigrate]).toBe('cloud:operate');
    const p = probe(IpcChannel.AiConfigMigrate, 'ai');
    expect(p.def.permission).toBe('cloud:operate');
    expect(p.def.requireAuth).toBe(true);
    expect(p.def.audit).toBe(true);
  });

  it('an Owner holding EVERY organization permission is REFUSED, and the handler never runs', async () => {
    const p = probe(IpcChannel.AiConfigMigrate, 'ai');
    await expect(invoke(p, { authorize: orgOwnerOfAlpha() })).rejects.toThrow(/not authorized/i);
    expect(p.ran()).toBe(0);
  });

  it('a SECOND organization’s Owner is refused identically — switching orgs confers nothing', async () => {
    const p = probe(IpcChannel.AiConfigMigrate, 'ai');
    await expect(invoke(p, { authorize: orgOwnerOfBravo() })).rejects.toThrow(/not authorized/i);
    expect(p.ran()).toBe(0);
  });

  it('an install-level platform operator CAN — the gate is not simply “always no”', async () => {
    const p = probe(IpcChannel.AiConfigMigrate, 'ai');
    await expect(invoke(p, { authorize: platformOperator() })).resolves.toEqual({ ok: true });
    expect(p.ran()).toBe(1);
  });

  it('an unauthenticated caller is refused before authorization is even consulted', async () => {
    const p = probe(IpcChannel.AiConfigMigrate, 'ai');
    await expect(
      invoke(p, { authenticated: false, authorize: platformOperator() }),
    ).rejects.toThrow(/sign in/i);
    expect(p.ran()).toBe(0);
  });

  it('every write onto the install-wide AI config carries the SAME lock', () => {
    // One resource, one lock. `migrate` was the odd one out; this is the check
    // that keeps it that way for the whole family rather than for one channel.
    for (const channel of [
      IpcChannel.AiConfigSetProvider,
      IpcChannel.AiConfigSetModel,
      IpcChannel.AiConfigSetCredential,
      IpcChannel.AiConfigClearCredential,
      IpcChannel.AiConfigSetMode,
      IpcChannel.AiConfigSetExternalConsent,
      IpcChannel.AiConfigResetToEnv,
      IpcChannel.AiConfigMigrate,
    ]) {
      expect(AI_CHANNEL_AUTHORITY[channel], `${channel} must require install authority`).toBe(
        'cloud:operate',
      );
      const p = probe(channel, 'ai');
      expect(p.def.permission).toBe('cloud:operate');
      expect(p.def.requireAuth).toBe(true);
    }
  });

  it('an organization Owner is refused on EVERY one of those writes, not just migrate', async () => {
    for (const channel of AI_WRITE_CHANNELS) {
      if (AI_CHANNEL_AUTHORITY[channel] !== 'cloud:operate') continue;
      const p = probe(channel, 'ai');
      await expect(
        invoke(p, { authorize: orgOwnerOfAlpha() }),
        `${channel} must refuse an org owner`,
      ).rejects.toThrow(/not authorized/i);
      expect(p.ran()).toBe(0);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * F20 — the executive-memory family reaches a TENANT store
 * ═══════════════════════════════════════════════════════════════════════ */

describe('F20 — the executive memory channels are destructive writes on a tenant store', () => {
  const DESTRUCTIVE = [
    IpcChannel.ExecMemoryForget,
    IpcChannel.ExecMemoryPin,
    IpcChannel.ExecMemoryResolve,
  ] as const;

  it('each one now requires a permission — the same one its sibling memory:forget requires', () => {
    expect(RUNTIME_CHANNEL_PERMISSIONS[IpcChannel.MemoryForget]).toBe('operations:manage');
    for (const channel of DESTRUCTIVE) {
      expect(MEMORY_CHANNEL_AUTHORITY[channel], `${channel} must not be public`).not.toBe('PUBLIC');
      expect(MEMORY_CHANNEL_AUTHORITY[channel]).toBe('operations:manage');
      const p = probe(channel, 'memory');
      expect(p.def.permission).toBe('operations:manage');
      expect(p.def.requireAuth).toBe(true);
      // A destructive call that leaves no trace is a second finding.
      expect(p.def.audit).toBe(true);
    }
  });

  it('an unauthenticated renderer message cannot forget, pin or resolve a memory', async () => {
    for (const channel of DESTRUCTIVE) {
      const p = probe(channel, 'memory');
      await expect(
        invoke(p, { authenticated: false, authorize: orgOwnerOfAlpha() }),
        `${channel} must refuse an unauthenticated caller`,
      ).rejects.toThrow(/sign in/i);
      expect(p.ran()).toBe(0);
    }
  });

  it('a read-only Member is refused — the lock is the write lock, not the read lock', async () => {
    for (const channel of DESTRUCTIVE) {
      const p = probe(channel, 'memory');
      await expect(invoke(p, { authorize: orgMember() }), `${channel}`).rejects.toThrow(
        /not authorized/i,
      );
      expect(p.ran()).toBe(0);
    }
    // The same Member can still READ memory, so the family was not simply closed.
    const read = probe(IpcChannel.ExecMemorySearch, 'memory');
    await expect(invoke(read, { authorize: orgMember() })).resolves.toEqual({ ok: true });
  });

  it('the organization Owner CAN — memory is tenant data, so the org axis is the right one', async () => {
    for (const channel of DESTRUCTIVE) {
      const p = probe(channel, 'memory');
      await expect(invoke(p, { authorize: orgOwnerOfAlpha() }), `${channel}`).resolves.toEqual({
        ok: true,
      });
      expect(p.ran()).toBe(1);
    }
  });

  /**
   * THE AXIS TEST, IN THE OTHER DIRECTION.
   *
   * If the classification had been done by the heuristic "this looks sensitive,
   * give it the strongest permission", these channels would have landed on
   * `cloud:operate` and this test would fail. Memory belongs to a tenant, and a
   * platform operator is a member of no tenant, so they hold nothing here.
   */
  it('a platform operator CANNOT delete a tenant’s memories — platform ≠ superuser', async () => {
    const p = probe(IpcChannel.ExecMemoryForget, 'memory');
    // Refused for holding no organization permission — the operator identity buys
    // nothing here, because `operations:manage` is not platform-only and this
    // resource is not the platform's.
    await expect(invoke(p, { authorize: platformOperator() })).rejects.toThrow(
      /not authorized|no organization member/i,
    );
    expect(p.ran()).toBe(0);
    // The same identity IS enough on the install-global resource, which is what
    // makes this a test of the AXIS rather than of one permission string.
    const install = probe(IpcChannel.AiConfigMigrate, 'ai');
    await expect(invoke(install, { authorize: platformOperator() })).resolves.toEqual({ ok: true });
  });

  it('every write channel in the memory family is gated, none of them public', () => {
    for (const channel of MEMORY_WRITE_CHANNELS) {
      expect(MEMORY_CHANNEL_AUTHORITY[channel], `${channel} writes and must not be public`).toBe(
        'operations:manage',
      );
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * Reads that legitimately stay open, and reads that moved
 * ═══════════════════════════════════════════════════════════════════════ */

describe('the open surface did not shrink by accident', () => {
  const STILL_PUBLIC: Array<[IpcChannelName, 'memory' | 'ai']> = [
    [IpcChannel.MemoryCounts, 'memory'],
    [IpcChannel.AiConfigGet, 'ai'],
    [IpcChannel.AiConfigHealth, 'ai'],
    [IpcChannel.AiConfigDetectOllama, 'ai'],
    [IpcChannel.AiConfigMigrationStatus, 'ai'],
    [IpcChannel.AiConfigTest, 'ai'],
    [IpcChannel.AiRoutingStatus, 'ai'],
    [IpcChannel.FounderSuggestions, 'ai'],
    [IpcChannel.EngineeringAnalyze, 'ai'],
  ];

  it('the reads that were public are still public, and still run without a session', async () => {
    for (const [channel, family] of STILL_PUBLIC) {
      const map = family === 'memory' ? MEMORY_CHANNEL_AUTHORITY : AI_CHANNEL_AUTHORITY;
      expect(map[channel], `${channel} must stay open`).toBe('PUBLIC');
      const p = probe(channel, family);
      expect(p.def.permission).toBeUndefined();
      expect(p.def.requireAuth).toBeUndefined();
      await expect(invoke(p, { authenticated: false })).resolves.toEqual({ ok: true });
      expect(p.ran()).toBe(1);
      // And they are still on the vetted allowlist, so nothing moved behind its back.
      expect(PUBLIC_CHANNELS.has(channel), `${channel} left the allowlist`).toBe(true);
    }
  });

  it('the content reads that MOVED are readable by an ordinary Member', async () => {
    // `memory:get`, `memory:exec-search` and `founder:ask-v2` were public and now
    // require `intelligence:read` — the scope every built-in role above AI worker
    // holds. Moving them must not have made the product unusable for a Member.
    for (const [channel, family] of [
      [IpcChannel.MemoryGet, 'memory'],
      [IpcChannel.ExecMemorySearch, 'memory'],
      [IpcChannel.FounderAskV2, 'ai'],
    ] as Array<[IpcChannelName, 'memory' | 'ai']>) {
      const map = family === 'memory' ? MEMORY_CHANNEL_AUTHORITY : AI_CHANNEL_AUTHORITY;
      expect(map[channel]).toBe('intelligence:read');
      const p = probe(channel, family);
      await expect(invoke(p, { authorize: orgMember() }), `${channel}`).resolves.toEqual({
        ok: true,
      });
      // …but not by an unauthenticated caller, which is the point of the move.
      const anon = probe(channel, family);
      await expect(invoke(anon, { authenticated: false })).rejects.toThrow(/sign in/i);
      expect(anon.ran()).toBe(0);
    }
  });

  /**
   * `PUBLIC_CHANNELS` in `ipc/runtimeAuthz.ts` still lists the channels this
   * change gated. That list is an ALLOWLIST CONSULTED ONLY FOR CHANNELS THAT
   * ENDED UP UNGATED (`assertAllChannelsClassified`), so a stale row grants
   * nothing — but it is misleading documentation and the rows should be deleted
   * by whoever owns that file. This test pins the fact that matters: the stale
   * row does not make the channel reachable.
   */
  it('a stale PUBLIC_CHANNELS row does not un-gate a channel gated at its handler', async () => {
    const staleRows = [
      IpcChannel.ExecMemoryForget,
      IpcChannel.ExecMemoryPin,
      IpcChannel.ExecMemoryResolve,
      IpcChannel.ExecMemorySearch,
      IpcChannel.MemoryGet,
      IpcChannel.AiConfigMigrate,
      IpcChannel.FounderAskV2,
    ] as const;
    for (const channel of staleRows) {
      const family = channel.startsWith('memory:') ? 'memory' : 'ai';
      const p = probe(channel, family);
      expect(p.def.permission, `${channel} must carry a permission`).toBeDefined();
      await expect(invoke(p, { authenticated: false }), `${channel}`).rejects.toThrow(/sign in/i);
      expect(p.ran()).toBe(0);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * The gates themselves: complete, in agreement, and fatal when they are not
 * ═══════════════════════════════════════════════════════════════════════ */

describe('the family gates cannot ship an unclassified channel', () => {
  it('every invokable memory:* channel has a row', () => {
    expect(MEMORY_FAMILY.length).toBeGreaterThanOrEqual(13);
    const missing = MEMORY_FAMILY.filter((c) => MEMORY_CHANNEL_AUTHORITY[c] === undefined);
    expect(missing, `unclassified memory channels: ${missing.join(', ')}`).toEqual([]);
  });

  it('every invokable aiConfig:* / ai:config.* / ai:routing.* channel has a row', () => {
    expect(AI_CONFIG_FAMILY.length).toBeGreaterThanOrEqual(14);
    const missing = AI_CONFIG_FAMILY.filter((c) => AI_CHANNEL_AUTHORITY[c] === undefined);
    expect(missing, `unclassified AI channels: ${missing.join(', ')}`).toEqual([]);
  });

  it('an unclassified channel THROWS at composition rather than shipping open', () => {
    const rogue = { channel: IpcChannel.RuntimeList, schema: EmptyRequest, handler: () => null };
    expect(() => withMemoryAuthz([rogue as unknown as SecureHandlerDef])).toThrow(
      /no authority classification/i,
    );
    expect(() => withAiAuthz([rogue as unknown as SecureHandlerDef])).toThrow(
      /no authority classification/i,
    );
  });

  it('a family row that disagrees with the central runtime table is fatal, not silent', () => {
    // The two tables both classify part of these families. A def gated by the
    // family gate is skipped by the runtime gate, so disagreement would be won
    // silently by whichever ran first. It throws instead.
    for (const [channel, authority] of Object.entries(MEMORY_CHANNEL_AUTHORITY)) {
      const central = RUNTIME_CHANNEL_PERMISSIONS[channel as IpcChannelName];
      if (central === undefined || authority === 'PUBLIC') continue;
      expect(authority, `${channel} disagrees with ipc/runtimeAuthz.ts`).toBe(central);
    }
    for (const [channel, authority] of Object.entries(AI_CHANNEL_AUTHORITY)) {
      const central = RUNTIME_CHANNEL_PERMISSIONS[channel as IpcChannelName];
      if (central === undefined || authority === 'PUBLIC') continue;
      expect(authority, `${channel} disagrees with ipc/runtimeAuthz.ts`).toBe(central);
    }
  });

  /**
   * STRUCTURAL, and flagged as such: the composition roots build their handler
   * arrays inside async factories that construct half the app, so this asserts
   * that each root passes its array through its gate rather than executing them.
   */
  it('the three composition roots pass their handlers through their gate', () => {
    const MAIN = join(fileURLToPath(new URL('.', import.meta.url)), '..');
    const src = (rel: string): string => readFileSync(join(MAIN, rel), 'utf8');
    expect(src('memory/index.ts')).toContain('withMemoryAuthz(rawHandlers)');
    expect(src('ai/aiConfigIpc.ts')).toContain('withAiAuthz([');
    expect(src('ai/index.ts')).toContain('withAiAuthz([');
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * The store behind the family really is per tenant: A/B/C over one file
 * ═══════════════════════════════════════════════════════════════════════ */

describe('three tenants, one memory file: 3 / 7 / 11', () => {
  const NOW = '2026-08-11T09:00:00.000Z';
  const A: MemoryViewer = { tenantId: 'org-a', workspaceId: 'ws-a', userId: 'ana@a.example' };
  const B: MemoryViewer = { tenantId: 'org-b', workspaceId: 'ws-b', userId: 'bo@b.example' };
  const C: MemoryViewer = { tenantId: 'org-c', workspaceId: 'ws-c', userId: 'cy@c.example' };

  let dir: string;
  let store: MemoryStore;
  /** Mutating this IS the tenant switch — the same operation the app performs. */
  let viewer: MemoryViewer | null;
  let ids: Record<'a' | 'b' | 'c', string[]>;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-channel-authority-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    store = new MemoryStore(join(dir, 'memory.json'));
    store.bindViewer(() => viewer);
    await store.load();

    const write = (who: MemoryViewer, n: number, label: string): string[] => {
      viewer = who;
      return Array.from({ length: n }, (_, i) => {
        const item = store.remember(
          {
            kind: 'note',
            title: `${label} note ${i}`,
            content: `Postgres migration detail ${i} for ${label}`,
          },
          NOW,
        );
        return item.id;
      });
    };

    ids = { a: write(A, 3, 'alpha'), b: write(B, 7, 'bravo'), c: write(C, 11, 'charlie') };
  });

  afterEach(async () => {
    await store.flush();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('each tenant counts only its own rows, out of 21 in one file', () => {
    expect(ids.a).toHaveLength(3);
    expect(ids.b).toHaveLength(7);
    expect(ids.c).toHaveLength(11);
    viewer = A;
    expect(store.counts().total).toBe(3);
    viewer = B;
    expect(store.counts().total).toBe(7);
    viewer = C;
    expect(store.counts().total).toBe(11);
  });

  it('each tenant recalls only its own rows, searching the others’ exact words', () => {
    viewer = A;
    expect(store.recall({ text: 'postgres', limit: 50 }).hits).toHaveLength(3);
    viewer = B;
    const bHits = store.recall({ text: 'postgres', limit: 50 }).hits.map((h) => h.item.id);
    expect(bHits).toHaveLength(7);
    expect(bHits.some((id) => ids.a.includes(id) || ids.c.includes(id))).toBe(false);
  });

  it('A cannot FORGET B’s or C’s rows, and B cannot forget A’s', () => {
    viewer = A;
    expect(store.forget([...ids.b, ...ids.c])).toBe(0);
    viewer = B;
    expect(store.forget(ids.a)).toBe(0);
    // Nothing was destroyed on the way past.
    viewer = B;
    expect(store.counts().total).toBe(7);
    viewer = C;
    expect(store.counts().total).toBe(11);
    viewer = A;
    expect(store.counts().total).toBe(3);
    // …and A can still forget its OWN, so the refusal is ownership, not paralysis.
    viewer = A;
    expect(store.forget([ids.a[0]])).toBe(1);
    expect(store.counts().total).toBe(2);
  });

  it('A cannot PIN B’s rows (the exec-pin path), and the row stays unpinned for B', () => {
    viewer = A;
    expect(store.update(ids.b[0], { metadata: { pinned: true } }, NOW)).toBeNull();
    viewer = B;
    expect(store.get(ids.b[0])?.metadata.pinned).toBeUndefined();
    // B pinning B's own row works.
    expect(store.update(ids.b[0], { metadata: { pinned: true } }, NOW)?.metadata.pinned).toBe(true);
  });

  it('A cannot RESOLVE C’s decision rows, and C cannot resolve A’s', () => {
    viewer = A;
    expect(store.update(ids.c[0], { metadata: { status: 'resolved' } }, NOW)).toBeNull();
    viewer = C;
    expect(store.update(ids.a[0], { metadata: { status: 'resolved' } }, NOW)).toBeNull();
  });

  it('the EXPORT source (backfill / allItems) hands each tenant only its own rows', () => {
    viewer = A;
    const aExport = store.allItems();
    expect(aExport).toHaveLength(3);
    expect(aExport.every((it) => ids.a.includes(it.id))).toBe(true);
    expect(JSON.stringify(aExport)).not.toContain('bravo');
    expect(JSON.stringify(aExport)).not.toContain('charlie');

    viewer = C;
    const cExport = store.allItems();
    expect(cExport).toHaveLength(11);
    expect(JSON.stringify(cExport)).not.toContain('alpha');
  });

  it('an UNRESOLVED viewer reads nothing and destroys nothing', () => {
    viewer = null;
    expect(store.allItems()).toEqual([]);
    expect(store.forget([...ids.a, ...ids.b, ...ids.c])).toBe(0);
    viewer = C;
    expect(store.counts().total).toBe(11);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * F4 — registry:setFlags is a public write; what can it actually reach?
 * ═══════════════════════════════════════════════════════════════════════ */

describe('F4 — registry:setFlags cannot mutate a security-sensitive flag', () => {
  const SLUG = 'com.example.app';

  function entry(): RegistryEntry {
    return {
      slug: SLUG,
      name: 'Example',
      appType: 'app' as RegistryEntry['appType'],
      installedVersion: '1.0.0',
      channel: 'stable',
      installLocation: '/apps/example',
      packageHash: 'sha256-original',
      signatureKeyId: 'key-1',
      hasSignature: true,
      previousVersion: null,
      previousPackageHash: null,
      grantedPermissions: ['filesystem_read'],
      permissionGrants: [],
      launchCount: 0,
      lastLaunchedAt: null,
      installedAt: '2026-01-01T00:00:00.000Z',
      lastUpdatedAt: null,
      runtimeStatus: 'stopped' as RegistryEntry['runtimeStatus'],
      healthStatus: 'unknown' as RegistryEntry['healthStatus'],
      diskUsageBytes: 1,
      pinned: false,
      favorite: false,
      config: { apiBase: 'https://original.example' },
      usage: { launches: 0, totalActiveMs: 0, lastSessionAt: null },
    };
  }

  beforeEach(async () => {
    mockState.userDataDir = await fs.mkdtemp(join(tmpdir(), 'np-registry-'));
    await registry.load();
    await registry.upsert(entry());
  });

  afterEach(async () => {
    await fs.rm(mockState.userDataDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it('the wire schema strips every field but the two display flags', () => {
    const parsed = RegistrySetFlagsRequest.parse({
      slug: SLUG,
      pinned: true,
      favorite: true,
      grantedPermissions: ['filesystem_write', 'shell_execution'],
      packageHash: 'sha256-attacker',
      signatureKeyId: 'key-attacker',
      hasSignature: false,
      installLocation: '/tmp/evil',
      config: { apiBase: 'https://attacker.example' },
      runtimeStatus: 'running',
    });
    expect(Object.keys(parsed).sort()).toEqual(['favorite', 'pinned', 'slug']);
  });

  it('the store method itself ignores anything that is not pinned/favorite', async () => {
    // Bypass the schema entirely — this is the "someone widens the caller" case.
    await registry.setFlags(SLUG, {
      pinned: true,
      favorite: true,
      grantedPermissions: ['filesystem_write', 'network', 'shell_execution'],
      permissionGrants: [{ permission: 'shell_execution', state: 'granted' }],
      packageHash: 'sha256-attacker',
      signatureKeyId: 'key-attacker',
      hasSignature: false,
      installLocation: '/tmp/evil',
      runtimeStatus: 'running',
      healthStatus: 'healthy',
      config: { apiBase: 'https://attacker.example' },
      installedVersion: '99.0.0',
    } as unknown as { pinned?: boolean; favorite?: boolean });

    const after = registry.getRaw(SLUG)!;
    expect(after.pinned).toBe(true);
    expect(after.favorite).toBe(true);
    // Everything a compromise would want is untouched.
    expect(after.grantedPermissions).toEqual(['filesystem_read']);
    expect(after.permissionGrants).toEqual([]);
    expect(after.packageHash).toBe('sha256-original');
    expect(after.signatureKeyId).toBe('key-1');
    expect(after.hasSignature).toBe(true);
    expect(after.installLocation).toBe('/apps/example');
    expect(after.runtimeStatus).toBe('stopped');
    expect(after.healthStatus).toBe('unknown');
    expect(after.config).toEqual({ apiBase: 'https://original.example' });
    expect(after.installedVersion).toBe('1.0.0');
  });

  it('a truthy non-boolean cannot land in the file, and an unknown slug creates nothing', async () => {
    await registry.setFlags(SLUG, { pinned: 'yes' as unknown as boolean });
    expect(registry.getRaw(SLUG)!.pinned).toBe(false);
    expect(await registry.setFlags('com.example.absent', { pinned: true })).toBeNull();
    expect(registry.getRaw('com.example.absent')).toBeNull();
  });

  it('the write keeps the file’s integrity checksum consistent', async () => {
    await registry.setFlags(SLUG, { favorite: true });
    // A fresh load re-verifies the checksum over the entries it reads back.
    await registry.load();
    expect(registry.isIntegrityOk()).toBe(true);
    expect(registry.getRaw(SLUG)!.favorite).toBe(true);
  });
});
