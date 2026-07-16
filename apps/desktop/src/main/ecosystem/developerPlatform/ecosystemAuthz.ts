/**
 * P12 — Ecosystem / Developer Platform authorization gate.
 *
 * The Ecosystem Platform (Phase 8) registered its 55 `ecosystem:*` IPC handlers with NO
 * `requireAuth` and NO `permission` (only ~24 carried `audit`), so publishing, key/OAuth minting,
 * billing changes, installs, and purchases were protected by sender-trust alone — unlike every
 * enterprise / marketplace / federation / cloud channel. This closes that gap: it maps every
 * ecosystem channel (the existing surface plus the P12 `ecosystem:devplatform.*` layer) to
 * `developer:read` (reads) or `developer:manage` (mutations / privileged actions) and annotates
 * the handler defs, exactly like `withCloudAuthz` / `withFederationAuthz`. An ecosystem channel
 * missing from the map fails loudly at startup — never silently unguarded. Reuses the existing
 * RBAC spine (`secureBridge.authorize` → `enterprise.authorize`), which fails closed.
 */
import type { EnterprisePermission, IpcChannelName } from '@neuropause/shared';
import { IpcChannel } from '@neuropause/shared';

const READ: EnterprisePermission = 'developer:read';
const MANAGE: EnterprisePermission = 'developer:manage';

/** Permission required by each ecosystem channel. Reads → developer:read; mutations → developer:manage. */
export const ECOSYSTEM_CHANNEL_PERMISSIONS: Partial<Record<IpcChannelName, EnterprisePermission>> = {
  /* ── Developer portal ── */
  [IpcChannel.EcosystemDeveloperDashboard]: READ,
  [IpcChannel.EcosystemDeveloperAccount]: READ,
  [IpcChannel.EcosystemDeveloperSetPlan]: MANAGE,
  [IpcChannel.EcosystemKeysList]: READ,
  [IpcChannel.EcosystemKeysCreate]: MANAGE,
  [IpcChannel.EcosystemKeysRevoke]: MANAGE,
  [IpcChannel.EcosystemKeysRotate]: MANAGE,
  [IpcChannel.EcosystemOAuthList]: READ,
  [IpcChannel.EcosystemOAuthCreate]: MANAGE,
  [IpcChannel.EcosystemOAuthDelete]: MANAGE,
  [IpcChannel.EcosystemOAuthToken]: MANAGE,
  [IpcChannel.EcosystemOAuthRevokeToken]: MANAGE,
  [IpcChannel.EcosystemUsageAnalytics]: READ,
  [IpcChannel.EcosystemSdks]: READ,

  /* ── Marketplace publishing ── */
  [IpcChannel.EcosystemMarketplaceList]: READ,
  [IpcChannel.EcosystemMarketplaceDetail]: READ,
  [IpcChannel.EcosystemMarketplaceStats]: READ,
  [IpcChannel.EcosystemMarketplaceEvents]: READ,
  [IpcChannel.EcosystemListingCreate]: MANAGE,
  [IpcChannel.EcosystemVersionCreate]: MANAGE,
  [IpcChannel.EcosystemListingSubmit]: MANAGE,
  [IpcChannel.EcosystemListingReview]: MANAGE,
  [IpcChannel.EcosystemListingPublish]: MANAGE,
  [IpcChannel.EcosystemListingRollback]: MANAGE,
  [IpcChannel.EcosystemListingInstall]: MANAGE,
  [IpcChannel.EcosystemListingRate]: MANAGE,

  /* ── API gateway ── */
  [IpcChannel.EcosystemGatewayVersions]: READ,
  [IpcChannel.EcosystemGatewayRequest]: MANAGE,
  [IpcChannel.EcosystemGatewayAudit]: READ,
  [IpcChannel.EcosystemGatewayMetrics]: READ,

  /* ── Billing & licensing ── */
  [IpcChannel.EcosystemBillingSummary]: READ,
  [IpcChannel.EcosystemBillingPlans]: READ,
  [IpcChannel.EcosystemBillingSetPlan]: MANAGE,
  [IpcChannel.EcosystemBillingInvoice]: READ,
  [IpcChannel.EcosystemBillingSeats]: READ,
  [IpcChannel.EcosystemBillingAssignSeat]: MANAGE,
  [IpcChannel.EcosystemBillingReleaseSeat]: MANAGE,
  [IpcChannel.EcosystemBillingLicenses]: READ,
  [IpcChannel.EcosystemBillingPurchase]: MANAGE,
  [IpcChannel.EcosystemBillingPurchases]: READ,

  /* ── Ecosystem exchange: installs ── */
  [IpcChannel.EcosystemInstallsList]: READ,
  [IpcChannel.EcosystemInstallsSummary]: READ,
  [IpcChannel.EcosystemInstall]: MANAGE,
  [IpcChannel.EcosystemInstallUpdate]: MANAGE,
  [IpcChannel.EcosystemInstallSetEnabled]: MANAGE,
  [IpcChannel.EcosystemUninstall]: MANAGE,
  [IpcChannel.EcosystemShareWorker]: MANAGE,

  /* ── Organization exchange (packs) ── */
  [IpcChannel.EcosystemPacksList]: READ,
  [IpcChannel.EcosystemPacksStats]: READ,
  [IpcChannel.EcosystemPackPublish]: MANAGE,
  [IpcChannel.EcosystemPackImport]: MANAGE,
  [IpcChannel.EcosystemPackRemove]: MANAGE,

  /* ── Partners + analytics ── */
  [IpcChannel.EcosystemPartnersList]: READ,
  [IpcChannel.EcosystemPartnersStats]: READ,
  [IpcChannel.EcosystemAnalytics]: READ,

  /* ── P12 — Developer Platform (registry/rollup layer) ── */
  [IpcChannel.DevPlatformOverview]: READ,
  [IpcChannel.DevPlatformConsole]: READ,
  [IpcChannel.DevPlatformSdks]: READ,
  [IpcChannel.DevPlatformApis]: READ,
  [IpcChannel.DevPlatformTemplates]: READ,
  [IpcChannel.DevPlatformPublishing]: READ,
  [IpcChannel.DevPlatformAnalytics]: READ,
};

/**
 * Annotate ecosystem handler defs with their required permission and force `requireAuth`,
 * preserving every other field (schema, handler, `audit`). Fails loudly at startup if a channel
 * has no classification — a new ecosystem channel must be classified, never silently left open.
 */
export function withEcosystemAuthz<T extends { channel: IpcChannelName }>(
  defs: readonly T[],
): (T & { permission: EnterprisePermission; requireAuth: true })[] {
  return defs.map((def) => {
    const permission = ECOSYSTEM_CHANNEL_PERMISSIONS[def.channel];
    if (!permission) {
      throw new Error(`Ecosystem channel "${def.channel}" has no permission classification.`);
    }
    return { ...def, permission, requireAuth: true };
  });
}
