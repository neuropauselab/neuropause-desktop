/**
 * P18 — Enterprise Intelligence Network authorization gate.
 *
 * The network layer is read-only, so every channel requires `network:read`. This annotator maps each
 * `network:*` channel to that scope, forces `requireAuth: true`, and preserves every other handler field
 * — exactly like `withOrchestrationAuthz` / `withKnowledgeAuthz` / `withTwinAuthz`. A channel missing from
 * the map fails loudly at startup, so a newly-added network channel can never ship silently unguarded.
 * Enforcement rides the existing RBAC spine (`secureBridge.authorize` → `enterprise.authorize`), which
 * fails closed. P18 introduces no previously-ungated foreign subsystem to harden — the signals it reads
 * (knowledge fabric, industry, strategy, twin, orchestration, federation exchange/trust, marketplace) are
 * already RBAC-gated; this gate covers P18's own new read channels only.
 */
import type { EnterprisePermission, IpcChannelName } from '@neuropause/shared';
import { IpcChannel } from '@neuropause/shared';

const READ: EnterprisePermission = 'network:read';

/** Permission required by each network channel (all reads → network:read). */
export const NETWORK_CHANNEL_PERMISSIONS: Partial<Record<IpcChannelName, EnterprisePermission>> = {
  [IpcChannel.NetworkOverview]: READ,
  [IpcChannel.NetworkExchange]: READ,
  [IpcChannel.NetworkBenchmarks]: READ,
  [IpcChannel.NetworkInsights]: READ,
  [IpcChannel.NetworkTrust]: READ,
  [IpcChannel.NetworkOrganizations]: READ,
  [IpcChannel.NetworkCollective]: READ,
  [IpcChannel.NetworkGovernance]: READ,
};

/**
 * Annotate network handler defs with their required permission and force `requireAuth`, preserving every
 * other field. Fails loudly at startup if a channel has no classification.
 */
export function withNetworkAuthz<T extends { channel: IpcChannelName }>(
  defs: readonly T[],
): (T & { permission: EnterprisePermission; requireAuth: true })[] {
  return defs.map((def) => {
    const permission = NETWORK_CHANNEL_PERMISSIONS[def.channel];
    if (!permission) {
      throw new Error(`Enterprise Intelligence Network channel "${def.channel}" has no permission classification.`);
    }
    return { ...def, permission, requireAuth: true };
  });
}
