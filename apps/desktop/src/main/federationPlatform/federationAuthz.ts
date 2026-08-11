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
  /**
   * P13C ROUND 10 — NEW-F5. THE DISASTER-RECOVERY WRITES ARE INSTALL-WIDE.
   *
   * These were `federation:manage`, an ORGANIZATION role. The resource is one
   * `drStore` holding the machine's backups, replication topology and continuity
   * posture — it has no per-owner rows at all. Anyone may create an organization
   * and become its Owner, so an organization role over an install-wide,
   * side-effecting operation is a self-service grant: Round 9's F19 class.
   *
   * WHAT MADE THIS ONE DIFFERENT, AND WHY IT SAT HERE SINCE ROUND 4. The store's
   * own declaration has stated the cost in prose the whole time — *"a
   * federation:manage holder in one tenant can trigger an install-wide backup or
   * a recovery validation"*. That is the finding, written down and permitted.
   * PROSE CANNOT BE CHECKED. Round 10's retention/authority enums can, and
   * `declareStoreScope` refused the honest declaration until these three moved —
   * which is precisely what the enum was added to do.
   *
   * Same destination as every sibling this program has moved for the same
   * reason: `worker-registry` (the store F19 was written for), the plugin
   * lifecycle, the AI destination, `backup:restore`. `cloud:operate` is in
   * `PLATFORM_ONLY_PERMISSIONS` and is filtered out of the Owner wildcard, so no
   * organization role can hold it.
   *
   * THE READS ABOVE DID NOT MOVE. Seeing this machine's continuity posture is
   * something a member legitimately does; triggering a backup of it is not.
   */
  [IpcChannel.FedCreateBackup]: 'cloud:operate',
  [IpcChannel.FedRunValidation]: 'cloud:operate',
  [IpcChannel.FedCheckReplication]: 'cloud:operate',

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
