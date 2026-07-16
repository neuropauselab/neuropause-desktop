/**
 * P14 — Autonomous Enterprise Intelligence authorization gate.
 *
 * The strategy layer is read-only, so every channel requires `strategy:read`. This annotator maps
 * each `strategy:*` channel to that scope, forces `requireAuth: true`, and preserves every other
 * handler field — exactly like `withIndustryAuthz` / `withEcosystemAuthz` / `withCloudAuthz`. A
 * channel missing from the map fails loudly at startup, so a newly-added strategy channel can never
 * ship silently unguarded. Enforcement rides the existing RBAC spine (`secureBridge.authorize` →
 * `enterprise.authorize`), which fails closed.
 *
 * P14 introduces no previously-ungated foreign subsystem to harden — the signals it reads
 * (enterprise intelligence, cloud, workforce, connectors, marketplace, industry, federation,
 * governance) are already RBAC-gated. This gate covers P14's own new read channels only.
 */
import type { EnterprisePermission, IpcChannelName } from '@neuropause/shared';
import { IpcChannel } from '@neuropause/shared';

const READ: EnterprisePermission = 'strategy:read';

/** Permission required by each strategy channel (all reads → strategy:read). */
export const STRATEGY_CHANNEL_PERMISSIONS: Partial<Record<IpcChannelName, EnterprisePermission>> = {
  [IpcChannel.StrategyOverview]: READ,
  [IpcChannel.StrategyGoals]: READ,
  [IpcChannel.StrategyPlanning]: READ,
  [IpcChannel.StrategyReasoning]: READ,
  [IpcChannel.StrategyOptimization]: READ,
  [IpcChannel.StrategySimulation]: READ,
  [IpcChannel.StrategyDecisions]: READ,
};

/**
 * Annotate strategy handler defs with their required permission and force `requireAuth`, preserving
 * every other field. Fails loudly at startup if a channel has no classification.
 */
export function withStrategyAuthz<T extends { channel: IpcChannelName }>(
  defs: readonly T[],
): (T & { permission: EnterprisePermission; requireAuth: true })[] {
  return defs.map((def) => {
    const permission = STRATEGY_CHANNEL_PERMISSIONS[def.channel];
    if (!permission) {
      throw new Error(`Strategy channel "${def.channel}" has no permission classification.`);
    }
    return { ...def, permission, requireAuth: true };
  });
}
