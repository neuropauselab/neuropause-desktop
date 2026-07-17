/**
 * Runtime-core authorization gate — closes the "privileged base/core channel
 * riding on sender-trust alone" gap the IPC audit found.
 *
 * Background: the secure bridge (`ipc/secureBridge.ts`) enforces RBAC only on
 * handler defs that declare a `permission`. A whole class of privileged
 * base/core channels (execute, plugin lifecycle, permission grants, automation
 * mutations, runtime control, memory writes, decision mutations, feature-flag
 * overrides, migration/backup/recovery/support, billing, device registration,
 * supervisor recovery, registry import/backup, package rollback) plus a set of
 * org-intelligence *reads* shipped WITHOUT a `permission` — no `withXAuthz`
 * annotator covered their namespace, so they passed on sender-trust only.
 *
 * This module mirrors the existing annotator pattern (`enterprise/authzGate.ts`,
 * `workforce/authzGate.ts`, `cloud/controlPlane/cloudAuthz.ts`, …):
 *
 *  1. `RUNTIME_CHANNEL_PERMISSIONS` — the single source of truth mapping each
 *     privileged runtime channel to the EXISTING `EnterprisePermission` it now
 *     requires. No new permissions are introduced.
 *  2. `withRuntimeAuthz(defs)` — stamps `requireAuth: true` + `permission` onto
 *     every def, THROWING at composition time if a channel it is handed has no
 *     classification (so a privileged channel can never be silently unguarded).
 *  3. `PUBLIC_CHANNELS` — the vetted allowlist of genuinely-public /
 *     parameterless-safe / local-desktop channels that intentionally remain
 *     ungated (catalog & store reads, local registry reads, `runtime:list` /
 *     `runtime:health`, the system-health snapshot, renderer→main state reports,
 *     and the per-user desktop conveniences).
 *  4. `assertAllChannelsClassified(...)` — the startup invariant: returns every
 *     `RUNTIME_INVOKABLE_CHANNELS` entry that is NEITHER gated NOR public, so the
 *     composition root can fail closed (mirroring the annotators' throw-on-
 *     unclassified philosophy) rather than expose a new channel by omission.
 *
 * Enforcement reuses the secure bridge unchanged: the owner role holds every
 * permission, so single-user installs are unaffected; the gate bites only for
 * multi-user enterprise RBAC.
 */
import { IpcChannel } from '@neuropause/shared';
import type { EnterprisePermission, IpcChannelName } from '@neuropause/shared';
import { RUNTIME_INVOKABLE_CHANNELS } from '@neuropause/shared';

/**
 * Every privileged base/core channel → the EXISTING enterprise permission it
 * requires. Split into privileged WRITES (mutations / side-effecting control)
 * and SENSITIVE READS (surface org intelligence). Uses only permissions already
 * in the shared union — nothing here mints a new scope.
 */
