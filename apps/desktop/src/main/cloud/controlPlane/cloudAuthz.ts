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

  /* ── Cloud synchronization (real live-sync engine) ── */
  [IpcChannel.LiveSyncStatus]: READ,
  [IpcChannel.LiveSyncDetail]: READ,
  [IpcChannel.LiveSyncNow]: MANAGE,
  [IpcChannel.LiveSyncSetOnline]: MANAGE,
  [IpcChannel.LiveSyncSetActiveOrg]: MANAGE,

  /* ── Enterprise API platform ── */
  [IpcChannel.CloudDeployments]: READ,
  [IpcChannel.CloudApiSummary]: READ,
  [IpcChannel.CloudRatePolicies]: READ,
  [IpcChannel.CloudSetPolicyEnabled]: MANAGE,
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
