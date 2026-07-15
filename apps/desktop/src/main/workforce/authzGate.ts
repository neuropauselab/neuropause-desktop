/**
 * P8.2 — AI Workforce authorization gate.
 *
 * Mirrors the enterprise authzGate pattern: a single classification map from each
 * `workforce:*` IPC channel to the `EnterprisePermission` scope it requires, plus a
 * `withWorkforceAuthz` annotator that stamps `requireAuth` + `permission` + `audit`
 * onto every handler def from that map — and THROWS at composition time if a
 * `workforce:*` channel ships unclassified. This makes "no unguarded workforce
 * channel" a startup + CI invariant rather than relying on reviewer diligence, and
 * reuses the existing secure-bridge enforcement (no new auth path, no new scopes).
 *
 * Scope model: reads (list/get/audit/policies/intelligence/delegate/workflow-runs/
 * installs) → `workforce:read`; mutations that run work (job/workflow run + resume) →
 * `workforce:operate`; human approvals (proposal approve/reject, checkpoint) →
 * `workforce:approve`; P8.5 install/lifecycle (install/update/enable/disable/rollback/
 * uninstall) → the high-privilege `workforce:manage` (Admin/Owner only).
 */
import { IpcChannel, type EnterprisePermission } from '@neuropause/shared';
import type { SecureHandlerDef } from '../ipc/secureBridge';

/** Every invokable `workforce:*` channel → its required permission. */
export const WORKFORCE_CHANNEL_PERMISSIONS: Partial<Record<string, EnterprisePermission>> = {
  // Reads.
  [IpcChannel.WorkforceWorkers]: 'workforce:read',
  [IpcChannel.WorkforceWorkerGet]: 'workforce:read',
  [IpcChannel.WorkforceIntelligence]: 'workforce:read',
  [IpcChannel.WorkforceJobs]: 'workforce:read',
  [IpcChannel.WorkforceJobGet]: 'workforce:read',
  [IpcChannel.WorkforceWorkflowRuns]: 'workforce:read',
  [IpcChannel.WorkforceAudit]: 'workforce:read',
  [IpcChannel.WorkforcePolicies]: 'workforce:read',
  [IpcChannel.WorkforceDelegatePlan]: 'workforce:read',
  [IpcChannel.WorkforceInstalls]: 'workforce:read',
  // Operate (run work).
  [IpcChannel.WorkforceJobRun]: 'workforce:operate',
  [IpcChannel.WorkforceWorkflowRun]: 'workforce:operate',
  [IpcChannel.WorkforceWorkflowResume]: 'workforce:operate',
  // Approve (human-in-the-loop decisions).
  [IpcChannel.WorkforceProposalApprove]: 'workforce:approve',
  [IpcChannel.WorkforceProposalReject]: 'workforce:approve',
  [IpcChannel.WorkforceWorkflowCheckpoint]: 'workforce:approve',
  // P8.5 — install lifecycle (high-privilege management).
  [IpcChannel.WorkforceInstall]: 'workforce:manage',
  [IpcChannel.WorkforceInstallUpdate]: 'workforce:manage',
  [IpcChannel.WorkforceInstallEnable]: 'workforce:manage',
  [IpcChannel.WorkforceInstallDisable]: 'workforce:manage',
  [IpcChannel.WorkforceInstallRollback]: 'workforce:manage',
  [IpcChannel.WorkforceUninstall]: 'workforce:manage',
};

/**
 * Stamp authn + authz + audit onto every workforce handler from the map. Throws if
 * a `workforce:*` channel has no classification — a ship-time guard against an
 * unguarded surface. Reuses the secure-bridge `requireAuth`/`permission`/`audit`
 * fields; adds no new enforcement mechanism.
 */
export function withWorkforceAuthz(defs: SecureHandlerDef[]): SecureHandlerDef[] {
  return defs.map((def) => {
    const permission = WORKFORCE_CHANNEL_PERMISSIONS[def.channel];
    if (!permission) {
      throw new Error(
        `Workforce IPC channel "${def.channel}" has no permission classification. ` +
          `Add it to WORKFORCE_CHANNEL_PERMISSIONS in workforce/authzGate.ts.`,
      );
    }
    return { ...def, requireAuth: true, permission, audit: true };
  });
}
