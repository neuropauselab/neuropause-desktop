/**
 * Runtime-core RBAC classification invariant + annotator tests.
 *
 * Locks four things:
 *  a. `withRuntimeAuthz` stamps permission + requireAuth and THROWS on an
 *     unclassified channel (the ship-time guard, mirroring withEnterpriseAuthz).
 *  b. `RUNTIME_CHANNEL_PERMISSIONS` is a clean map: every key is a real invokable
 *     runtime channel, every value a real permission, and no channel is both
 *     gated AND public.
 *  c. `assertAllChannelsClassified` returns [] when the whole invokable surface
 *     is accounted for, and returns exactly the offender when one is missing.
 *  d. Completeness: the union of {gated} ∪ {public} ∪ {sibling authz namespaces}
 *     covers EVERY invokable runtime channel — so the startup invariant in
 *     runtimeCore can never spuriously throw for a channel we forgot to account
 *     for. This is the CI safety net for the fail-closed startup check.
 */
import { describe, expect, it } from 'vitest';
import {
  ALL_ENTERPRISE_PERMISSIONS,
  IpcChannel,
  RUNTIME_INVOKABLE_CHANNELS,
  type IpcChannelName,
} from '@neuropause/shared';
import {
  RUNTIME_CHANNEL_PERMISSIONS,
  withRuntimeAuthz,
  PUBLIC_CHANNELS,
  assertAllChannelsClassified,
} from './runtimeAuthz';

describe('withRuntimeAuthz', () => {
  it('stamps requireAuth + permission onto each handler, preserving other fields', () => {
    const defs = [
      { channel: IpcChannel.ExecuteRun, schema: {}, handler: () => null, audit: true },
      { channel: IpcChannel.MemoryRecall, schema: {}, handler: () => null },
    ];
    const gated = withRuntimeAuthz(defs);
    expect(gated[0]).toMatchObject({
      channel: IpcChannel.ExecuteRun,
      requireAuth: true,
      permission: 'workforce:operate',
      audit: true, // preserved
    });
    expect(gated[1]).toMatchObject({ requireAuth: true, permission: 'intelligence:read' });
    // does not mutate the input defs
    expect((defs[0] as { requireAuth?: boolean }).requireAuth).toBeUndefined();
  });

  it('throws at composition time for an unclassified channel (ship-time guard)', () => {
    expect(() => withRuntimeAuthz([{ channel: IpcChannel.RuntimeList as IpcChannelName }])).toThrow(
      /no permission classification/,
    );
    // A genuinely-public channel is deliberately NOT in the map, so wrapping it throws.
    expect(() => withRuntimeAuthz([{ channel: IpcChannel.CatalogFeatured as IpcChannelName }])).toThrow(
      /runtimeAuthz/,
    );
  });
});

describe('RUNTIME_CHANNEL_PERMISSIONS map sanity', () => {
  it('maps only real, invokable runtime channels', () => {
    const invokable = new Set<string>(RUNTIME_INVOKABLE_CHANNELS);
    for (const channel of Object.keys(RUNTIME_CHANNEL_PERMISSIONS)) {
      expect(invokable.has(channel), `stale / non-invokable channel: ${channel}`).toBe(true);
    }
  });

  it('maps every channel to a real EnterprisePermission (no invented scopes)', () => {
    const valid = new Set<string>(ALL_ENTERPRISE_PERMISSIONS);
    for (const permission of Object.values(RUNTIME_CHANNEL_PERMISSIONS)) {
      expect(valid.has(permission as string), `invented permission: ${permission}`).toBe(true);
    }
  });

  it('pins the priority + representative classifications', () => {
    // THE priority finding — execute:run re-enters worker/automation execution.
    expect(RUNTIME_CHANNEL_PERMISSIONS[IpcChannel.ExecuteRun]).toBe('workforce:operate');
    expect(RUNTIME_CHANNEL_PERMISSIONS[IpcChannel.ExecuteCancel]).toBe('workforce:operate');
    expect(RUNTIME_CHANNEL_PERMISSIONS[IpcChannel.PluginsInstall]).toBe('marketplace:manage');
    expect(RUNTIME_CHANNEL_PERMISSIONS[IpcChannel.PermsGrant]).toBe('org:manage');
    expect(RUNTIME_CHANNEL_PERMISSIONS[IpcChannel.AutomationRun]).toBe('operations:manage');
    expect(RUNTIME_CHANNEL_PERMISSIONS[IpcChannel.RuntimeLaunch]).toBe('operations:manage');
    expect(RUNTIME_CHANNEL_PERMISSIONS[IpcChannel.MigrationRun]).toBe('org:manage');
    expect(RUNTIME_CHANNEL_PERMISSIONS[IpcChannel.FlagsSetOverride]).toBe('governance:manage');
    // Sensitive reads → intelligence:read.
    expect(RUNTIME_CHANNEL_PERMISSIONS[IpcChannel.MemoryRecall]).toBe('intelligence:read');
    expect(RUNTIME_CHANNEL_PERMISSIONS[IpcChannel.UnifiedQuery]).toBe('intelligence:read');
    expect(RUNTIME_CHANNEL_PERMISSIONS[IpcChannel.FounderAsk]).toBe('intelligence:read');
    expect(RUNTIME_CHANNEL_PERMISSIONS[IpcChannel.ExecutiveCenterSnapshot]).toBe('intelligence:read');
  });

  it('classifies every graph:* read as intelligence:read and the rebuild as a mutation', () => {
    for (const c of [
      IpcChannel.GraphCounts,
      IpcChannel.GraphNode,
      IpcChannel.GraphNodes,
      IpcChannel.GraphNeighbors,
      IpcChannel.GraphSubgraph,
      IpcChannel.GraphPath,
      IpcChannel.GraphHistory,
    ]) {
      expect(RUNTIME_CHANNEL_PERMISSIONS[c]).toBe('intelligence:read');
    }
    // graph:rebuild is a side-effecting rebuild — gated stronger than the read scope.
    expect(RUNTIME_CHANNEL_PERMISSIONS[IpcChannel.GraphRebuild]).toBe('operations:manage');
  });

  it('never gates a channel that is also on the public allowlist (disjoint sets)', () => {
    for (const channel of Object.keys(RUNTIME_CHANNEL_PERMISSIONS)) {
      expect(PUBLIC_CHANNELS.has(channel as IpcChannelName), `channel both gated & public: ${channel}`).toBe(
        false,
      );
    }
  });

  it('references only real invokable channels in the public allowlist', () => {
    const invokable = new Set<string>(RUNTIME_INVOKABLE_CHANNELS);
    for (const channel of PUBLIC_CHANNELS) {
      expect(invokable.has(channel), `stale public channel: ${channel}`).toBe(true);
    }
  });
});

