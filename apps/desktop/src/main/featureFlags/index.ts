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

export interface FeatureFlagsSubsystem {
  handlers: SecureHandlerDef[];
}

export async function initFeatureFlags(): Promise<FeatureFlagsSubsystem> {
  await flagService.load();
  return { handlers: buildHandlers() };
}

function buildHandlers(): SecureHandlerDef[] {
  return [
    {
      channel: IpcChannel.FlagsGet,
      schema: FlagsGetRequest,
      handler: (p) => flagService.evaluate((p as FlagsGetRequest).planTier),
    },
    {
      channel: IpcChannel.FlagsSetOverride,
      schema: FlagsSetOverrideRequest,
      audit: true,
      handler: async (p) => {
        const r = p as FlagsSetOverrideRequest;
        await flagService.setOverride(r.key, r.value);
        return flagService.evaluate(r.planTier);
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
