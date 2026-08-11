/**
 * THE AI CHANNEL FAMILY'S AUTHORITY MAP. P13C ROUND 9 — F21.
 *
 * THE FINDING
 *
 * `aiConfig:migrate` was on `PUBLIC_CHANNELS` — no auth, no permission — while
 * every one of its siblings on the same resource had already been moved to
 * `cloud:operate` in Round 7/8: `setProvider`, `setModel`, `setCredential`,
 * `clearCredential`, `setMode`, `setExternalConsent`, `resetToEnv`. It is not a
 * status read. `migrateFromEnv()` writes `ai-config.json` (provider, model,
 * ollamaUrl, migratedFromEnv) AND writes the Anthropic key into the Secure Vault,
 * then hot-reconfigures the engine.
 *
 * HOW THE ANSWER WAS DERIVED — RESOURCE, OPERATION, SCOPE, AUTHORITY
 *
 *   RESOURCE   ONE `ai-config.json` and ONE `credentialStore` entry, per install.
 *              There is no tenant key anywhere in `AiConfig`.
 *   OPERATION  write (config file) + write (vault) + engine reconfigure.
 *   SCOPE      INSTALL_GLOBAL. One file, one machine, every tenant.
 *   AUTHORITY  PLATFORM_OPERATOR. `declareStoreScope` now REFUSES
 *              INSTALL_GLOBAL + ORG_ROLE, because anyone may create an
 *              organization and own it, which makes an organization role a
 *              self-service grant over a resource that is not one organization's.
 *
 * This is the Round 7 exposure exactly: the AI DESTINATION is install-wide, so a
 * tenant administrator who could redirect it would redirect ANOTHER tenant's
 * retrieved records off the device on the next assistant call. `aiConfig:migrate`
 * writes `ollamaUrl` from the environment and stores a provider credential, so it
 * is a door onto the same destination.
 *
 * `cloud:operate`, NOT A NEW PERMISSION. It already names the axis
 * (organization-authority vs install-authority), it is in
 * `PLATFORM_ONLY_PERMISSIONS`, and `BUILT_IN_ROLE_SPECS` filters it out of the
 * Owner wildcard — so tenant A's Owner, tenant B's Owner and every Admin are
 * refused identically. A second platform permission would be a second thing to
 * forget to check.
 *
 * WHAT ELSE THIS FAMILY OWNS
 *
 * The sweep covered every channel registered from `main/ai/`, not just the one in
 * the finding. `founder:ask-v2` is the other row that moved: it is registered here
 * as an "AI analysis read" and it WRITES — `answerFounder` runs
 * `captureFounderMemory`, which calls `memoryStore.remember`. Its own v1 sibling
 * `founder:ask` requires `intelligence:read`, so the richer channel was the looser
 * one. It takes `intelligence:read`: the memory it writes is TENANT-scoped and
 * owned by the caller's own viewer, so the organization axis is correct here, and
 * the Member role holds that scope — asking a question stays possible for everyone
 * who may read the records the answer is built from.
 */
import { IpcChannel } from '@neuropause/shared';
import type { EnterprisePermission, IpcChannelName } from '@neuropause/shared';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { RUNTIME_CHANNEL_PERMISSIONS } from '../ipc/runtimeAuthz';
import type { ChannelAuthority } from '../memory/memoryAuthzGate';