export const RUNTIME_CHANNEL_PERMISSIONS: Partial<Record<IpcChannelName, EnterprisePermission>> = {
  /* ── Privileged writes ──────────────────────────────────────────────── */

  // Execute Engine re-enters worker/automation/decision execution — THE priority
  // finding: `execute:run` can re-drive the workforce runtime, so it takes the
  // same scope as running work directly (`workforce:operate`).
  [IpcChannel.ExecuteRun]: 'workforce:operate',
  [IpcChannel.ExecuteCancel]: 'workforce:operate',

  // Plugin lifecycle (install/enable/disable/reload/update/remove + permission
  // grant/revoke) — installing/altering executable extensions is a marketplace
  // management operation.
  [IpcChannel.PluginsInstall]: 'marketplace:manage',
  [IpcChannel.PluginsEnable]: 'marketplace:manage',
  [IpcChannel.PluginsDisable]: 'marketplace:manage',
  [IpcChannel.PluginsReload]: 'marketplace:manage',
  [IpcChannel.PluginsUpdate]: 'marketplace:manage',
  [IpcChannel.PluginsRemove]: 'marketplace:manage',
  [IpcChannel.PluginsGrant]: 'marketplace:manage',
  [IpcChannel.PluginsRevoke]: 'marketplace:manage',

  // Local capability grants to installed apps — access-control mutations.
  [IpcChannel.PermsGrant]: 'org:manage',
  [IpcChannel.PermsRevoke]: 'org:manage',

  // Automation Builder rule CRUD + manual run — operations control.
  [IpcChannel.AutomationSave]: 'operations:manage',
  [IpcChannel.AutomationSetStatus]: 'operations:manage',
  [IpcChannel.AutomationRemove]: 'operations:manage',
  [IpcChannel.AutomationRun]: 'operations:manage',

  // Release engineering: data migration, backup restore/delete, recovery run,
  // support-bundle generation — org-wide, data-touching admin actions.
  [IpcChannel.MigrationRun]: 'org:manage',
  [IpcChannel.BackupRestore]: 'org:manage',
  [IpcChannel.BackupDelete]: 'org:manage',
  [IpcChannel.RecoveryRun]: 'org:manage',
  [IpcChannel.SupportGenerateBundle]: 'org:manage',

  // Runtime supervisor control (launch/stop/suspend/resume/restart app runtimes).
  [IpcChannel.RuntimeLaunch]: 'operations:manage',
  [IpcChannel.RuntimeStop]: 'operations:manage',
  [IpcChannel.RuntimeSuspend]: 'operations:manage',
  [IpcChannel.RuntimeResume]: 'operations:manage',
  [IpcChannel.RuntimeRestart]: 'operations:manage',

  // AI memory mutations (write / erase / backfill / rebuild the memory index).
  [IpcChannel.MemoryRemember]: 'operations:manage',
  [IpcChannel.MemoryForget]: 'operations:manage',
  [IpcChannel.MemoryBackfill]: 'operations:manage',
  [IpcChannel.MemoryRebuild]: 'operations:manage',

  // Decision Center mutations.
  [IpcChannel.DecisionSetStatus]: 'operations:manage',
  [IpcChannel.DecisionCreateFromRecommendation]: 'operations:manage',

  // Feature-flag overrides change governed runtime behaviour.
  [IpcChannel.FlagsSetOverride]: 'governance:manage',
  [IpcChannel.FlagsClearOverride]: 'governance:manage',

  // Commercial + device-trust administration.
  [IpcChannel.BillingCheckout]: 'org:manage',
  [IpcChannel.DevicesRegister]: 'org:manage',
  [IpcChannel.DevicesRevoke]: 'org:manage',

  // Runtime Supervisor recovery + policy changes.
  [IpcChannel.SupervisorRecover]: 'operations:manage',
  [IpcChannel.SupervisorSetPolicy]: 'operations:manage',

  // Local registry mutations (bulk import, backup snapshot).
  [IpcChannel.RegistryImport]: 'operations:manage',
  [IpcChannel.RegistryBackup]: 'operations:manage',

  // Package rollback (reverts an installed app to a prior version).
  [IpcChannel.NpsRollback]: 'operations:manage',

  // Knowledge-graph REBUILD is a mutation (rebuilds the entire EKG index). The
  // task's "all graph:* → intelligence:read" shorthand was written for the graph
  // READ surface; a rebuild is a side-effecting operation, so — conservatively,
  // and in parity with `memory:rebuild` above — it takes `operations:manage`
  // rather than the weaker read scope. (Flagged in the change report.)
  [IpcChannel.GraphRebuild]: 'operations:manage',

  /* ── Sensitive reads (surface org intelligence) → intelligence:read ──── */

  // AI memory recall (returns remembered org content).
  [IpcChannel.MemoryRecall]: 'intelligence:read',

  // Unified knowledge queries across every connected source.
  [IpcChannel.UnifiedQuery]: 'intelligence:read',
  [IpcChannel.UnifiedSearch]: 'intelligence:read',

  // Enterprise Knowledge Graph reads (nodes / edges / neighbours / paths /
  // history — the full org relationship intelligence).
  [IpcChannel.GraphCounts]: 'intelligence:read',
  [IpcChannel.GraphNode]: 'intelligence:read',
  [IpcChannel.GraphNodes]: 'intelligence:read',
  [IpcChannel.GraphNeighbors]: 'intelligence:read',
  [IpcChannel.GraphSubgraph]: 'intelligence:read',
  [IpcChannel.GraphPath]: 'intelligence:read',
  [IpcChannel.GraphHistory]: 'intelligence:read',

  // Enterprise timeline query (the unified work stream).
  [IpcChannel.EnterpriseTimelineQuery]: 'intelligence:read',

  // Cross-source enterprise search.
  [IpcChannel.EnterpriseSearch]: 'intelligence:read',

  // Founder AI ask (reasons over the whole org corpus).
  [IpcChannel.FounderAsk]: 'intelligence:read',

  // Executive Center snapshot (rolls every layer into one live view).
  [IpcChannel.ExecutiveCenterSnapshot]: 'intelligence:read',

  // Governance / context / relationship trace reads (decision provenance +
  // entity relationship intelligence).
  [IpcChannel.GovernanceList]: 'intelligence:read',
  [IpcChannel.GovernanceTrace]: 'intelligence:read',
  [IpcChannel.ContextTrace]: 'intelligence:read',
  [IpcChannel.RelationshipTrace]: 'intelligence:read',
  [IpcChannel.RelationshipPath]: 'intelligence:read',
};

