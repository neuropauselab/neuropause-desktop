/**
 * P17 — Global AI Orchestration Platform authorization gate.
 *
 * The orchestration layer is read-only, so every channel requires `orchestration:read`. This annotator
 * maps each `orchestration:*` channel to that scope, forces `requireAuth: true`, and preserves every
 * other handler field — exactly like `withKnowledgeAuthz` / `withTwinAuthz` / `withStrategyAuthz`. A
 * channel missing from the map fails loudly at startup, so a newly-added orchestration channel can never
 * ship silently unguarded. Enforcement rides the existing RBAC spine (`secureBridge.authorize` →
 * `enterprise.authorize`), which fails closed. P17 introduces no previously-ungated foreign subsystem to
 * harden — the signals it reads (strategy, workforce, cloud, knowledge, twin, marketplace, federation)
 * are already RBAC-gated; this gate covers P17's own new read channels only.
 */
import type { EnterprisePermission, IpcChannelName } from '@neuropause/shared';
import { IpcChannel } from '@neuropause/shared';

const READ: EnterprisePermission = 'orchestration:read';

/** Permission required by each orchestration channel (all reads → orchestration:read). */
export const ORCHESTRATION_CHANNEL_PERMISSIONS: Partial<Record<IpcChannelName, EnterprisePermission>> = {
  [IpcChannel.OrchestrationOverview]: READ,
  [IpcChannel.OrchestrationGoals]: READ,
  [IpcChannel.OrchestrationWorkforce]: READ,
  [IpcChannel.OrchestrationCloud]: READ,
  [IpcChannel.OrchestrationKnowledge]: READ,
  [IpcChannel.OrchestrationFlows]: READ,
  [IpcChannel.OrchestrationCoordination]: READ,
  [IpcChannel.OrchestrationGovernance]: READ,
};

/**
 * Annotate orchestration handler defs with their required permission and force `requireAuth`, preserving
 * every other field. Fails loudly at startup if a channel has no classification.
 */
export function withOrchestrationAuthz<T extends { channel: IpcChannelName }>(
  defs: readonly T[],
): (T & { permission: EnterprisePermission; requireAuth: true })[] {
  return defs.map((def) => {
    const permission = ORCHESTRATION_CHANNEL_PERMISSIONS[def.channel];
    if (!permission) {
      throw new Error(`Global orchestration channel "${def.channel}" has no permission classification.`);
    }
    return { ...def, permission, requireAuth: true };
  });
}
