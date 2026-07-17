/**
 * Experience Program v1.0 — authorization gate.
 *
 * The experience layer is read-only, so every channel requires `experience:read`. This annotator maps each
 * `experience:*` channel to that scope, forces `requireAuth: true`, and preserves every other handler field
 * — exactly like `withCommercialAuthz` / `withAutoOpsAuthz`. A channel missing from the map fails loudly at
 * startup, so a newly-added experience channel can never ship silently unguarded. Enforcement rides the
 * existing RBAC spine (`secureBridge.authorize` → `enterprise.authorize`), which fails closed. Every signal
 * the layer reads (P7/P14–P20 + workforce/connectors/marketplace) is already RBAC-gated; this gate covers
 * the experience layer's own new read channels only.
 */
import type { EnterprisePermission, IpcChannelName } from '@neuropause/shared';
import { IpcChannel } from '@neuropause/shared';

const READ: EnterprisePermission = 'experience:read';

/** Permission required by each experience channel (all reads → experience:read). */
export const EXPERIENCE_CHANNEL_PERMISSIONS: Partial<Record<IpcChannelName, EnterprisePermission>> = {
  [IpcChannel.ExperienceHome]: READ,
  [IpcChannel.ExperienceDecisions]: READ,
  [IpcChannel.ExperienceSummaries]: READ,
  [IpcChannel.ExperienceIntents]: READ,
  [IpcChannel.ExperienceGovernance]: READ,
};

/**
 * Annotate experience handler defs with their required permission and force `requireAuth`, preserving every
 * other field. Fails loudly at startup if a channel has no classification.
 */
export function withExperienceAuthz<T extends { channel: IpcChannelName }>(
  defs: readonly T[],
): (T & { permission: EnterprisePermission; requireAuth: true })[] {
  return defs.map((def) => {
    const permission = EXPERIENCE_CHANNEL_PERMISSIONS[def.channel];
    if (!permission) {
      throw new Error(`Experience channel "${def.channel}" has no permission classification.`);
    }
    return { ...def, permission, requireAuth: true };
  });
}
