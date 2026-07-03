/**
 * Pilot subsystem: read the persisted pilot status and toggle it (audited).
 * Same handler-registration pattern as the other subsystems.
 */
import { EmptyRequest, IpcChannel, PilotSetEnabledRequest } from '@neuropause/shared';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { pilotService } from './pilotInstance';

export interface PilotSubsystem {
  handlers: SecureHandlerDef[];
}

export async function initPilot(): Promise<PilotSubsystem> {
  await pilotService.load();
  return { handlers: buildHandlers() };
}

function buildHandlers(): SecureHandlerDef[] {
  return [
    {
      channel: IpcChannel.PilotStatus,
      schema: EmptyRequest,
      handler: () => pilotService.getStatus(),
    },
    {
      channel: IpcChannel.PilotSetEnabled,
      schema: PilotSetEnabledRequest,
      audit: true,
      handler: (p) => pilotService.setEnabled((p as PilotSetEnabledRequest).enabled),
    },
  ];
}
