/**
 * P13 — Industry Solution Platform authorization gate.
 *
 * The Industry Platform is a read-only projection layer, so every one of its channels requires the
 * `industry:read` permission. This annotator maps each `industry:*` channel to that scope, forces
 * `requireAuth: true`, and preserves every other handler field (schema, handler, audit) — exactly
 * like `withEcosystemAuthz` / `withCloudAuthz`. A channel missing from the map fails loudly at
 * startup, so a newly-added industry channel can never ship silently unguarded. Enforcement rides
 * the existing RBAC spine (`secureBridge.authorize` → `enterprise.authorize`), which fails closed.
 *
 * Note: unlike P10–P12, P13 introduces no previously-ungated foreign subsystem to harden — the
 * stores it reads (workforce, connectors, governance, marketplace) are already RBAC-gated. This
 * gate covers P13's own new read channels only.
 */
import type { EnterprisePermission, IpcChannelName } from '@neuropause/shared';
import { IpcChannel } from '@neuropause/shared';

const READ: EnterprisePermission = 'industry:read';

/** Permission required by each industry channel (all reads → industry:read). */
export const INDUSTRY_CHANNEL_PERMISSIONS: Partial<Record<IpcChannelName, EnterprisePermission>> = {
  [IpcChannel.IndustryOverview]: READ,
  [IpcChannel.IndustrySuites]: READ,
  [IpcChannel.IndustryKpis]: READ,
  [IpcChannel.IndustryCompliance]: READ,
  [IpcChannel.IndustryCollections]: READ,
  [IpcChannel.IndustryReadiness]: READ,
};

/**
 * Annotate industry handler defs with their required permission and force `requireAuth`, preserving
 * every other field. Fails loudly at startup if a channel has no classification.
 */
export function withIndustryAuthz<T extends { channel: IpcChannelName }>(
  defs: readonly T[],
): (T & { permission: EnterprisePermission; requireAuth: true })[] {
  return defs.map((def) => {
    const permission = INDUSTRY_CHANNEL_PERMISSIONS[def.channel];
    if (!permission) {
      throw new Error(`Industry channel "${def.channel}" has no permission classification.`);
    }
    return { ...def, permission, requireAuth: true };
  });
}
