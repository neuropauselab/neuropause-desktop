/**
 * Feature-flags subsystem. Loads the persisted flag service and exposes IPC to read
 * flags (evaluated against the caller-supplied plan tier) and to set/clear per-install
 * overrides. Follows the same handler-registration pattern as the other subsystems.
 */
import {
  FlagsClearOverrideRequest,
  FlagsGetRequest,
  FlagsSetOverrideRequest,
  IpcChannel,
} from '@neuropause/shared';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { flagService } from './flagInstance';
import type { PlanTier } from '@neuropause/shared';

export interface FeatureFlagDeps {
  /**
   * The CALLER'S plan tier, resolved from backend state.
   *
   * P13C Round 8. Injected rather than imported so this subsystem does not take a
   * dependency on the developer platform, and REQUIRED rather than optional: an
   * optional resolver defaults to something, and the default that existed was
   * "believe the renderer".
   */
  authoritativePlanTier: () => PlanTier;
}

export interface FeatureFlagsSubsystem {
  handlers: SecureHandlerDef[];
}

export async function initFeatureFlags(deps: FeatureFlagDeps): Promise<FeatureFlagsSubsystem> {
  await flagService.load();
  return { handlers: buildHandlers(deps) };
}

function buildHandlers(deps: FeatureFlagDeps): SecureHandlerDef[] {
  return [
    {
      channel: IpcChannel.FlagsGet,
      schema: FlagsGetRequest,
      /**
       * P13C ROUND 8 — THE RENDERER IS NOT AUTHORITATIVE FOR ENTITLEMENT.
       *
       * `planTier` came off the payload, so a renderer claiming
       * `planTier: 'enterprise'` was evaluated as enterprise regardless of what
       * the tenant actually pays for. The payload field is now IGNORED: the plan
       * is resolved from `developerStore.planFor()`, which reads the CALLER'S
       * tenant through its own bound scope.
       *
       * The field stays on the request schema deliberately — removing it would
       * break the renderer's typed call for no security benefit, and leaving it
       * unread is the honest record that it was once trusted. A renderer that
       * keeps sending it simply has no effect.
       */
      handler: () => flagService.evaluate(deps.authoritativePlanTier()),
    },
    {
      channel: IpcChannel.FlagsSetOverride,
      schema: FlagsSetOverrideRequest,
      audit: true,
      handler: async (p) => {
        const r = p as FlagsSetOverrideRequest;
        await flagService.setOverride(r.key, r.value);
        // Same rule: the override write is authorized elsewhere, and the
        // evaluation it returns uses the authoritative plan, not the claimed one.
        return flagService.evaluate(deps.authoritativePlanTier());
      },
    },
    {
      channel: IpcChannel.FlagsClearOverride,
      schema: FlagsClearOverrideRequest,
      audit: true,
      handler: async (p) => {
        const r = p as FlagsClearOverrideRequest;
        await flagService.clearOverride(r.key);
        return flagService.evaluate(r.planTier);
      },
    },
  ];
}