/**
 * Stamp `requireAuth` + `permission` onto every runtime handler def from the
 * classification map. Mirrors `withEnterpriseAuthz` exactly: it THROWS at
 * composition time for any channel it is handed that has no classification, so a
 * privileged channel can never be annotated by accident or shipped unguarded.
 * Every other field (schema, audit, handler, timeoutMs) is preserved.
 */
export function withRuntimeAuthz<T extends { channel: IpcChannelName }>(
  defs: readonly T[],
): (T & { permission: EnterprisePermission; requireAuth: true })[] {
  return defs.map((def) => {
    const permission = RUNTIME_CHANNEL_PERMISSIONS[def.channel];
    if (!permission) {
      throw new Error(
        `Runtime IPC channel "${def.channel}" has no permission classification. ` +
          `Add it to RUNTIME_CHANNEL_PERMISSIONS (or PUBLIC_CHANNELS) in ipc/runtimeAuthz.ts.`,
      );
    }
    return { ...def, permission, requireAuth: true };
  });
}

/**
 * Channels that intentionally remain ungated (no `permission`, no `requireAuth`)
 * — the desktop's genuinely-public surface. Three buckets:
 *
 *  a. Public reads: catalog/store reads, local registry reads, the read-only
 *     package operations, `runtime:list`/`runtime:health`, platform timeline /
 *     diagnostics reads, unified/memory/knowledge *read* projections, the daily
 *     briefing / recommendation generators, and read-only decision/automation
 *     listings.
 *  b. Renderer→main state reports: the widget/health pings the renderer pushes
 *     back to main (`voice:status`, `license:reportHealth`, `device:reportHealth`,
 *     the system-health snapshot, execute/supervisor status reads).
 *  c. Local, per-user desktop operations that are out of the org-RBAC audit's
 *     scope and remain on the desktop's existing sender-trust model
 *     (crash/onboarding/feedback/pilot/updater/release-diagnostics/local backup
 *     create+validate, migration status). These are single-user desktop surfaces,
 *     not org-shared state; revisit if any becomes multi-tenant.
 *
 * A channel here is a DELIBERATE decision to leave it ungated — it is the escape
 * hatch the startup invariant checks against, not a dumping ground.
 */