/** Every invokable channel registered from `main/ai/` → the authority it requires. */
export const AI_CHANNEL_AUTHORITY: Readonly<Partial<Record<IpcChannelName, ChannelAuthority>>> = {
  /* ── Mutations of the install-wide AI configuration ────────────────────
   * `cloud:operate`. One `ai-config.json` + one vault entry for the machine;
   * changing where AI work runs, or what credential it runs with, is an
   * install-level act. Rows 1–7 were moved in Round 7/8; row 8 is F20/F21's.
   */
  [IpcChannel.AiConfigSetProvider]: 'cloud:operate',
  [IpcChannel.AiConfigSetModel]: 'cloud:operate',
  [IpcChannel.AiConfigSetCredential]: 'cloud:operate',
  [IpcChannel.AiConfigClearCredential]: 'cloud:operate',
  [IpcChannel.AiConfigSetMode]: 'cloud:operate',
  [IpcChannel.AiConfigSetExternalConsent]: 'cloud:operate',
  [IpcChannel.AiConfigResetToEnv]: 'cloud:operate',
  /**
   * F21 — THE ONE THAT WAS PUBLIC.
   *
   * Writes provider/model/ollamaUrl into the install config and the environment's
   * API key into the Vault. Idempotent and one-time, which is why it read as
   * harmless: but "one-time" is a property of the FLAG it sets, and the flag is in
   * the same file the call writes. On a fresh install with the env vars present,
   * an unauthenticated renderer message could seed the destination and the
   * credential for every tenant on the machine.
   */
  [IpcChannel.AiConfigMigrate]: 'cloud:operate',

  /* ── Install-level counters ────────────────────────────────────────────
   * Round 8, Finding 5: where AI work ran is the machine's posture, and on a
   * two-tenant install a rising total is the other tenant's activity volume.
   */
  [IpcChannel.AiRoutingUsage]: 'cloud:read',

  /* ── Tenant-content analysis ───────────────────────────────────────────*/
  /**
   * MOVED OFF PUBLIC. Answers are synthesised from this tenant's records, and the
   * call WRITES a memory through `captureFounderMemory`. `founder:ask` (v1) is
   * `intelligence:read`; the v2 door cannot be looser than the v1 door onto the
   * same question.
   */
  [IpcChannel.FounderAskV2]: 'intelligence:read',

  /* ── Deliberately open ─────────────────────────────────────────────────
   * Reads of the machine's own AI posture, which the Settings screen needs before
   * any organization has resolved, and which carry no tenant content:
   *   get / health / detectOllama / migrationStatus / routing.status.
   * `aiConfig:test` validates a candidate credential and PERSISTS NOTHING; the
   * endpoint it dials is the stored `ollamaUrl` or Anthropic's fixed host, and
   * changing that stored value now requires `cloud:operate`.
   * `founder:suggestions` and `ai:engineering-analyze` are non-persisting
   * derivations; they are left as the earlier rounds decided, and named here so
   * that decision has an address rather than a silence.
   */
  [IpcChannel.AiConfigGet]: 'PUBLIC',
  [IpcChannel.AiConfigHealth]: 'PUBLIC',
  [IpcChannel.AiConfigDetectOllama]: 'PUBLIC',
  [IpcChannel.AiConfigMigrationStatus]: 'PUBLIC',
  [IpcChannel.AiConfigTest]: 'PUBLIC',
  [IpcChannel.AiRoutingStatus]: 'PUBLIC',
  [IpcChannel.FounderSuggestions]: 'PUBLIC',
  [IpcChannel.EngineeringAnalyze]: 'PUBLIC',
};

/**
 * The channels in this family whose handler MUTATES persistent state — the AI
 * config file, the Secure Vault, or (for `founder:ask-v2`) the memory store.
 */
export const AI_WRITE_CHANNELS: ReadonlySet<IpcChannelName> = new Set<IpcChannelName>([
  IpcChannel.AiConfigSetProvider,
  IpcChannel.AiConfigSetModel,
  IpcChannel.AiConfigSetCredential,
  IpcChannel.AiConfigClearCredential,
  IpcChannel.AiConfigSetMode,
  IpcChannel.AiConfigSetExternalConsent,
  IpcChannel.AiConfigResetToEnv,
  IpcChannel.AiConfigMigrate,
  IpcChannel.FounderAskV2,
]);

/**
 * Stamp authority onto every AI handler from the map. Same contract as
 * `withMemoryAuthz`: unclassified THROWS, and a row that disagrees with
 * `RUNTIME_CHANNEL_PERMISSIONS` throws rather than silently winning.
 */
export function withAiAuthz(defs: SecureHandlerDef[]): SecureHandlerDef[] {
  return defs.map((def) => {
    const authority = AI_CHANNEL_AUTHORITY[def.channel];
    if (authority === undefined) {
      throw new Error(
        `AI IPC channel "${def.channel}" has no authority classification. ` +
          'Add it to AI_CHANNEL_AUTHORITY in ai/aiAuthzGate.ts — the permission its ' +
          "resource's scope and declared authority require, or PUBLIC with a reason.",
      );
    }
    if (authority === 'PUBLIC') return def;
    const central: EnterprisePermission | undefined = RUNTIME_CHANNEL_PERMISSIONS[def.channel];
    if (central !== undefined && central !== authority) {
      throw new Error(
        `AI IPC channel "${def.channel}" is classified "${authority}" here and ` +
          `"${central}" in ipc/runtimeAuthz.ts. One channel, one lock: reconcile them.`,
      );
    }
    // `Object.assign`, for the reason documented in `withMemoryAuthz`: spreading
    // the ~675-member handler union while widening `audit` to `boolean` trips
    // TS2590. The parameter type stays union-checked, which is the part that
    // enforces each channel's response contract.
    return Object.assign({}, def, {
      requireAuth: true,
      permission: authority,
      audit: def.audit === true || AI_WRITE_CHANNELS.has(def.channel),
    }) as SecureHandlerDef;
  });
}
