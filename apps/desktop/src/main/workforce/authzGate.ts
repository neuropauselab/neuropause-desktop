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
  [IpcChannel.WorkforceInstallGet]: 'workforce:read',
  // Operate (run work).
  [IpcChannel.WorkforceJobRun]: 'workforce:operate',
  [IpcChannel.WorkforceWorkflowRun]: 'workforce:operate',
  [IpcChannel.WorkforceWorkflowResume]: 'workforce:operate',
  // Approve (human-in-the-loop decisions).
  [IpcChannel.WorkforceProposalApprove]: 'workforce:approve',
  [IpcChannel.WorkforceProposalReject]: 'workforce:approve',
  [IpcChannel.WorkforceWorkflowCheckpoint]: 'workforce:approve',
  /**
   * P8.5 install lifecycle — PLATFORM AUTHORITY. P13C ROUND 9 — F2.
   *
   * WHY THIS MOVED OFF `workforce:manage`
   *
   * The resource is ONE `workforce-installs.json` and ONE process-wide
   * `WorkerRegistry`. `uninstall` removes the package for EVERY tenant; a
   * `rollback` downgrades everyone's copy. `workforce:manage` is an organization
   * role — and anyone may create an organization and become its Owner, which
   * makes an organization role a self-service grant for an install-wide,
   * destructive, cross-tenant operation.
   *
   * The install store's own declaration argued the cost was acceptable "which is
   * the same property as uninstalling a plugin and is why that permission is
   * Admin/Owner only". Round 8 then moved the plugin install/enable/capability
   * channels to `cloud:operate` for exactly this reason. Same resource class,
   * opposite answers — so this is the sibling of that fix, not a new policy.
   *
   * DELIBERATELY THE SAME PERMISSION, NOT A NEW `workforce:operate-install`.
   * A second platform permission is a second thing to forget to check. The axis
   * that matters is organization-authority vs install-authority, and
   * `cloud:operate` already names it. It is in `PLATFORM_ONLY_PERMISSIONS`, so
   * `BUILT_IN_ROLE_SPECS` filters it out of the Owner wildcard and no
   * organization role can hold it.
   *
   * READS ARE UNCHANGED. `WorkforceInstalls` / `WorkforceInstallGet` stay on
   * `workforce:read`: knowing which packages this machine has is inventory a
   * member legitimately needs to run work. Only the WRITES moved.
   */
  [IpcChannel.WorkforceInstall]: 'cloud:operate',
  [IpcChannel.WorkforceInstallUpdate]: 'cloud:operate',
  [IpcChannel.WorkforceInstallEnable]: 'cloud:operate',
  [IpcChannel.WorkforceInstallDisable]: 'cloud:operate',
  [IpcChannel.WorkforceInstallRollback]: 'cloud:operate',
  [IpcChannel.WorkforceUninstall]: 'cloud:operate',
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
