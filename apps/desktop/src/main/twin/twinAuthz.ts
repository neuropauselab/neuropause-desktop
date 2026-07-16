/**
 * P15 — Enterprise Digital Twin authorization gate.
 *
 * The twin layer is read-only, so every channel requires `twin:read`. This annotator maps each
 * `twin:*` channel to that scope, forces `requireAuth: true`, and preserves every other handler field
 * — exactly like `withStrategyAuthz` / `withIndustryAuthz` / `withCloudAuthz`. A channel missing from
 * the map fails loudly at startup, so a newly-added twin channel can never ship silently unguarded.
 * Enforcement rides the existing RBAC spine (`secureBridge.authorize` → `enterprise.authorize`), which
 * fails closed. P15 introduces no previously-ungated foreign subsystem to harden — the signals it reads
 * are already RBAC-gated; this gate covers P15's own new read channels only.
 */
import type { EnterprisePermission, IpcChannelName } from '@neuropause/shared';
import { IpcChannel } from '@neuropause/shared';

const READ: EnterprisePermission = 'twin:read';

/** Permission required by each twin channel (all reads → twin:read). */
export const TWIN_CHANNEL_PERMISSIONS: Partial<Record<IpcChannelName, EnterprisePermission>> = {
  [IpcChannel.TwinOverview]: READ,
  [IpcChannel.TwinDomains]: READ,
  [IpcChannel.TwinTopology]: READ,
  [IpcChannel.TwinHealth]: READ,
  [IpcChannel.TwinReplay]: READ,
  [IpcChannel.TwinScenario]: READ,
  [IpcChannel.TwinImpact]: READ,
  [IpcChannel.TwinExecutive]: READ,
};

/**
 * Annotate twin handler defs with their required permission and force `requireAuth`, preserving every
 * other field. Fails loudly at startup if a channel has no classification.
 */
export function withTwinAuthz<T extends { channel: IpcChannelName }>(
  defs: readonly T[],
): (T & { permission: EnterprisePermission; requireAuth: true })[] {
  return defs.map((def) => {
    const permission = TWIN_CHANNEL_PERMISSIONS[def.channel];
    if (!permission) {
      throw new Error(`Twin channel "${def.channel}" has no permission classification.`);
    }
    return { ...def, permission, requireAuth: true };
  });
}
