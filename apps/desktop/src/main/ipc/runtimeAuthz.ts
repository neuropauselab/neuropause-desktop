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
  /**
   * P13C ROUND 3 — feedback came OFF the public allowlist.
   *
   * `feedback:list` and `feedback:export` returned every organization's
   * free-text feedback with no auth and no permission; `feedback:exportToFile`
   * wrote it to an arbitrary path, and `feedback:clear` destroyed all of it.
   * The store is now tenant-owned, and these are the gates that stop an
   * unauthenticated renderer message reaching it at all.
   */
  [IpcChannel.FeedbackSubmit]: 'dashboard:read',
  [IpcChannel.FeedbackList]: 'dashboard:read',
  [IpcChannel.FeedbackExport]: 'dashboard:read',
  [IpcChannel.FeedbackClear]: 'org:manage',
  [IpcChannel.FeedbackExportToFile]: 'org:manage',
  /* ── Phase 6 — Universal Enterprise Data Plane ──────────────────────────
   * Three escalating scopes, deliberately separable so segregation of duties
   * is expressible: reading an analysis (`data:read`) is not the right to write
   * records (`data:import`), and neither is the right to APPROVE a high-risk
   * money / payroll / master-data import (`data:approve`). `dp:import` carries
   * `data:import`; the approval of a high-risk table is additionally checked
   * inside the handler against `data:approve`.
   */
  [IpcChannel.DataPlaneInspect]: 'data:read',
  [IpcChannel.DataPlaneAnalyze]: 'data:read',
  [IpcChannel.DataPlanePlan]: 'data:read',
  [IpcChannel.DataPlaneHistory]: 'data:read',
  [IpcChannel.DataPlaneRun]: 'data:read',
  [IpcChannel.DataPlaneProvenance]: 'data:read',
  [IpcChannel.DataPlaneMappings]: 'data:read',
  [IpcChannel.DataPlaneOntology]: 'data:read',
  [IpcChannel.DataPlaneExportable]: 'data:read',
  // Export is gated here at `data:read` AND again inside the handler against the
  // destination module's OWN read permission, so bulk extraction can never be a
  // way around the per-module gate that the on-screen view enforces.
  [IpcChannel.DataPlaneExport]: 'data:read',
  [IpcChannel.DataPlaneExportPlan]: 'data:read',
  /* ── Program 8 — Document Intelligence ──────────────────────────────────
   * Reading documents is `data:read`. Everything that CHANGES one is
   * `data:import` — uploading, reclassifying, correcting a value, linking to a
   * business record, deleting. That is the same right the Data Plane's import
   * surface requires, because it is the same act: bringing information in and
   * asserting what it means.
   *
   * `documents:link` additionally re-checks the TARGET module's own read AND
   * write permission inside the handler, because a link is an assertion about
   * that record. Read access to a customer is not authority to attach an
   * invoice to them.
   */
  /* ── Program 10 — Identity + External Services ──────────────────────────
   * Reading identity is `data:read`. DECIDING one is `data:approve`, not
   * `data:import`: concluding that a provider's object IS an existing customer
   * changes what that customer means, which is the same class of act as
   * approving a high-risk import. The handler additionally requires the
   * destination module's own write scope — deciding and writing are two
   * authorities and both are needed. Stopping a background service is
   * `governance:manage`.
   */
  [IpcChannel.IdentityQueue]: 'data:read',
  [IpcChannel.IdentityList]: 'data:read',
  [IpcChannel.IdentityConfirm]: 'data:approve',
  [IpcChannel.IdentityUnlink]: 'data:approve',
  [IpcChannel.IdentityServices]: 'data:read',
  [IpcChannel.IdentityServiceStatus]: 'governance:manage',
  [IpcChannel.DocumentCapabilities]: 'data:read',
  [IpcChannel.DocumentList]: 'data:read',
  [IpcChannel.DocumentDetail]: 'data:read',
  [IpcChannel.DocumentUpload]: 'data:import',
  [IpcChannel.DocumentReclassify]: 'data:import',
  [IpcChannel.DocumentCorrect]: 'data:import',
  [IpcChannel.DocumentLink]: 'data:import',
  [IpcChannel.DocumentDelete]: 'data:import',
  [IpcChannel.DataPlaneRelationshipOverview]: 'data:read',
  [IpcChannel.DataPlaneRelationshipQueue]: 'data:read',
  [IpcChannel.DataPlaneRelationshipGraph]: 'data:read',
  // Correcting the entity decides what a file will BECOME, so it is part of
  // deciding to load it rather than part of looking at it.
  [IpcChannel.DataPlaneReclassify]: 'data:import',
  // Preview shows real source values, so it takes the same scope as any other
  // read of the uploaded data. Sensitive fields are redacted in the payload.
  [IpcChannel.DataPlanePreview]: 'data:read',
  // Deciding which record a reference points at writes a business fact.
  [IpcChannel.DataPlaneRelationshipDecide]: 'data:import',
  [IpcChannel.DataPlaneRelationshipSkip]: 'data:import',
  [IpcChannel.DataPlaneRelationshipRetry]: 'data:import',
  [IpcChannel.DataPlaneImport]: 'data:import',
  [IpcChannel.DataPlaneSaveMapping]: 'data:import',
  [IpcChannel.DataPlaneForgetMapping]: 'data:import',

  /* ── Decision Records + NeuroPause Hold ─────────────────────────────────
   * The reconstruction trail for consequential actions ("why did we approve
   * this?"). It surfaces who deleted what, against what evidence, and what was
   * overridden — org intelligence, so the reads are gated rather than public.
   * Resolving a hold CLOSES a governed pause and is therefore a management
   * act, not a read; it is additionally bridge-audited on its handler def.
   */
  [IpcChannel.DecisionRecordList]: 'governance:read',
  [IpcChannel.DecisionRecordGet]: 'governance:read',
  [IpcChannel.HoldList]: 'governance:read',
  [IpcChannel.HoldResolve]: 'governance:manage',
  // Opportunity Center. Scoped to PROCUREMENT rather than intelligence or
  // governance on purpose: a finding is made entirely of purchase-order
  // records, restates their contents, and must not become a way to read them
  // past the permission that guards them. Deciding carries `:manage` because it
  // changes state everyone sees; executing is the exception explained below.
  [IpcChannel.OpportunityList]: 'procurement:read',
  [IpcChannel.OpportunitySetStatus]: 'procurement:manage',
  // Execute is classified at `:read`, and that is deliberate. Program 3's whole
  // claim is that a refusal should be a durable, explainable HOLD rather than
  // an error that vanishes — and a bridge-level RBAC throw happens BEFORE the
  // handler runs, so a `:manage` classification here would make
  // `insufficient_permission` unreachable for the one flow that most needs it.
  // The handler enforces `procurement:manage` itself as its first act and
  // refuses with a hold; the RFQ write is independently gated a second time by
  // the enterprise registry's own authorize. Two checks, one explanation.
  [IpcChannel.OpportunityExecute]: 'procurement:read',
  // The outcome restates purchase orders exactly as the finding does, so it
  // takes the same scope. Pure read: it derives, it never writes.
  [IpcChannel.OutcomeGet]: 'procurement:read',

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
  // Mobile M1-03 — companion device-trust administration (mirror device revoke):
  // enabling the gateway, minting a pairing token, and unpairing all mutate the
  // set of devices that can reach enterprise data, so they need org:manage.
  [IpcChannel.CompanionEnable]: 'org:manage',
  [IpcChannel.CompanionRevoke]: 'org:manage',
  [IpcChannel.CompanionPairingQr]: 'org:manage',

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
  // A6 — the semantic sibling returns the *same* remembered org content, plus a
  // vector search scoped by organization id. It sat in `PUBLIC_CHANNELS` while
  // `MemoryRecall` directly above required `intelligence:read`, so the stricter
  // gate could be sidestepped by calling the richer channel. Both now carry the
  // same permission, which is the point: the gate belongs to the data, not to
  // the retrieval strategy. `intelligence:read` is part of the READ_ONLY base
  // role (`enterprise/org/seed.ts:63-72`), so every role that could already
  // reach `MemoryRecall` reaches this unchanged.
  [IpcChannel.MemorySemanticRecall]: 'intelligence:read',

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

  // Phase 6 Stage 4 — approving an assistant plan step re-enters the
  // ExecuteEngine exactly like `execute:run`, so it takes the same scope.
  [IpcChannel.AssistantPlanDecide]: 'workforce:operate',
  /**
   * P13C N7 — conversations moved out of PUBLIC_CHANNELS and into RBAC.
   *
   * `dashboard:read` is the universal signed-in read scope this codebase
   * already uses for per-user surfaces (personalization favourites, recents,
   * saved views) whose OWNER is resolved server-side. That is exactly the shape
   * here: every member may use the assistant, and the store decides which
   * conversations are theirs. A narrower scope would take the assistant away
   * from ordinary members; a wider one would not add a check the store does not
   * already make.
   *
   * The tenant boundary is enforced in `ConversationStore`, not here. This entry
   * closes the unauthenticated path; the store closes the cross-tenant one.
   */
  /**
   * P13C Round 2 — the five channel families moved out of PUBLIC_CHANNELS.
   *
   * Automations and decisions are operations surfaces, so they take the
   * operations scopes the rest of that surface already uses; execution reads
   * take `operations:read` for the same reason. The tenant boundary is enforced
   * in the STORES — these entries close the unauthenticated path, not the
   * cross-tenant one.
   */
  [IpcChannel.DecisionList]: 'operations:read',
  [IpcChannel.AutomationList]: 'operations:read',
  [IpcChannel.AutomationMonitor]: 'operations:read',
  [IpcChannel.AutomationHistory]: 'operations:read',
  [IpcChannel.ExecuteSessions]: 'operations:read',
  [IpcChannel.ExecuteHistory]: 'operations:read',
  [IpcChannel.AssistantConversations]: 'dashboard:read',
  [IpcChannel.AssistantConversationGet]: 'dashboard:read',
  [IpcChannel.AssistantConversationSave]: 'dashboard:read',
  [IpcChannel.AssistantConversationDelete]: 'dashboard:read',
  [IpcChannel.AssistantConversationBranch]: 'dashboard:read',

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
  // Phase 8 (8.14): bundled-docs help surface — fixed catalog, fail-closed enum.
  IpcChannel.HelpListDocs,
  IpcChannel.HelpOpenDoc,
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
  // (A6 moved MemorySemanticRecall to `intelligence:read`, alongside the
  // MemoryRecall channel it mirrors.)
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
  /**
   * ── Decision + automation read listings ──
   *
   * P13C Round 2 — H1/H2. REMOVED FROM PUBLIC.
   *
   * These were admitted as "read listings". They are not: `ExecutiveDecision`
   * carries description, reasoning, evidence, business impact and owner, and an
   * `AutomationRule` carries its trigger and its action set — including
   * `save-memory` and `ai-generate`, which move tenant data. Public meant no
   * auth and no permission, and both stores were install-wide, so an
   * unauthenticated renderer message returned every organization's.
   *
   * Now classified in RUNTIME_CHANNEL_PERMISSIONS above. The stores are scoped
   * too; this closes the unauthenticated path, the stores close the
   * cross-tenant one, and neither alone would be enough.
   */
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
  // Mobile M1-03 — companion gateway status + paired-device list are local reads.
  IpcChannel.CompanionStatus,
  IpcChannel.CompanionDevices,
  IpcChannel.SupervisorStatus,
  IpcChannel.SupervisorHistory,
  /**
   * P13C Round 2 — H5. `ExecuteSessions` / `ExecuteHistory` REMOVED FROM PUBLIC.
   *
   * `ExecutionSession.result` is the full structured output of every executed
   * action — infrastructure changes, M365 sends, approved worker actions — and
   * both channels returned every tenant's behind no permission at all.
   * `ExecuteCancel` took a bare session id.
   */
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
  IpcChannel.AiConfigGet,
  IpcChannel.AiConfigHealth,
  IpcChannel.AiConfigDetectOllama,
  IpcChannel.AiConfigSetProvider,
  IpcChannel.AiConfigSetModel,
  IpcChannel.AiConfigSetCredential,
  IpcChannel.AiConfigClearCredential,
  IpcChannel.AiConfigTest,
  IpcChannel.AiConfigMigrationStatus,
  IpcChannel.AiConfigMigrate,
  IpcChannel.AiConfigResetToEnv,
  // ── Private-First AI experience (same sender-trust model as the AiConfig
  // block above: per-install desktop configuration, no org RBAC scope; the
  // two writes that change where AI work may run — setMode and
  // setExternalConsent — are bridge-audited on their handler defs) ──
  IpcChannel.AiConfigSetMode,
  IpcChannel.AiConfigSetExternalConsent,
  IpcChannel.AiRoutingStatus,
  IpcChannel.AiRoutingUsage,
  IpcChannel.ExperienceProfileGet,
  IpcChannel.ExperienceProfileSet,
  // Reset clears only THIS install's own first-run answers — no org data, no
  // other user's state — so it shares the profile family's sender-trust model.
  // It is bridge-audited on its handler def because it discards user input.
  IpcChannel.ExperienceProfileReset,
  /**
   * ── Phase 6 Stage 4 — Workspace Assistant ──
   *
   * P13C N7 — THE CONVERSATION CHANNELS WERE REMOVED FROM THIS LIST.
   *
   * They were admitted under the "per-user desktop surface" sender-trust model
   * alongside profile and AI-config reads. That reasoning does not hold for
   * conversations: their bodies carry assistant answers SYNTHESISED FROM TENANT
   * DATA — record names, figures, summaries of a customer's business — so they
   * are tenant content, not per-user preference. Public meant no auth and no
   * permission, and `list(null)` returned every conversation on the install.
   *
   * The store is now scoped, which closes the disclosure on its own; removing
   * them from here is the second layer, so an unauthenticated message cannot
   * reach the store at all rather than reaching it and being filtered.
   *
   * `AssistantAsk` and `AssistantCancel` REMAIN public deliberately: asking a
   * question is the per-user surface this list was written for, the answer is
   * assembled from stores that are themselves scoped, and cancelling affects
   * only the caller's own in-flight request.
   */
  IpcChannel.AssistantAsk,
  IpcChannel.AssistantCancel,
  // ── Phase 6 Stage 5 (D-8) — Notification Inbox + delivery preferences
  // (per-user local data, the AiConfig sender-trust precedent; zod-validated,
  // and `notifications:prefs.set` is bridge-audited on its handler def) ──
  IpcChannel.NotificationsList,
  IpcChannel.NotificationsMarkRead,
  IpcChannel.NotificationsPrefsGet,
  IpcChannel.NotificationsPrefsSet,
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
