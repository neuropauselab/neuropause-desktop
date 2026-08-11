/**
 * P10 — Federation authorization gate.
 *
 * The existing federation runtime (Phase 9 · Stage 2) registered its ~44 IPC handlers with
 * only `audit: true` — no `requireAuth`, no `permission` — so they were protected by
 * sender-trust alone, unlike every enterprise and marketplace channel. This closes that gap:
 * it maps every federation channel (the existing `fed:*` surface plus the P10 `federation:*`
 * layer) to a `federation:read | federation:manage | federation:approve` scope and annotates
 * the handler defs, exactly like `withEnterpriseAuthz`. A federation channel missing from the
 * map fails loudly at startup — never silently unguarded.
 *
 * Reuses the existing RBAC spine: `secureBridgeDeps.authorize` (already wired to
 * `enterprise.authorize`) enforces the annotated permission and fails closed.
 */
import type { EnterprisePermission, IpcChannelName } from '@neuropause/shared';
import { IpcChannel } from '@neuropause/shared';

const READ: EnterprisePermission = 'federation:read';
const MANAGE: EnterprisePermission = 'federation:manage';
const APPROVE: EnterprisePermission = 'federation:approve';

/**
 * Permission required by each federation channel. Reads require `federation:read` (held by
 * every seeded human role); mutations require `federation:manage`; resolving a delegated
 * cross-org approval requires the dedicated `federation:approve` authority.
 */
export const FEDERATION_CHANNEL_PERMISSIONS: Partial<Record<IpcChannelName, EnterprisePermission>> = {
  /* ── Federation runtime ── */
  [IpcChannel.FedOrgs]: READ,
  [IpcChannel.FedSummary]: READ,
  [IpcChannel.FedInvitations]: READ,
  [IpcChannel.FedTrust]: READ,
  [IpcChannel.FedShared]: READ,
  [IpcChannel.FedInviteOrg]: MANAGE,
  [IpcChannel.FedRespondInvite]: MANAGE,
  [IpcChannel.FedSetTrust]: MANAGE,
  [IpcChannel.FedShareResource]: MANAGE,
  [IpcChannel.FedRevokeShare]: MANAGE,

  /* ── Organization exchange ── */
  [IpcChannel.FedArtifacts]: READ,
  [IpcChannel.FedExchangeSummary]: READ,
  [IpcChannel.FedVerifyVersion]: READ,
  [IpcChannel.FedPublishArtifact]: MANAGE,
  [IpcChannel.FedPublishVersion]: MANAGE,
  [IpcChannel.FedRateArtifact]: MANAGE,
  [IpcChannel.FedSetVerification]: MANAGE,
  [IpcChannel.FedRollbackArtifact]: MANAGE,
  [IpcChannel.FedInstallArtifact]: MANAGE,

  /* ── Enterprise marketplace scopes ── */
  [IpcChannel.FedScopeSummary]: READ,
  [IpcChannel.FedSetScope]: MANAGE,

  /* ── Global governance ── */
  [IpcChannel.FedPolicies]: READ,
  [IpcChannel.FedApprovals]: READ,
  [IpcChannel.FedAuditTrail]: READ,
  [IpcChannel.FedCompliance]: READ,
  [IpcChannel.FedGovSummary]: READ,
  [IpcChannel.FedAddPolicy]: MANAGE,
  [IpcChannel.FedSetPolicyEnabled]: MANAGE,
  // P13C Round 5 — F6. Reading the count is a read; resolving a quarantined
  // policy changes what governance enforces, so it is a manage operation.
  [IpcChannel.FedPolicyMigrationStatus]: READ,
  // The contents, unlike the count, are an administrator surface.
  [IpcChannel.FedQuarantinedPolicies]: MANAGE,
  [IpcChannel.FedClaimPolicy]: MANAGE,
  [IpcChannel.FedDiscardPolicy]: MANAGE,
  [IpcChannel.FedRecordAction]: MANAGE,
  [IpcChannel.FedResolveApproval]: APPROVE,

  /* ── Enterprise observability ── */
  [IpcChannel.FedObservability]: READ,
  [IpcChannel.FedUsageSeries]: READ,
  [IpcChannel.FedSecurityEvents]: READ,

  /* ── Disaster recovery ── */
  [IpcChannel.FedBackups]: READ,
  [IpcChannel.FedReplicas]: READ,
  [IpcChannel.FedValidations]: READ,
  [IpcChannel.FedContinuity]: READ,
  [IpcChannel.FedDrSummary]: READ,
  [IpcChannel.FedCreateBackup]: MANAGE,
  [IpcChannel.FedRunValidation]: MANAGE,
  [IpcChannel.FedCheckReplication]: MANAGE,

  /* ── Federation administration + scalability ── */
  [IpcChannel.FedAdminOverview]: READ,
  [IpcChannel.FedScalability]: READ,

  /* ── P10 — Federation Platform (intelligence/governance/integration layer) ── */
  [IpcChannel.FederationGraph]: READ,
  [IpcChannel.FederationTimeline]: READ,
  [IpcChannel.FederationDirectory]: READ,
  [IpcChannel.FederationAnalytics]: READ,
  [IpcChannel.FederationSearch]: READ,
  [IpcChannel.FederationOverview]: READ,
};

/**
 * Annotate federation handler defs with their required permission and force `requireAuth`,
 * preserving every other field (schema, handler, `audit`). Fails loudly at startup if a
 * channel has no classification — a new federation channel must be classified, never
 * silently left open.
 */
export function withFederationAuthz<T extends { channel: IpcChannelName }>(
  defs: readonly T[],
): (T & { permission: EnterprisePermission; requireAuth: true })[] {
  return defs.map((def) => {
    const permission = FEDERATION_CHANNEL_PERMISSIONS[def.channel];
    if (!permission) {
      throw new Error(`Federation channel "${def.channel}" has no permission classification.`);
    }
    return { ...def, permission, requireAuth: true };
  });
}
