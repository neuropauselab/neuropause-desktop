/**
 * P20 — NeuroPause Platform v2 authorization gate.
 *
 * The commercial layer is read-only, so every channel requires `commercial:read`. This annotator maps each
 * `commercial:*` channel to that scope, forces `requireAuth: true`, and preserves every other handler field
 * — exactly like `withAutoOpsAuthz` / `withNetworkAuthz`. A channel missing from the map fails loudly at
 * startup, so a newly-added commercial channel can never ship silently unguarded. Enforcement rides the
 * existing RBAC spine (`secureBridge.authorize` → `enterprise.authorize`), which fails closed. P20
 * introduces no previously-ungated foreign subsystem to harden — the signals it reads (billing, license,
 * cloud, org, governance, usage, analytics) are already RBAC-gated; this gate covers P20's own new read
 * channels only.
 */
import type { EnterprisePermission, IpcChannelName } from '@neuropause/shared';
import { IpcChannel } from '@neuropause/shared';

const READ: EnterprisePermission = 'commercial:read';

/** Permission required by each commercial channel (all reads → commercial:read). */
export const COMMERCIAL_CHANNEL_PERMISSIONS: Partial<Record<IpcChannelName, EnterprisePermission>> = {
  [IpcChannel.CommercialOverview]: READ,
  [IpcChannel.CommercialSubscription]: READ,
  [IpcChannel.CommercialLicensing]: READ,
  [IpcChannel.CommercialBilling]: READ,
  [IpcChannel.CommercialMetering]: READ,
  [IpcChannel.CommercialDeployment]: READ,
  [IpcChannel.CommercialCustomers]: READ,
  [IpcChannel.CommercialAnalytics]: READ,
  [IpcChannel.CommercialReleases]: READ,
  [IpcChannel.CommercialAdministration]: READ,
  [IpcChannel.CommercialGovernance]: READ,
};

/**
 * Annotate commercial handler defs with their required permission and force `requireAuth`, preserving every
 * other field. Fails loudly at startup if a channel has no classification.
 */
export function withCommercialAuthz<T extends { channel: IpcChannelName }>(
  defs: readonly T[],
): (T & { permission: EnterprisePermission; requireAuth: true })[] {
  return defs.map((def) => {
    const permission = COMMERCIAL_CHANNEL_PERMISSIONS[def.channel];
    if (!permission) {
      throw new Error(`Commercial channel "${def.channel}" has no permission classification.`);
    }
    return { ...def, permission, requireAuth: true };
  });
}