export const PUBLIC_CHANNELS: ReadonlySet<IpcChannelName> = new Set<IpcChannelName>([
  // ── Catalog / store reads ──
  IpcChannel.CatalogFeatured,
  IpcChannel.CatalogCollections,
  IpcChannel.CatalogSections,
  IpcChannel.CatalogSearch,
  IpcChannel.CatalogApp,
  IpcChannel.CatalogReviews,
  IpcChannel.CatalogDeveloper,
  IpcChannel.CatalogCategories,
  // ── Local application registry reads ──
  IpcChannel.RegistryList,
  IpcChannel.RegistryGet,
  IpcChannel.RegistrySetFlags,
  IpcChannel.RegistryStats,
  IpcChannel.RegistryExport,
  // ── Package service read-only operations ──
  IpcChannel.NpsVerify,
  IpcChannel.NpsOperations,
  IpcChannel.NpsPause,
  IpcChannel.NpsResume,
  IpcChannel.NpsCancel,
  // ── Runtime reads ──
  IpcChannel.RuntimeList,
  IpcChannel.RuntimeHealth,
  // ── Permission read ──
  IpcChannel.PermsList,
  // ── Plugin reads ──
  IpcChannel.PluginsList,
  IpcChannel.PluginsGet,
  IpcChannel.PluginsContributions,
  IpcChannel.PluginsExtensions,
  // ── Platform core reads + UI event emit ──
  IpcChannel.TimelineQuery,
  IpcChannel.TimelineStats,
  IpcChannel.TimelineExport,
  IpcChannel.DiagnosticsGet,
  IpcChannel.PlatformEmit,
  // ── Unified knowledge read projections ──
  IpcChannel.UnifiedGet,
  IpcChannel.UnifiedCounts,
  // ── AI memory read projections + executive conversation memory ──
  IpcChannel.MemorySemanticRecall,
  IpcChannel.MemoryGet,
  IpcChannel.MemoryCounts,
  IpcChannel.ExecMemorySearch,
  IpcChannel.ExecMemoryForget,
  IpcChannel.ExecMemoryPin,
  IpcChannel.ExecMemoryResolve,
  IpcChannel.ExecMemoryAudit,
  // ── Knowledge reads ──
  IpcChannel.KnowledgeRelated,
  IpcChannel.KnowledgeTopics,
  IpcChannel.KnowledgeHealth,
  // ── Enterprise timeline read projections (query is gated separately) ──
  IpcChannel.EnterpriseTimelineReplay,
  IpcChannel.EnterpriseTimelineStats,
  IpcChannel.EnterpriseTimelineExport,
  // ── Daily intelligence generators (read-only) ──
  IpcChannel.BriefingGenerate,
  IpcChannel.RecommendationsGenerate,
  // ── Decision + automation read listings ──
  IpcChannel.DecisionList,
  IpcChannel.AutomationList,
  IpcChannel.AutomationMonitor,
  IpcChannel.AutomationHistory,
  // ── AI analysis reads ──
  IpcChannel.EngineeringAnalyze,
  IpcChannel.FounderAskV2,
  IpcChannel.FounderSuggestions,
  // ── NeuroCore + renderer→main state reports ──
  IpcChannel.SystemHealthSnapshot,
  IpcChannel.LicenseReportHealth,
  IpcChannel.DeviceReportHealth,
  IpcChannel.VoiceStatus,
  IpcChannel.VoiceTurn,
  IpcChannel.DevicesList,
  IpcChannel.SupervisorStatus,
  IpcChannel.SupervisorHistory,
  IpcChannel.ExecuteSessions,
  IpcChannel.ExecuteHistory,
  // ── Feature flags read ──
  IpcChannel.FlagsGet,
  // ── License reads ──
  IpcChannel.LicenseStatus,
  IpcChannel.LicenseRefresh,
  // ── Local desktop operations (out of org-RBAC scope; sender-trust retained) ──
  IpcChannel.MigrationStatus,
  IpcChannel.BackupList,
  IpcChannel.BackupCreate,
  IpcChannel.BackupValidate,
  IpcChannel.CrashGetStatus,
  IpcChannel.CrashSetOptIn,
  IpcChannel.CrashExport,
  IpcChannel.CrashRecommendations,
  IpcChannel.CrashReport,
  IpcChannel.ReleaseDiagnosticsGet,
  IpcChannel.ReleaseDiagnosticsExport,
  IpcChannel.RecoverySafeModeStatus,
  IpcChannel.OnboardingStatus,
  IpcChannel.OnboardingStart,
  IpcChannel.OnboardingCompleteStep,
  IpcChannel.OnboardingDismiss,
  IpcChannel.OnboardingReset,
  IpcChannel.FeedbackSubmit,
  IpcChannel.FeedbackList,
  IpcChannel.FeedbackExport,
  IpcChannel.FeedbackClear,
  IpcChannel.FeedbackExportToFile,
  IpcChannel.PilotStatus,
  IpcChannel.PilotSetEnabled,
  IpcChannel.UpdateGetStatus,
  IpcChannel.UpdateCheckNow,
  IpcChannel.UpdateDownload,
  IpcChannel.UpdateInstallOnQuit,
  IpcChannel.UpdateSetChannel,
  // ── Enterprise REST API gateway entrypoints. `api:request` cannot bypass RBAC:
  // it dispatches through `runSecureHandler`, which re-applies each target
  // handler's `permission`; routes/openapi are static docs. ──
  IpcChannel.EnterpriseApiRequest,
  IpcChannel.EnterpriseApiRoutes,
  IpcChannel.EnterpriseApiOpenApi,
]);

/**
 * Startup invariant. Given the set of channels that ended up GATED (carrying a
 * `permission` and/or `requireAuth` in the assembled handler registry) and the
 * vetted `PUBLIC_CHANNELS` allowlist, return every `RUNTIME_INVOKABLE_CHANNELS`
 * entry that is NEITHER — i.e. still riding on sender-trust alone and not
 * explicitly allowlisted. An empty result means the whole invokable surface is
 * accounted for; a non-empty result is a fail-closed signal for the caller.
 *
 * Pure and Electron-free so it unit-tests without the app runtime.
 */
export function assertAllChannelsClassified(
  classifiedChannels: Iterable<IpcChannelName>,
  publicChannels: ReadonlySet<IpcChannelName>,
): string[] {
  const classified = new Set<IpcChannelName>(classifiedChannels);
  return RUNTIME_INVOKABLE_CHANNELS.filter(
    (channel) => !classified.has(channel) && !publicChannels.has(channel),
  );
}