describe('assertAllChannelsClassified', () => {
  // The whole non-public surface, treated as gated (as it is at runtime once every
  // withXAuthz annotator + the runtime gate have run).
  const allNonPublic = RUNTIME_INVOKABLE_CHANNELS.filter((c) => !PUBLIC_CHANNELS.has(c));

  it('returns [] when every channel is either gated or public', () => {
    expect(assertAllChannelsClassified(allNonPublic, PUBLIC_CHANNELS)).toEqual([]);
  });

  it('returns [] for gated ⊇ (runtime map keys + a sample of other authz namespaces)', () => {
    const gated: IpcChannelName[] = [
      ...(Object.keys(RUNTIME_CHANNEL_PERMISSIONS) as IpcChannelName[]),
      // representative sample from the sibling withXAuthz annotators…
      IpcChannel.EnterpriseOrgGet,
      IpcChannel.WorkforceJobRun,
      IpcChannel.CloudCreateTenant,
      IpcChannel.FedInviteOrg,
      IpcChannel.EcosystemKeysCreate,
      IpcChannel.MarketplaceInstall,
      // …plus the rest of the non-public surface so the union is complete.
      ...allNonPublic,
    ];
    expect(assertAllChannelsClassified(gated, PUBLIC_CHANNELS)).toEqual([]);
  });

  it('flags exactly the channel that is neither gated nor public', () => {
    // Drop one privileged channel from the gated set and remove it from public.
    const victim = IpcChannel.ExecuteRun;
    const gated = allNonPublic.filter((c) => c !== victim);
    const offenders = assertAllChannelsClassified(gated, PUBLIC_CHANNELS);
    expect(offenders).toContain(victim);
    expect(offenders).toHaveLength(1);
  });
});

describe('runtime IPC surface completeness (fail-closed startup safety net)', () => {
  // Namespaces whose ENTIRE invokable surface is permission-gated by a sibling
  // withXAuthz annotator / blanket gate (verified against each subsystem).
  const SELF_GATED_PREFIXES = [
    'enterprise:',
    'workforce:',
    'ecosystem:',
    'cloud:',
    'livesync:',
    'fed:',
    'federation:',
    'industry:',
    'strategy:',
    'twin:',
    'fabric:',
    'orchestration:',
    'network:',
    'autonomousops:',
    'commercial:',
    'experience:',
    'intent:',
    'connectors:',
    'infra:',
    'intel:',
    // Phase 6 Stage 6 — the Enterprise Intelligence Layer's read-only cluster:
    // every insight:* handler self-carries requireAuth + intelligence:read
    // (locked by src/main/insight/index.stage6.test.ts).
    'insight:',
    'marketplace:',
    'webhooks:',
    'sandbox:',
    'org:', // cloud-org CRUD — every channel carries requireAuth
  ];
  // Authenticated-but-not-RBAC channels that sit inside otherwise-public namespaces
  // (they carry requireAuth, so they are gated, just not with a static permission).
  const REQUIRE_AUTH_ONLY: IpcChannelName[] = [
    IpcChannel.CatalogBookmarks,
    IpcChannel.CatalogToggleBookmark,
    IpcChannel.CatalogSubmitReview,
    IpcChannel.CatalogRecommendations,
    IpcChannel.CatalogCheckUpdate,
    IpcChannel.NpsInstall,
    IpcChannel.NpsUninstall,
    IpcChannel.NpsUpdate,
    IpcChannel.NpsRepair,
  ];

  it('accounts for every invokable runtime channel (gated | public | sibling-authz)', () => {
    const accounted = new Set<IpcChannelName>([
      ...(Object.keys(RUNTIME_CHANNEL_PERMISSIONS) as IpcChannelName[]),
      ...PUBLIC_CHANNELS,
      ...REQUIRE_AUTH_ONLY,
    ]);
    const unaccounted = RUNTIME_INVOKABLE_CHANNELS.filter(
      (c) => !accounted.has(c) && !SELF_GATED_PREFIXES.some((p) => c.startsWith(p)),
    );
    expect(unaccounted, `unaccounted runtime channels: ${unaccounted.join(', ')}`).toEqual([]);
  });

  it('keeps the runtime map and public allowlist disjoint from the sibling namespaces', () => {
    // Nothing we classify here should belong to a namespace another annotator owns.
    for (const channel of Object.keys(RUNTIME_CHANNEL_PERMISSIONS) as IpcChannelName[]) {
      expect(
        SELF_GATED_PREFIXES.some((p) => channel.startsWith(p)),
        `runtime map steps on sibling namespace: ${channel}`,
      ).toBe(false);
    }
  });
});
