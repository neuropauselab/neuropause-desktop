/**
 * P16 — Enterprise Knowledge Fabric authorization gate.
 *
 * The fabric layer is read-only, so every channel requires `knowledge:read`. This annotator maps each
 * `fabric:*` channel to that scope, forces `requireAuth: true`, and preserves every other handler field
 * — exactly like `withTwinAuthz` / `withStrategyAuthz` / `withIndustryAuthz`. A channel missing from the
 * map fails loudly at startup, so a newly-added fabric channel can never ship silently unguarded.
 * Enforcement rides the existing RBAC spine (`secureBridge.authorize` → `enterprise.authorize`), which
 * fails closed. P16 introduces no previously-ungated foreign subsystem to harden — the signals it reads
 * (relationship graph, intelligence report, strategy, twin, timeline, memory) are already RBAC-gated;
 * this gate covers P16's own new read channels only.
 */
import type { EnterprisePermission, IpcChannelName } from '@neuropause/shared';
import { IpcChannel } from '@neuropause/shared';

const READ: EnterprisePermission = 'knowledge:read';

/** Permission required by each fabric channel (all reads → knowledge:read). */
export const KNOWLEDGE_CHANNEL_PERMISSIONS: Partial<Record<IpcChannelName, EnterprisePermission>> = {
  [IpcChannel.FabricOverview]: READ,
  [IpcChannel.FabricSources]: READ,
  [IpcChannel.FabricRelationships]: READ,
  [IpcChannel.FabricClassification]: READ,
  [IpcChannel.FabricLineage]: READ,
  [IpcChannel.FabricEvidence]: READ,
  [IpcChannel.FabricGovernance]: READ,
  [IpcChannel.FabricAnalytics]: READ,
};

/**
 * Annotate fabric handler defs with their required permission and force `requireAuth`, preserving every
 * other field. Fails loudly at startup if a channel has no classification.
 */
export function withKnowledgeAuthz<T extends { channel: IpcChannelName }>(
  defs: readonly T[],
): (T & { permission: EnterprisePermission; requireAuth: true })[] {
  return defs.map((def) => {
    const permission = KNOWLEDGE_CHANNEL_PERMISSIONS[def.channel];
    if (!permission) {
      throw new Error(`Knowledge fabric channel "${def.channel}" has no permission classification.`);
    }
    return { ...def, permission, requireAuth: true };
  });
}
