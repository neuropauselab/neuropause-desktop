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
 *     unclassified philosophy) rather than expose a new channel by omission —
 *     and, since Round 10, THROWS for any channel that is BOTH, because an
 *     allowlist row that survives a gate is a false statement about the surface
 *     and made this check blind to a regression on that channel.
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
   * P13C ROUND 4 — THE AI DESTINATION CAME OFF THE PUBLIC ALLOWLIST.
   *
   * The PAYLOAD sent to a model is correctly tenant-scoped — retrieval runs over
   * scoped stores. The DESTINATION was not: one install-wide provider,
   * credential and `ollamaUrl`, settable from channels with no `requireAuth` and
   * no permission. Any renderer message could point the model endpoint at a host
   * it controlled and flip external consent, and every later assistant or
   * briefing call made while ANOTHER organization was active would ship that
   * organization's retrieved records there.
   *
   * The allowlist's own comment said these were "single-user desktop surfaces,
   * not org-shared state; revisit if any becomes multi-tenant". They did.
   *
   * `AiConfigGet` stays public — reading which provider is configured is not the
   * exposure, and the settings screen needs it before an org resolves.
   */
  /**
   * P13C ROUND 7 (final sweep) — THE MEMORY AUDIT TRAIL IS TENANT DATA.
   *
   * It was PUBLIC: no auth, no permission. `MemoryAuditEvent.detail` is a
   * plain-language summary written by the assistant and carries record titles.
   */
  [IpcChannel.ExecMemoryAudit]: 'intelligence:read',

  /**
   * P13C Round 8 — a paired companion device belongs to one organization, and the
   * row names the bound member's email. It was PUBLIC.
   */
  [IpcChannel.CompanionDevices]: 'org:read',

  /**
   * P13C ROUND 8 — FINDING 5. ROUTING USAGE IS INSTALL-LEVEL, AND WAS PUBLIC.
   *
   * The counters are genuinely install-level — they say where AI work ran (local,
   * private infrastructure, external), which is a property of the machine's
   * configuration, and they hold no prompts, responses or record content.
   * Inspecting the persisted file confirms it: five integers and a timestamp.
   *
   * They are still not public. On an install with two organizations, a rising
   * `total` while you are doing nothing is another tenant working — activity
   * volume and timing, which is the same inference channel this program closed on
   * `graphStore.counts` and `unifiedStore.counts`. `cloud:read` is the narrowest
   * honest gate: it is the machine's own posture, and a signed-in member may see
   * it.
   */
  [IpcChannel.AiRoutingUsage]: 'cloud:read',

  /**
   * P13C ROUND 7 (final sweep) — THE AI DESTINATION IS INSTALL-LEVEL.
   *
   * These were `org:manage`, an ordinary organization-role permission held by
   * every tenant's Owner and Admin — and anyone may create an organization and
   * own it. There is ONE `ai-config.json` for the whole install, so an
   * administrator of tenant A could point `ollamaUrl` at a host they control and
   * flip `externalConsent`, and TENANT B'S RETRIEVED RECORDS would then leave the
   * device to that host on the next assistant call.
   *
   * The comment above this table already described that exposure precisely, and
   * the fix it describes moved these channels off the PUBLIC list onto a TENANT
   * permission — which is a real improvement and the wrong axis. The resource is
   * install-level; the authority must be too.
   *
   * `cloud:operate` cannot be held by any organization role
   * (`PLATFORM_ONLY_PERMISSIONS`), so tenant A's Admin, tenant B's Admin and an
   * Owner of either are refused identically.
   */
  // Destructive and install-wide: both were PUBLIC while their `set` twins
  // required a permission. `resetToEnv` deletes the stored provider credential
  // for every tenant on the machine.
  [IpcChannel.AiConfigClearCredential]: 'cloud:operate',
  [IpcChannel.AiConfigResetToEnv]: 'cloud:operate',
  [IpcChannel.AiConfigSetProvider]: 'cloud:operate',
  [IpcChannel.AiConfigSetModel]: 'cloud:operate',
  [IpcChannel.AiConfigSetCredential]: 'cloud:operate',
  [IpcChannel.AiConfigSetMode]: 'cloud:operate',
  /**
   * P13C ROUND 17 · D-5. Listed here AND in `AI_CHANNEL_AUTHORITY` because
   * `ai:` is not a self-gated prefix: `withAiAuthz` cross-checks the two maps
   * and throws when they disagree, so the duplication is a consistency check
   * rather than a second source of truth.
   *
   * Tenant RBAC, NOT `cloud:operate`. The row above governs the machine; these
   * govern one organization's preference, which can only narrow it.
   */
  [IpcChannel.AiPreferenceGet]: 'org:read',
  [IpcChannel.AiPreferenceSet]: 'org:manage',
  [IpcChannel.AiConfigSetExternalConsent]: 'cloud:operate',
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
  /**
   * P13C ROUND 8 — FINDING 2. INSTALL-WIDE CODE IS AN INSTALL-LEVEL DECISION.
   *
   * These were `marketplace:manage`, an organization role held by every tenant's
   * Owner and Admin — and anyone may create an organization and own it. The
   * resource is `userData/plugins.json` plus a plugin root on disk: ONE registry,
   * ONE set of enable flags, executable code that runs in-process for every
   * tenant. So tenant A's administrator could install and enable an extension that
   * executes while tenant B's data is in memory, and remove one B depends on.
   *
   * Third instance of the Round 7 class — an install-wide resource behind an
   * organization-level role — after the AI destination and rate-limit policies.
   * The same capability closes all three, and it is deliberately the SAME one
   * rather than a new `plugins:operate`: a second platform permission is a second
   * thing to forget, and the axis is what matters, not the name.
   */
  [IpcChannel.PluginsInstall]: 'cloud:operate',
  [IpcChannel.PluginsEnable]: 'cloud:operate',
  [IpcChannel.PluginsDisable]: 'cloud:operate',
  [IpcChannel.PluginsReload]: 'cloud:operate',
  [IpcChannel.PluginsUpdate]: 'cloud:operate',
  [IpcChannel.PluginsRemove]: 'cloud:operate',
  /**
   * P13C ROUND 10 — NEW-H7. THE TWO ROWS ROUND 8 LEFT BEHIND.
   *
   * Every sibling above moved to `cloud:operate` in Round 8; these two stayed on
   * `marketplace:manage`, which is an ORGANIZATION role — in the Owner wildcard
   * and in ADMIN. They mutate `record.grantedPermissions` in the same
   * `userData/plugins.json`, a store declared PLATFORM_GLOBAL with
   * `authority: 'PLATFORM_OPERATOR'` whose own reason names this exposure.
   *
   * A grant hands install-wide executable code filesystem, network and host
   * capabilities, in-process, for every tenant — and ANYONE MAY CREATE AN
   * ORGANIZATION AND BECOME ITS OWNER, so it was self-service. `plugins:list` is
   * public and returns every plugin id with its current grants, so there was
   * nothing to discover first.
   *
   * `cloud:operate` is in `PLATFORM_ONLY_PERMISSIONS`, filtered out of the Owner
   * wildcard by `BUILT_IN_ROLE_SPECS`, so no organization role can hold it.
   * Deliberately the same permission as the siblings rather than a new
   * `plugins:grant` scope: the axis is what matters, and a second platform
   * permission is a second thing to forget to check.
   *
   * `plugins/pluginAuthzGate.ts` now asserts this at composition — a mutation of
   * a PLATFORM_GLOBAL / PLATFORM_OPERATOR store carrying an organization
   * permission throws on import of the plugin manager, so these two rows cannot
   * drift back without the application refusing to start.
   */
  [IpcChannel.PluginsGrant]: 'cloud:operate',
  [IpcChannel.PluginsRevoke]: 'cloud:operate',

  // Local capability grants to installed apps — access-control mutations.
  /**
   * P13C Round 8 — Finding 2. A capability grant hands a plugin filesystem and
   * network reach on the whole machine. `org:manage` made that an organization
   * administrator's call about every other organization's exposure.
   */
  [IpcChannel.PermsGrant]: 'cloud:operate',
  [IpcChannel.PermsRevoke]: 'cloud:operate',

  // Automation Builder rule CRUD + manual run — operations control.
  [IpcChannel.AutomationSave]: 'operations:manage',
  [IpcChannel.AutomationSetStatus]: 'operations:manage',
  [IpcChannel.AutomationRemove]: 'operations:manage',
  [IpcChannel.AutomationRun]: 'operations:manage',

  // Release engineering: data migration, backup restore/delete, recovery run,
  // support-bundle generation — org-wide, data-touching admin actions.
  [IpcChannel.MigrationRun]: 'org:manage',
  /**
   * P13C ROUND 9 — F21. THESE ARE INSTALL-WIDE, AND `org:manage` IS NOT.
   *
   * The comment above called them "org-wide", and every one of them is wider
   * than that. There is one data directory on the machine and one backup
   * archive over it:
   *
   *   - `backup:restore` copies a snapshot of `storage/storePaths.ts`'s whole
   *     DOMAIN_FILES set back over the live directory — `memory.json`,
   *     `graph.json`, `unified-store.json`, `enterprise-module-*` ("the user's
   *     business records"), `assistant-conversations.json`. It rolls EVERY
   *     organization on the install back to an older state, and the caller
   *     chooses which state.
   *   - `backup:delete` destroys a snapshot every organization's recovery
   *     depends on, including the safety backup a prior restore left behind.
   *   - `recovery:run` reaches `restoreBackup` (the same primitive),
   *     `resetSettings` (deletes install-wide settings files),
   *     `disablePlugins` (every tenant's plugins) and `safeMode` (arms a flag
   *     the launcher reads for the whole install).
   *   - `support:generateBundle` writes a directory containing every tenant's
   *     installed modules, connector names and statuses, crash archive and
   *     redacted logs. The redactor strips secrets and emails; it does not know
   *     which organization a log line came from.
   *
   * `org:manage` is held by every organization's Owner and Admin, and ANY
   * PERSON MAY CREATE AN ORGANIZATION AND OWN IT — so it was a self-service
   * grant to overwrite, destroy or exfiltrate every other tenant's data on the
   * machine. That is the Round 7 finding class (`F19`) as an operation rather
   * than a store, and it is why `declareStoreScope` refuses INSTALL_GLOBAL +
   * ORG_ROLE: `recovery/recoveryService.ts` could not declare its true scope
   * while this line said `org:manage`.
   *
   * `cloud:operate` is in `PLATFORM_ONLY_PERMISSIONS`, so no organization role
   * can satisfy it. All four move together deliberately: leaving
   * `backup:restore` on the weaker gate while `recovery:run` required the
   * stronger one would leave the identical capability reachable through the
   * other door.
   */
  [IpcChannel.BackupRestore]: 'cloud:operate',
  [IpcChannel.BackupDelete]: 'cloud:operate',
  [IpcChannel.RecoveryRun]: 'cloud:operate',
  [IpcChannel.SupportGenerateBundle]: 'cloud:operate',
  /**
   * P13C ROUND 10 — NEW-M7 / F22. THE OTHER HALF OF THE BACKUP FAMILY.
   *
   * These three were on `PUBLIC_CHANNELS` — no `requireAuth`, no permission —
   * under the "local, per-user desktop operations" bucket, whose own comment
   * said "revisit if any becomes multi-tenant". They are multi-tenant:
   *
   *   - `backup:create` copies EVERY organization's records (the whole of
   *     `storage/storePaths.ts` DOMAIN_FILES) into a new directory. It was
   *     reachable with no authority at all, and manual backups were uncapped —
   *     only `trigger === 'scheduled'` was pruned — so a loop was an
   *     unauthenticated disk-fill. The cap now lives in `BackupManager.create`
   *     (NEW-M7), and this row is the authority half.
   *   - `backup:list` returns `sizeBytes` and `domains` per archive, so
   *     create-then-list repeatedly measures how much data the OTHER
   *     organizations on the install hold. That is the inference channel Round 8
   *     closed on `graphStore.counts` and `ai/routingUsageStore`, third instance.
   *   - `backup:validate` takes a caller-chosen archive id and reports which of
   *     its files are missing or altered — the same install-wide archive, and an
   *     id-taking surface (see NEW-M6).
   *
   * They join `restore` and `delete` on `cloud:operate` so the whole family sits
   * on one axis: the archive's declaration in `backup/backupArchive.ts` states
   * PLATFORM_OPERATOR authority, and a declaration whose channels disagree is
   * the class of finding this round exists to close.
   */
  [IpcChannel.BackupCreate]: 'cloud:operate',
  [IpcChannel.BackupList]: 'cloud:operate',
  [IpcChannel.BackupValidate]: 'cloud:operate',

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

  /**
   * Local registry mutations (bulk import, backup snapshot).
   *
   * P13C ROUND 9 — F20/F21. `operations:manage` is an ORGANIZATION role, and
   * `registry.json` is one file for the whole machine: `registry:import` with
   * `merge:false` REPLACES the entire entry map — every organization's installed
   * apps, their granted permissions, package hashes and signature key ids — and
   * `registry:backup` writes that map to a file under `userData/backups`. The
   * open item recorded in `registry/registry.ts`'s scope analysis; closed here,
   * which is what let that file declare INSTALL_GLOBAL + PLATFORM_OPERATOR.
   */
  [IpcChannel.RegistryImport]: 'cloud:operate',
  [IpcChannel.RegistryBackup]: 'cloud:operate',

  // Package rollback (reverts an installed app to a prior version).
  /**
   * P13C ROUND 10 — R10-B3A-F1. THE APP REGISTRY'S OTHER DOOR, WITH NO LOCK.
   *
   * `local-app-registry` is declared `INSTALL_GLOBAL` + `PLATFORM_OPERATOR`, and
   * its own reason says "an uninstall removes an app every organization on the
   * machine uses". Round 9 moved `registry:import` and `registry:backup` to
   * `cloud:operate` — and did not follow the same store through its `nps:*` door.
   *
   * `nps:uninstall` reaches `registry.remove(slug)`, deleting the catalogue row
   * for one installed app across every organization: install location, package
   * hash, signature key id, `grantedPermissions`, `permissionGrants` and the
   * per-app `config`. It carried `requireAuth: true` and NO PERMISSION — it was
   * in neither the gated map nor `PUBLIC_CHANNELS`, parked instead in the test's
   * `REQUIRE_AUTH_ONLY` list.
   *
   * That is WEAKER than the F19 class this program has been closing all
   * programme. F19 was an organization role over an install-wide resource;
   * this was no role at all — any signed-in member of any organization.
   *
   * `install` and `update` upsert the same rows through the same door and move
   * with it. `rollback` was already `operations:manage`, an organization role
   * over the same install-wide rows, so it moves too: the axis is the resource,
   * not which verb reaches it. The reads (`registry:list`, `registry:get`) do not
   * move — knowing what this machine has installed is inventory a member needs.
   */
  [IpcChannel.NpsInstall]: 'cloud:operate',
  [IpcChannel.NpsUninstall]: 'cloud:operate',
  [IpcChannel.NpsUpdate]: 'cloud:operate',
  [IpcChannel.NpsRepair]: 'cloud:operate',
  [IpcChannel.NpsRollback]: 'cloud:operate',

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
  /**
   * P13C ROUND 9 — F9. Moved out of `PUBLIC_CHANNELS`; see the note there.
   *
   * `operations:read` rather than a platform permission: a diagnostics report is
   * something an organization's operator legitimately reads about the machine
   * they are running on, and it is in the READ_ONLY base role. The change is
   * that it now requires BEING SIGNED IN AND A MEMBER, which an unauthenticated
   * renderer message was not.
   */
  [IpcChannel.DiagnosticsGet]: 'operations:read',
  /**
   * P13C ROUND 10 — NEW-M2. THE CLASSIFICATION WAS APPLIED TO A CHANNEL, NOT TO
   * THE DATA.
   *
   * Round 9 moved `diagnostics:get` off the public list because its payload
   * embeds `bus.metrics()` — `eventsPublished`, `eventsPerMinute`,
   * `subscribers`, `bufferedEvents`, counted across every tenant on the install
   * with no boundary in the path. These three channels serve THE SAME NUMBERS
   * and were left public:
   *
   *   `release:diagnostics.get` / `.export` → `collectReleaseDiagnostics`, whose
   *     `health` port IS `platform.diagnostics()` — the identical
   *     `DiagnosticsReport`, plus the installed-module and connector inventory.
   *     `.export` writes it to a file, so it is the strictly wider door.
   *   `system:health` → `composeSystemHealth`, whose `throughput`
   *     (`eventsPerMinute`, `bufferedEvents`, `avgDispatchMs`) is the same
   *     `bus.metrics()` reading under another name.
   *
   * A total that climbs while YOU are idle is another organization working, and
   * its rate is their activity profile — the inference channel Round 8 closed on
   * `graphStore.counts` and `ai/routingUsageStore`. The lock belongs to the
   * payload, so it is the same one `diagnostics:get` carries: `operations:read`,
   * in the READ_ONLY base role, requiring only that the caller be signed in and
   * a member. The renderer surfaces that read these (`EnterpriseOverview`,
   * `RuntimeHealthPanel`, `IntelligenceView`, `ProductOpsView`) are all
   * post-sign-in; the REST `/observability/health` route calls the composer
   * directly and is gated by the gateway's own scopes, so neither loses a path.
   */
  [IpcChannel.ReleaseDiagnosticsGet]: 'operations:read',
  [IpcChannel.ReleaseDiagnosticsExport]: 'operations:read',
  [IpcChannel.SystemHealthSnapshot]: 'operations:read',
  /**
   * P13C ROUND 11 — M-1 / M-2. THE SAME ARGUMENT AS THE THREE ABOVE, ONE
   * SUBSYSTEM LATER.
   *
   * `runtime:list` and `runtime:health` were PUBLIC — no auth, no permission —
   * and returned a `RuntimeInstanceDto` PER LIVE PROCESS: `appSlug`, `pid`,
   * `startedAt`, `uptimeMs`, `restarts` and a CPU/memory sample. That is not
   * install metadata like `plugins:list`; it is what one organization is running
   * right now. An instance count that climbs while you are idle is another
   * organization launching something, and `appSlug` names WHAT — a sharper
   * version of the `bus.metrics()` inference the three rows above were gated for.
   *
   * `operations:read` rather than a new lock, for the reason stated above: it is
   * in the READ_ONLY base role, so any signed-in member keeps the panel, and
   * `RuntimeHealthPanel` — named in that comment as post-sign-in — is the caller
   * of both of these channels. Nothing loses a path.
   *
   * THE GATE IS THE SMALLER HALF, and saying so is the point. Authentication
   * establishes that a caller is a member of SOME organization; it cannot say
   * which processes are theirs. The boundary is `supervisor.ownerNow()` filtering
   * `list` / `get` / `requireInstance` (M-3). This row stops the channel being
   * readable with no session at all and makes the classification honest: it
   * carries tenant-derived data, so it is not public.
   */
  [IpcChannel.RuntimeList]: 'operations:read',
  [IpcChannel.RuntimeHealth]: 'operations:read',
  /**
   * P13C ROUND 11 — M-4 / M-5 / M-7 / M-10. FOUR FAMILIES OFF THE PUBLIC
   * ALLOWLIST. Each removal is argued at its former site in `PUBLIC_CHANNELS`.
   *
   * The dividing line is the one this table already uses: a MUTATION of an
   * install-wide resource is a platform act (`cloud:operate`); a READ whose
   * payload is tenant-derived needs a signed-in member (`operations:read`).
   *
   * `update:*` — the application binary. Four mutations that were reachable with
   *   no auth at all; `quitAndInstall` alone is an unauthenticated DoS on every
   *   tenant. `getStatus` is a read and stays available to any member.
   * `nps:pause|resume|cancel` — abort an install a platform operator authorized,
   *   delete the partial from disk, drop the concurrency lock.
   * `crash:*` reads — one install-wide archive with no owner field on any row.
   * `registry:export` — raw rows, so it carries the per-app launch counters
   *   `toDto` withholds. Beside its `import` / `backup` write siblings.
   */
  [IpcChannel.UpdateCheckNow]: 'cloud:operate',
  [IpcChannel.UpdateDownload]: 'cloud:operate',
  [IpcChannel.UpdateInstallOnQuit]: 'cloud:operate',
  [IpcChannel.UpdateSetChannel]: 'cloud:operate',
  [IpcChannel.UpdateGetStatus]: 'operations:read',
  [IpcChannel.NpsPause]: 'cloud:operate',
  [IpcChannel.NpsResume]: 'cloud:operate',
  [IpcChannel.NpsCancel]: 'cloud:operate',
  [IpcChannel.CrashExport]: 'operations:read',
  [IpcChannel.CrashGetStatus]: 'operations:read',
  [IpcChannel.RegistryExport]: 'cloud:operate',
  /**
   * P13C ROUND 12 — PHASE 5. THE FINAL PUBLIC-ALLOWLIST SWEEP.
   *
   * Round 11 closed four MEDIUM findings that all lived in this list, and said
   * the bucket was "smaller but not empty". It was not empty. A full sweep of
   * every remaining entry against SCOPE + AUTHORITY + PAYLOAD + MUTABILITY found
   * fourteen more, and nine of them are ONE DEFECT wearing different names:
   *
   *   A GENERATOR OVER THE TENANT CORPUS WAS ADMITTED AS "READ-ONLY".
   *
   * "Read-only" answers MUTABILITY. The allowlist rule is about the PAYLOAD.
   * Every one of these reads the same `unified-entities` / `ai-memory-store` /
   * timeline rows — declared TENANT + CUSTOMER_DERIVED — and returns record
   * titles, body excerpts, actor labels and synthesised summaries, while the
   * STORED form of the identical data is already gated `intelligence:read`:
   *
   *   `enterprise:timeline.export/.replay/.stats` — the same private `collect()`
   *     as `enterprise:timeline.query`, which is gated. `export` is the strictly
   *     WIDER door: unpaginated, every entry, body excerpt attached.
   *   `briefing:generate`   — `unifiedStore.query({limit: 1_000_000})`, emitted as
   *     "Meeting: <title>", "Document: <title>", with 140-char body excerpts.
   *   `knowledge:related` / `.topics` / `.health` — a THIRD retrieval strategy
   *     over `memoryStore.allItems()`, whose other two strategies (`memory:recall`,
   *     `memory:semanticRecall`) are both `intelligence:read`. The A6 note in
   *     this file already states the rule: "the gate belongs to the data, not to
   *     the retrieval strategy."
   *   `recommendations:generate` — carries `rationale`, `entityRefs`, `evidence`;
   *     `decision:list` was pulled off this allowlist in Round 2 for exactly that
   *     payload, and `decision:createFromRecommendation` turns these INTO those.
   *   `voice:turn` — speaks `composeExecutiveSnapshot`, whose written form
   *     (`ExecutiveCenterSnapshot`) is `intelligence:read`. The channel name says
   *     voice; the payload is org intelligence.
   *
   * The remaining five are their own shapes:
   *
   *   `notifications:list` / `.markRead` — the inbox store DECLARES itself
   *     TENANT + CUSTOMER_DERIVED and its own comment says "a notification BODY
   *     carries business data — the delivered title interpolates the subject's
   *     name". Admitted here as "per-user local data", which was true of the
   *     PREFERENCES and never of the rows. `prefs.get/.set` stay public.
   *   `platform:emit` — a PUBLIC WRITE into a TENANT + CUSTOMER_DERIVED store
   *     whose authority is SYSTEM, i.e. rows the product produces and a caller
   *     does not author. It let an unauthenticated renderer write timeline rows
   *     with a chosen `resourceName`, read back later by the gated
   *     `timeline.query` as observed activity — into an append-only log the
   *     declaration says is "never trimmed", with no rate limit above it.
   *   `crash:recommendations` — the THIRD door on the archive whose two siblings
   *     were gated last round, and the M-7 comment block never mentioned it. Its
   *     payload is advisories rather than records, but they are thresholded on
   *     install-wide fault counts that move when another tenant's session
   *     crashes, which is the inference clause.
   *   `pilot:setEnabled` — a PUBLIC mutation of one install-global JSON. Lowest
   *     severity here (the blast radius is a badge) and the only store in the
   *     group with NO `declareStoreScope` at all, which is why nothing
   *     structural caught it.
   *
   * `dashboard:read` for the per-user surfaces and `operations:read` /
   * `intelligence:read` for the rest are all in the READ_ONLY base role, so no
   * signed-in member loses a path. What changes is that a SIGNED-OUT context
   * loses all of them.
   */
  [IpcChannel.EnterpriseTimelineExport]: 'intelligence:read',
  [IpcChannel.EnterpriseTimelineReplay]: 'intelligence:read',
  [IpcChannel.EnterpriseTimelineStats]: 'intelligence:read',
  [IpcChannel.BriefingGenerate]: 'intelligence:read',
  [IpcChannel.KnowledgeRelated]: 'intelligence:read',
  [IpcChannel.KnowledgeTopics]: 'intelligence:read',
  [IpcChannel.KnowledgeHealth]: 'intelligence:read',
  [IpcChannel.RecommendationsGenerate]: 'intelligence:read',
  [IpcChannel.VoiceTurn]: 'intelligence:read',
  [IpcChannel.NotificationsList]: 'dashboard:read',
  [IpcChannel.NotificationsMarkRead]: 'dashboard:read',
  [IpcChannel.PlatformEmit]: 'dashboard:read',
  [IpcChannel.CrashRecommendations]: 'operations:read',
  [IpcChannel.PilotSetEnabled]: 'org:manage',
  /**
   * P13C ROUND 13 — M-14. Restated here so the central register is complete and
   * the AI family gate's cross-check has something to agree WITH — the NEW-M8
   * lesson: a channel classified in only one of the two tables is a channel a
   * regression can move without either mechanism noticing.
   */
  [IpcChannel.EngineeringAnalyze]: 'intelligence:read',
  /**
   * P13C ROUND 13 — M-13. A PUBLIC WRITE TO A SHARED ROW.
   *
   * `registry:setFlags` mutated `pinned`/`favorite` on the install-global
   * `RegistryEntry`, so tenant A un-pinning an app un-pinned it for tenant B,
   * from a context with no authentication at all. Round 9 (F4) verified the
   * PAYLOAD whitelist — the mutation can only reach those two fields — and that
   * verification still holds. What it never resolved was the DESTINATION.
   *
   * `cloud:operate` would be the wrong lock: this is a per-user personalization,
   * not a platform act, and gating it there takes the pin button away from every
   * ordinary member. The fix is that the write now lands in the caller's own
   * `flagsByTenant` bucket (see `registry.ts`), which makes the mutation
   * genuinely tenant-local — and `dashboard:read` is the scope this file already
   * uses for per-user surfaces whose owner is resolved server-side.
   */
  [IpcChannel.RegistrySetFlags]: 'dashboard:read',
  /**
   * P13C ROUND 10 — NEW-M8. SEVEN CHANNELS THAT WERE PUBLIC **AND** GATED.
   *
   * Each of these carries a permission stamped by its family gate
   * (`ai/aiAuthzGate.ts`, `memory/memoryAuthzGate.ts`) and was ALSO still listed
   * in `PUBLIC_CHANNELS`. The stale rows granted nothing — the allowlist is only
   * consulted for channels that ended up ungated — but they made the invariant
   * blind: `assertAllChannelsClassified` accepted a channel because it was
   * public, regardless of whether a gate had applied, so with every family gate
   * removed it reported only 613 of 718 channels unclassified and the 105 public
   * ones passed in silence. A regression on any of these seven was undetectable.
   *
   * The rows are deleted from the allowlist below, the classification is
   * restated here so the central register is complete, and the invariant now
   * REFUSES the overlap outright rather than tolerating it. The family gates
   * cross-check every row against this table and throw on disagreement, so these
   * eight entries are asserted equal rather than merely written twice.
   */
  [IpcChannel.AiConfigMigrate]: 'cloud:operate',
  [IpcChannel.FounderAskV2]: 'intelligence:read',
  [IpcChannel.MemoryGet]: 'intelligence:read',
  [IpcChannel.ExecMemorySearch]: 'intelligence:read',
  [IpcChannel.ExecMemoryForget]: 'operations:manage',
  [IpcChannel.ExecMemoryPin]: 'operations:manage',
  [IpcChannel.ExecMemoryResolve]: 'operations:manage',
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
 *     supervisor status reads).
 *  c. Local, per-user desktop operations that are out of the org-RBAC audit's
 *     scope and remain on the desktop's existing sender-trust model
 *     (crash/onboarding/feedback/pilot/updater, migration status). These are
 *     single-user desktop surfaces, not org-shared state; revisit if any becomes
 *     multi-tenant.
 *
 * A channel here is a DELIBERATE decision to leave it ungated — it is the escape
 * hatch the startup invariant checks against, not a dumping ground.
 *
 * P13C ROUND 10 — NEW-M2. THE RULE THIS LIST IS NOW HELD TO, WRITTEN DOWN.
 *
 * A channel may be public only when its PAYLOAD is not tenant-derived. Not when
 * its name reads harmless, not when it "feels local", and never by pattern — the
 * question is resolved by following the handler to what it returns:
 *
 *   RESOURCE  → what the payload is actually made of;
 *   OPERATION → read, write, export;
 *   SCOPE     → whose it is: TENANT, INSTALL_GLOBAL, or genuinely nobody's;
 *   AUTHORITY → which axis may grant it: an organization role, or platform-only;
 *   then the classification.
 *
 * `release:diagnostics.*` and `system:health` failed that test on RESOURCE: both
 * carry `bus.metrics()`, counted across every tenant, which is why `diagnostics:get`
 * left this list in Round 9. Three doors onto one payload, and last round gated
 * one of them. Classifying a channel is not classifying its data.
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
  IpcChannel.RegistryStats,
  /**
   * P13C ROUND 11 — M-10. `RegistryExport` WAS HERE.
   *
   * `registry.export()` serialises `...this.file` — the RAW entry rows — so it
   * bypasses `toDto`, which Round 9 (F20) made the place where the cross-tenant
   * activity counters are withheld. `launchCount`, `lastLaunchedAt` and
   * `usage.{launches,totalActiveMs,lastSessionAt}` are absent from
   * `registry:list` and present in the export bytes. The migration note in
   * `registry.ts` states the numbers "are visible to no organization" — true of
   * `toDto`, false of this path, which is the stale-declaration class.
   *
   * Now `cloud:operate`, beside `registry:import` and `registry:backup` that
   * write the same file. Cost: none. `registry.export` has ZERO renderer call
   * sites — `ipc.ts` defines the wrapper and nothing invokes it.
   */
  // ── Package service read-only operations ──
  IpcChannel.NpsVerify,
  IpcChannel.NpsOperations,
  /**
   * P13C ROUND 11 — M-4. `NpsPause`, `NpsResume` and `NpsCancel` WERE HERE,
   * under a header that calls them "read-only operations". THEY ARE NOT.
   *
   * `nps:cancel` reaches `downloadManager.cancel`: it aborts an in-flight
   * install/update/repair that a PLATFORM OPERATOR authorized, deletes the
   * partial file from disk, and drops the `busy` concurrency lock for that slug.
   * `nps:pause` aborts the same request. Round 10 moved install / uninstall /
   * update / repair / rollback to `cloud:operate` on the stated principle that
   * "the axis is the resource, not which verb reaches it" — and left behind the
   * three channels that TERMINATE those very operations, on no authority at all.
   *
   * The attack needed no guessing: public `nps:operations` enumerates the
   * operation ids and slugs, public `nps:cancel` kills them.
   *
   * Cost: none. The only callers are the Operations toolbar, whose neighbouring
   * button already invokes `nps:install` — a `cloud:operate` channel.
   */
  // ── Runtime reads ──
  // Phase 8 (8.14): bundled-docs help surface — fixed catalog, fail-closed enum.
  IpcChannel.HelpListDocs,
  IpcChannel.HelpOpenDoc,
  /**
   * P13C ROUND 11 — M-1 / M-2. `RuntimeList` and `RuntimeHealth` WERE HERE.
   *
   * They are now classified `operations:read` in RUNTIME_CHANNEL_PERMISSIONS
   * above, with the reasoning. Removed rather than left alongside the gate:
   * `channelsBothPublicAndGated` throws on the overlap, because a channel that
   * is both is the NEW-M8 blindness — the allowlist satisfies
   * `assertAllChannelsClassified` regardless of whether the gate applied, so a
   * regression on it would be undetectable.
   */
  // ── Permission read ──
  IpcChannel.PermsList,
  /**
   * ── Plugin reads ── P13C ROUND 10 — NEW-H7 asked whether these stay public.
   *
   * THEY STAY, AND HERE IS THE ARGUMENT RATHER THAN A SHRUG.
   *
   * WHAT THEY EXPOSE. `PluginDto` carries the plugin id, name, version, author,
   * kind, state, health, the manifest's requested permissions, the CURRENT
   * GRANTS, the contributions, and `source` — the plugin root's absolute path
   * under userData. Nothing in it is customer-derived: `PluginRecord` has no
   * tenant field, and a plugin is an install-wide object. So this is install
   * METADATA on a public channel, not one tenant's data on a public channel,
   * which is the line the rest of this allowlist is drawn on.
   *
   * WHY THE GRANT LIST WAS THE PROBLEM AND IS NOT THE FINDING. It made NEW-H7
   * trivial to aim: read every plugin id and its grants, then call
   * `plugins:grant` on an organization role. The finding was the WRITE. With
   * grant and revoke on `cloud:operate`, reading the list buys reconnaissance
   * and nothing else, and `perms:list` — the sibling capability read for
   * installed apps — is public on the same reasoning.
   *
   * WHAT IS HONESTLY STILL OPEN, STATED RATHER THAN CLAIMED AWAY. The grant list
   * is install security posture: it names which extension holds filesystem or
   * network reach, which is the one worth attacking. `source` leaks the userData
   * path. Neither is customer data and neither is actionable through this
   * channel, so gating them would cost the four shell surfaces that call
   * `plugins:list` before an organization resolves (the command palette, the
   * ecosystem view, the health panel, the operations provider) for a
   * reconnaissance-only gain. That trade is the reason, and it is the trade to
   * revisit — not the grant channels — if `PluginDto` ever gains a tenant field.
   */
  IpcChannel.PluginsList,
  IpcChannel.PluginsGet,
  IpcChannel.PluginsContributions,
  IpcChannel.PluginsExtensions,
  // ── Platform core reads + UI event emit ──
  IpcChannel.TimelineQuery,
  IpcChannel.TimelineStats,
  IpcChannel.TimelineExport,
  /**
   * `DiagnosticsGet` was here. P13C ROUND 9 — F9. It is gated below.
   *
   * The three Timeline channels above stay public because each one filters on
   * the caller's own scope before returning a row. `DiagnosticsGet` does not:
   * its payload embeds `bus.metrics()` — `eventsPublished`, `eventsPerMinute`,
   * `subscribers`, `bufferedEvents` — counted across every tenant on the
   * install, with no boundary anywhere in the path.
   *
   * Those numbers name no record, and that is not the test. A total that climbs
   * while YOU are idle is another organization working, and its rate is their
   * activity profile. Round 8 closed exactly this inference channel twice — on
   * `graphStore.counts` and on `ai/routingUsageStore`, the latter after
   * inspecting the bytes, finding five genuinely install-level integers, and
   * taking it off this list anyway. Same reasoning, third instance.
   */
  // ── Unified knowledge read projections ──
  IpcChannel.UnifiedGet,
  IpcChannel.UnifiedCounts,
  /**
   * ── AI memory read projections + executive conversation memory ──
   *
   * P13C ROUND 10 — NEW-M8. FIVE STALE ROWS DELETED: `memory:get`,
   * `memory:exec-search`, `memory:exec-forget`, `memory:exec-pin` and
   * `memory:exec-resolve`. Round 9 (F20) gated all five in
   * `memory/memoryAuthzGate.ts` and left them sitting here, so this file said
   * "public" about five channels the composition root gates. `memory:counts` is
   * the only one left, and it is genuinely open — see the `PUBLIC` row in
   * `MEMORY_CHANNEL_AUTHORITY` for the reasoning.
   *
   * (A6 moved MemorySemanticRecall to `intelligence:read`, alongside the
   * MemoryRecall channel it mirrors. Round 7 removed ExecMemoryAudit.)
   */
  IpcChannel.MemoryCounts,
  // ── Knowledge reads ──
  // ── Enterprise timeline read projections (query is gated separately) ──
  // ── Daily intelligence generators (read-only) ──
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
  // P13C Round 10 — NEW-M8. `FounderAskV2` REMOVED: Round 9 gated it at
  // `intelligence:read` in `ai/aiAuthzGate.ts` (it WRITES a memory through
  // `captureFounderMemory`) and this row was left behind.
  IpcChannel.FounderSuggestions,
  /**
   * ── NeuroCore + renderer→main state reports ──
   *
   * P13C ROUND 10 — NEW-M2. `SystemHealthSnapshot` REMOVED. It is not a
   * renderer→main state report; it is a READ whose `throughput` block is
   * `bus.metrics()` — the identical install-wide counters `diagnostics:get` was
   * gated for in Round 9. Gated at `operations:read`; see the permission table.
   */
  IpcChannel.LicenseReportHealth,
  IpcChannel.DeviceReportHealth,
  IpcChannel.VoiceStatus,
  IpcChannel.DevicesList,
  // Mobile M1-03 — companion gateway status + paired-device list are local reads.
  IpcChannel.CompanionStatus,
  // P13C Round 8 — CompanionDevices REMOVED from the public set. The rows name a
  // member's email and their paired device; see the permission table.
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
  /**
   * P13C ROUND 10 — NEW-M7. `BackupList`, `BackupCreate` and `BackupValidate`
   * WERE HERE and are now gated on `cloud:operate`; see the permission table.
   * They were admitted as "local backup create+validate", a per-user desktop
   * convenience. `create` copies every organization's records and was uncapped;
   * `list` reports each archive's size, which measures other tenants' data
   * volume. The bucket's own caveat — "revisit if any becomes multi-tenant" —
   * is what this is.
   */
  /**
   * P13C ROUND 11 — M-7. `CrashGetStatus` and `CrashExport` WERE HERE.
   *
   * One install-wide `crashes.log`, no owner field on any row, and two public
   * reads that return whole records: `crash:export` up to 200, `crash:getStatus`
   * the last 10 with no arguments. Any tenant — and a SIGNED-OUT session — read
   * every other tenant's fault history: which workspace they crashed in
   * (`kind: workspace:<section>`), when, and whatever text the exception carried.
   *
   * `redactSensitive` is not a tenant boundary. It strips credentials, home
   * paths and emails; it does not strip org ids, record names or uploaded
   * filenames, and it never runs on `kind` at all. The store's own declaration
   * concedes the point — "not proven free of record text" — while classifying
   * itself `INSTALL_METADATA`, whose definition is "Never about a customer".
   * Those two statements cannot both be true, and the classification is
   * load-bearing: `declareStoreScope` refuses `CUSTOMER_DERIVED` + `INSTALL_GLOBAL`.
   *
   * `operations:read`, exactly as Round 10 did to `ReleaseDiagnosticsGet` /
   * `Export` and `SystemHealthSnapshot` — same file, same shape, same argument.
   *
   * `CrashSetOptIn` and `CrashReport` STAY PUBLIC and that is deliberate: an
   * opt-in is a per-user machine preference, and reporting your own fault
   * discloses nothing to anyone.
   */
  IpcChannel.CrashSetOptIn,
  IpcChannel.CrashReport,
  /**
   * P13C ROUND 10 — NEW-M2. `ReleaseDiagnosticsGet` and
   * `ReleaseDiagnosticsExport` WERE HERE, admitted under "release-diagnostics"
   * as a per-user desktop convenience. Their payload embeds
   * `platform.diagnostics()` — the same `DiagnosticsReport`, with the same
   * install-wide `bus.metrics()`, that `diagnostics:get` was moved off this list
   * for last round. Gated at `operations:read`; see the permission table.
   */
  IpcChannel.RecoverySafeModeStatus,
  IpcChannel.OnboardingStatus,
  IpcChannel.OnboardingStart,
  IpcChannel.OnboardingCompleteStep,
  IpcChannel.OnboardingDismiss,
  IpcChannel.OnboardingReset,
  IpcChannel.AiConfigGet,
  IpcChannel.AiConfigHealth,
  IpcChannel.AiConfigDetectOllama,

  IpcChannel.AiConfigTest,
  IpcChannel.AiConfigMigrationStatus,
  // P13C Round 10 — NEW-M8. `AiConfigMigrate` REMOVED: Round 9 (F21) gated it at
  // `cloud:operate` in `ai/aiAuthzGate.ts` — it writes the install's provider,
  // model and `ollamaUrl` and stores a credential in the Vault — and this row
  // was left behind, saying the opposite.

  // ── Private-First AI experience (same sender-trust model as the AiConfig
  // block above: per-install desktop configuration, no org RBAC scope; the
  // two writes that change where AI work may run — setMode and
  // setExternalConsent — are bridge-audited on their handler defs) ──
  IpcChannel.AiRoutingStatus,
  // P13C Round 8 — Finding 5. AiRoutingUsage REMOVED from the public set; see
  // the permission table. The counters measure where AI work ran, and on an
  // install with two tenants that is one tenant's activity volume and timing.
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
  IpcChannel.NotificationsPrefsGet,
  IpcChannel.NotificationsPrefsSet,
  IpcChannel.PilotStatus,
  /**
   * P13C ROUND 11 — M-5. THE FOUR UPDATER MUTATIONS WERE HERE. THE WORST OF
   * THIS ROUND, because the resource is the APPLICATION BINARY ITSELF.
   *
   * They carried no permission AND no `requireAuth` — sender-frame trust only,
   * which every tenant user and every SIGNED-OUT session satisfies. `audit:true`
   * on the handler defs authorizes nothing; it writes a log line.
   *
   *   `update:installOnQuit` → `autoUpdater.quitAndInstall()`. Terminates the
   *      process for every tenant on the machine and swaps the binary.
   *   `update:setChannel`    → rewrites the install-wide `update-prefs.json` and
   *      repoints the feed, i.e. selects WHICH CODE the install runs next.
   *   `update:download`      → writes the installer to disk.
   *   `update:checkNow`      → outbound fetch to the release feed.
   *
   * Chained, an unauthenticated renderer context moves the machine onto the
   * internal pre-release feed and reboots into a build no administrator chose.
   * Standalone, `installOnQuit` is an unauthenticated denial of service against
   * every tenant.
   *
   * This is the Round 8 Finding-2 class, one level more severe: plugin
   * install/update went to `cloud:operate` because a plugin is "executable code
   * that runs in-process for every tenant". Replacing the application is
   * strictly wider than replacing a plugin, and it was gated less.
   *
   * The stale admission is the "local, per-user desktop operations" bucket
   * above, which names the updater and carries its own expiry: "revisit if any
   * becomes multi-tenant". The updater is not a per-user surface — it is the one
   * subsystem that by definition affects every user of the install.
   *
   * `UpdateGetStatus` is a READ and moves to `operations:read` rather than
   * `cloud:operate`, so an ordinary member still sees "an update is available".
   */
  // ── Enterprise REST API gateway entrypoints. `api:request` cannot bypass RBAC:
  // it dispatches through `runSecureHandler`, which re-applies each target
  // handler's `permission`; routes/openapi are static docs. ──
  IpcChannel.EnterpriseApiRequest,
  IpcChannel.EnterpriseApiRoutes,
  IpcChannel.EnterpriseApiOpenApi,
]);

