/**
 * License subsystem. Loads the persisted validator and exposes IPC to read the
 * current (cache-re-evaluated) status and to refresh from the backend. Follows the
 * same handler-registration pattern as the other subsystems. Neither call throws to
 * the renderer for a failed refresh — the status carries lastError instead.
 */
import { IpcChannel, LicenseOrgRequest } from '@neuropause/shared';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { licenseValidator } from './licenseInstance';

export interface LicenseSubsystem {
  handlers: SecureHandlerDef[];
}

export async function initLicense(): Promise<LicenseSubsystem> {
  await licenseValidator.load();
  return { handlers: buildHandlers() };
}

function buildHandlers(): SecureHandlerDef[] {
  return [
    {
      channel: IpcChannel.LicenseStatus,
      schema: LicenseOrgRequest,
      handler: (p) => licenseValidator.getStatus((p as LicenseOrgRequest).orgId),
    },
    {
      channel: IpcChannel.LicenseRefresh,
      schema: LicenseOrgRequest,
      handler: (p) => licenseValidator.refresh((p as LicenseOrgRequest).orgId),
    },
  ];
}
