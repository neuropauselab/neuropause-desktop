/**
 * License subsystem. Loads the persisted validator and exposes IPC to read the
 * current (cache-re-evaluated) status and to refresh from the backend. Follows the
 * same handler-registration pattern as the other subsystems. Neither call throws to
 * the renderer for a failed refresh — the status carries lastError instead.
 */
import { IpcChannel, LicenseOrgRequest } from '@neuropause/shared';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { licenseValidator } from './licenseInstance';
import { activeTenantScope } from '../enterprise/index';

export interface LicenseSubsystem {
  handlers: SecureHandlerDef[];
}

export async function initLicense(): Promise<LicenseSubsystem> {
  await licenseValidator.load();
  return { handlers: buildHandlers() };
}

function buildHandlers(): SecureHandlerDef[] {
  return [
    /**
     * P13C REMEDIATION — N2. THE ORGANIZATION IS THE CALLER'S, NOT THE PAYLOAD'S.
     *
     * Both channels took `orgId` from the request and both sit on the PUBLIC
     * allowlist — no `requireAuth`, no permission. So any renderer message
     * could read plan tier, entitled plan, subscription state, grace days and
     * period end for ANY cached organization id, and `refresh` additionally
     * drove `GET /license/:orgId` with the signed-in session's token, making it
     * an existence oracle for arbitrary ids and a network-side-effecting write
     * classified as a read.
     *
     * The payload id is now ignored entirely. `activeTenantScope()` resolves
     * server-side, so there is no parameter left for a caller to supply — the
     * same reasoning that removed `organizationId` as authority from workspace
     * creation in P11. An unresolved caller gets the empty id, which matches no
     * cached organization and refreshes nothing.
     *
     * The request schema is unchanged so older renderers keep validating; the
     * field is simply no longer read. Narrowing the contract would break them
     * without closing anything this does not already close.
     */
    {
      channel: IpcChannel.LicenseStatus,
      schema: LicenseOrgRequest,
      handler: () => licenseValidator.getStatus(activeTenantScope()?.tenantId ?? ''),
    },
    {
      channel: IpcChannel.LicenseRefresh,
      schema: LicenseOrgRequest,
      handler: () => licenseValidator.refresh(activeTenantScope()?.tenantId ?? ''),
    },
  ];
}