/**
 * Channels that are BOTH gated and on the public allowlist.
 *
 * P13C ROUND 10 — NEW-M8. THE INVARIANT COULD NOT SEE ITS OWN BLIND SPOT.
 *
 * `assertAllChannelsClassified` accepted a channel because it appeared in
 * `publicChannels`, WITHOUT EVER ASKING whether a gate had also applied. That is
 * an `OR` where the two branches are supposed to be mutually exclusive, and it
 * has a measurable consequence: delete every family gate in the codebase and the
 * check reports 613 of 718 channels unclassified while the 105 public ones pass
 * in silence — including the seven that were, at the time, both public and gated.
 * The allowlist is not a fallback for a gate; it is the statement that no gate
 * was wanted, and a channel cannot truthfully make both statements.
 *
 * Returned sorted so a failure message is stable and diffable.
 */
export function channelsBothPublicAndGated(
  classifiedChannels: Iterable<IpcChannelName>,
  publicChannels: ReadonlySet<IpcChannelName>,
): IpcChannelName[] {
  return [...new Set<IpcChannelName>(classifiedChannels)]
    .filter((channel) => publicChannels.has(channel))
    .sort();
}

/**
 * Startup invariant. Given the set of channels that ended up GATED (carrying a
 * `permission` and/or `requireAuth` in the assembled handler registry) and the
 * vetted `PUBLIC_CHANNELS` allowlist, return every `RUNTIME_INVOKABLE_CHANNELS`
 * entry that is NEITHER — i.e. still riding on sender-trust alone and not
 * explicitly allowlisted. An empty result means the whole invokable surface is
 * accounted for; a non-empty result is a fail-closed signal for the caller.
 *
 * AND IT THROWS when a channel is BOTH, which is the Round 10 strengthening.
 * Throwing rather than returning the offender, because the two conditions are
 * different kinds of statement and must not be reported through one list: an
 * unclassified channel is an OMISSION the caller reports as "rides on
 * sender-trust alone", while public-and-gated is a CONTRADICTION between two
 * files that a caller cannot describe that way and cannot act on differently.
 * It is also the shape every family gate already uses — `withMemoryAuthz`,
 * `withAiAuthz` and `withRuntimeAuthz` all throw at composition time — so the
 * whole classification system fails the same way for the same class of defect.
 *
 * Pure and Electron-free so it unit-tests without the app runtime.
 */
export function assertAllChannelsClassified(
  classifiedChannels: Iterable<IpcChannelName>,
  publicChannels: ReadonlySet<IpcChannelName>,
): string[] {
  const classified = new Set<IpcChannelName>(classifiedChannels);
  const contradictory = channelsBothPublicAndGated(classified, publicChannels);
  if (contradictory.length > 0) {
    throw new Error(
      `Refusing to start: ${contradictory.length} runtime IPC channel(s) are BOTH gated and on ` +
        `PUBLIC_CHANNELS. A channel is open or it is guarded; a stale allowlist row is a false ` +
        `statement about the surface and blinds this invariant to a regression on that channel. ` +
        `Delete the PUBLIC_CHANNELS row (or the gate): ${contradictory.join(', ')}`,
    );
  }
  return RUNTIME_INVOKABLE_CHANNELS.filter(
    (channel) => !classified.has(channel) && !publicChannels.has(channel),
  );
}
