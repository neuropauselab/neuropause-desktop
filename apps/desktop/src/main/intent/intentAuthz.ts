/**
 * Intent Experience Program v2.0 — authorization gate.
 *
 * The intent layer is read-only, so every channel requires `intent:read`. This annotator maps each
 * `intent:*` channel to that scope, forces `requireAuth: true`, and preserves every other handler field —
 * exactly like `withExperienceAuthz` / `withCommercialAuthz`. A channel missing from the map fails loudly at
 * startup, so a newly-added intent channel can never ship silently unguarded. Enforcement rides the existing
 * RBAC spine (`secureBridge.authorize` → `enterprise.authorize`), which fails closed. Every signal the layer
 * reads (the P14 strategy goals/plans/decisions/reasoning) is already RBAC-gated behind `strategy:read`;
 * this gate covers the intent layer's own new read channels only.
 */
import type { EnterprisePermission, IpcChannelName } from '@neuropause/shared';
import { IpcChannel } from '@neuropause/shared';

const READ: EnterprisePermission = 'intent:read';

/** Permission required by each intent channel (all reads → intent:read). */
export const INTENT_CHANNEL_PERMISSIONS: Partial<Record<IpcChannelName, EnterprisePermission>> = {
  [IpcChannel.IntentBoard]: READ,
  [IpcChannel.IntentWorkspaces]: READ,
  [IpcChannel.IntentGovernance]: READ,
};

/**
 * Annotate intent handler defs with their required permission and force `requireAuth`, preserving every
 * other field. Fails loudly at startup if a channel has no classification.
 */
export function withIntentAuthz<T extends { channel: IpcChannelName }>(
  defs: readonly T[],
): (T & { permission: EnterprisePermission; requireAuth: true })[] {
  return defs.map((def) => {
    const permission = INTENT_CHANNEL_PERMISSIONS[def.channel];
    if (!permission) {
      throw new Error(`Intent channel "${def.channel}" has no permission classification.`);
    }
    return { ...def, permission, requireAuth: true };
  });
}
