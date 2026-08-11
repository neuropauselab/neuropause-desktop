/**
 * P11 — Cloud authorization gate.
 *
 * The existing Cloud Platform (Phase 9 · Stage 1) registered its 46 `cloud:*` / `livesync:*` IPC
 * handlers with NO `requireAuth` and NO `permission` (only 9 carried `audit`), so they were
 * protected by sender-trust alone — unlike every enterprise / marketplace / federation channel.
 * This closes that gap: it maps every cloud channel (the existing surface plus the P11
 * `cloud:cp.*` control-plane layer) to `cloud:read` (reads) or `cloud:manage` (mutations /
 * operational actions) and annotates the handler defs, exactly like `withEnterpriseAuthz` /
 * `withFederationAuthz`. A cloud channel missing from the map fails loudly at startup — never
 * silently unguarded. Reuses the existing RBAC spine (`secureBridge.authorize` → `enterprise
 * .authorize`), which fails closed.
 */
import type { EnterprisePermission, IpcChannelName } from '@neuropause/shared';
import { IpcChannel } from '@neuropause/shared';

const READ: EnterprisePermission = 'cloud:read';
const MANAGE: EnterprisePermission = 'cloud:manage';
/** Install-level. See `platformOperatorRegistry.ts`. No org role can hold it. */
const OPERATE: EnterprisePermission = 'cloud:operate';

/** Permission required by each cloud channel. Reads → cloud:read; mutations/operations → cloud:manage. */
export const CLOUD_CHANNEL_PERMISSIONS: Partial<Record<IpcChannelName, EnterprisePermission>> = {
  /* ── Multi-tenant runtime ── */
  [IpcChannel.CloudRegions]: READ,
  [IpcChannel.CloudTenants]: READ,
  [IpcChannel.CloudTenantSummary]: READ,
  [IpcChannel.CloudCreateTenant]: MANAGE,
  [IpcChannel.CloudSetTenantStatus]: MANAGE,
  [IpcChannel.CloudProjects]: READ,
  [IpcChannel.CloudCreateProject]: MANAGE,
  [IpcChannel.CloudDeleteProject]: MANAGE,
  [IpcChannel.CloudTeams]: READ,
  [IpcChannel.CloudCreateTeam]: MANAGE,
  [IpcChannel.CloudTenantWorkers]: READ,
  [IpcChannel.CloudStorageIsolation]: READ,

  /* ── Identity federation (SSO / SCIM / MFA) ── */
  [IpcChannel.CloudSsoConnections]: READ,
  [IpcChannel.CloudIdentitySummary]: READ,
  [IpcChannel.CloudCreateSso]: MANAGE,
  [IpcChannel.CloudUpdateSso]: MANAGE,
  [IpcChannel.CloudDeleteSso]: MANAGE,
  [IpcChannel.CloudTestSso]: READ,
  [IpcChannel.CloudScim]: READ,
  [IpcChannel.CloudSetScim]: MANAGE,
  [IpcChannel.CloudScimSync]: MANAGE,
  [IpcChannel.CloudMfa]: READ,
  [IpcChannel.CloudSetMfa]: MANAGE,

  /**
   * ── Cloud synchronization (real live-sync engine) ──
   *
   * P13C ROUND 9 — F3. THESE FIVE STAY BELOW `cloud:operate`, DELIBERATELY.
   *
   * Round 7 moved one channel up to `cloud:operate` because a rate-limit policy
   * governs the SHARED runtime and has no per-tenant form: whoever disables one
   * decides for every organization, so no organization role can hold it.
   *
   * The live-sync channels are the opposite shape once the resources behind them
   * are scoped. "How much of MY organization's data is queued", "sync MY
   * organization now", "stop MY organization's records leaving this device" are
   * decisions about one customer's own data, and taking them to a platform-only
   * permission would put a customer's data-protection choice in the hands of
   * whoever administers the machine. So the fix for F3 was to scope the
   * RESOURCES — a per-organization pause, per-organization status, cursor,
   * conflicts and queue, all resolved from the caller's own seam — rather than
   * to raise the permission over a shared one.
   *
   * `LiveSyncSetActiveOrg` remains `cloud:manage` and remains additionally
   * refused unless the requested organization is the session's own (see
   * `cloud/index.ts`); null, which means "stop", is the only value that reaches
   * the shared loop, and stopping egress is the safe direction.
   */
  [IpcChannel.LiveSyncStatus]: READ,
  [IpcChannel.LiveSyncDetail]: READ,
  [IpcChannel.LiveSyncNow]: MANAGE,
  [IpcChannel.LiveSyncSetOnline]: MANAGE,
  [IpcChannel.LiveSyncSetActiveOrg]: MANAGE,

  /* ── Enterprise API platform ── */
  [IpcChannel.CloudDeployments]: READ,
  [IpcChannel.CloudApiSummary]: READ,
  [IpcChannel.CloudRatePolicies]: READ,
  /**
   * P13C ROUND 7 — OPERATE, NOT MANAGE.
   *
   * The only channel in this table above `cloud:manage`. A rate-limit policy
   * governs the SHARED runtime, so disabling one is a decision made on behalf of
   * every organization on the machine — and `cloud:manage` is held by each of
   * their Admins independently. `cloud:operate` cannot be held by an
   * organization role at all (`PLATFORM_ONLY_PERMISSIONS`), so tenant A's Admin,
   * tenant B's Admin, and an Owner of either are all refused identically.
   */
  [IpcChannel.CloudSetPolicyEnabled]: OPERATE,
  [IpcChannel.CloudWebhooks]: READ,
  [IpcChannel.CloudCreateWebhook]: MANAGE,
  [IpcChannel.CloudSetWebhookStatus]: MANAGE,
  [IpcChannel.CloudDeleteWebhook]: MANAGE,
  [IpcChannel.CloudTestWebhook]: MANAGE,
  [IpcChannel.CloudPublicApis]: READ,

  /* ── Enterprise administration ── */
  [IpcChannel.CloudAdminOverview]: READ,
  [IpcChannel.CloudAdminCompliance]: READ,

  /* ── P11 — Cloud Control Plane (management rollup) ── */
  [IpcChannel.ControlPlaneOverview]: READ,
  [IpcChannel.ControlPlaneFleet]: READ,
  [IpcChannel.ControlPlaneRegions]: READ,
  [IpcChannel.ControlPlaneTenants]: READ,
  [IpcChannel.ControlPlaneDeployments]: READ,
  [IpcChannel.ControlPlaneUsage]: READ,
};

/**
 * Annotate cloud handler defs with their required permission and force `requireAuth`, preserving
 * every other field (schema, handler, `audit`). Fails loudly at startup if a channel has no
 * classification — a new cloud channel must be classified, never silently left open.
 */
export function withCloudAuthz<T extends { channel: IpcChannelName }>(
  defs: readonly T[],
): (T & { permission: EnterprisePermission; requireAuth: true })[] {
  return defs.map((def) => {
    const permission = CLOUD_CHANNEL_PERMISSIONS[def.channel];
    if (!permission) {
      throw new Error(`Cloud channel "${def.channel}" has no permission classification.`);
    }
    return { ...def, permission, requireAuth: true };
  });
}
