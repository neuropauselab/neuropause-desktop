/**
 * P19 — Autonomous Enterprise Operations authorization gate.
 *
 * The operations layer is read-only, so every channel requires `autonomousops:read`. This annotator maps
 * each `autonomousops:*` channel to that scope, forces `requireAuth: true`, and preserves every other
 * handler field — exactly like `withNetworkAuthz` / `withOrchestrationAuthz`. A channel missing from the
 * map fails loudly at startup, so a newly-added operations channel can never ship silently unguarded.
 * Enforcement rides the existing RBAC spine (`secureBridge.authorize` → `enterprise.authorize`), which
 * fails closed. P19 introduces no previously-ungated foreign subsystem to harden — the signals it reads
 * (ExecuteEngine, Workforce jobs/registry/audit, P7 intelligence, strategy, cloud, twin, knowledge,
 * approval surfaces) are already RBAC-gated; this gate covers P19's own new read channels only.
 */
import type { EnterprisePermission, IpcChannelName } from '@neuropause/shared';
import { IpcChannel } from '@neuropause/shared';

const READ: EnterprisePermission = 'autonomousops:read';

/** Permission required by each autonomous-operations channel (all reads → autonomousops:read). */
export const AUTOOPS_CHANNEL_PERMISSIONS: Partial<Record<IpcChannelName, EnterprisePermission>> = {
  [IpcChannel.AutoOpsOverview]: READ,
  [IpcChannel.AutoOpsPlans]: READ,
  [IpcChannel.AutoOpsExecution]: READ,
  [IpcChannel.AutoOpsRecovery]: READ,
  [IpcChannel.AutoOpsOptimization]: READ,
  [IpcChannel.AutoOpsIncidents]: READ,
  [IpcChannel.AutoOpsApprovals]: READ,
  [IpcChannel.AutoOpsMonitoring]: READ,
  [IpcChannel.AutoOpsAnalytics]: READ,
  [IpcChannel.AutoOpsGovernance]: READ,
};

/**
 * Annotate operations handler defs with their required permission and force `requireAuth`, preserving every
 * other field. Fails loudly at startup if a channel has no classification.
 */
export function withAutoOpsAuthz<T extends { channel: IpcChannelName }>(
  defs: readonly T[],
): (T & { permission: EnterprisePermission; requireAuth: true })[] {
  return defs.map((def) => {
    const permission = AUTOOPS_CHANNEL_PERMISSIONS[def.channel];
    if (!permission) {
      throw new Error(`Autonomous Operations channel "${def.channel}" has no permission classification.`);
    }
    return { ...def, permission, requireAuth: true };
  });
}
