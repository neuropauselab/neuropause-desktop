/**
 * Federation Platform types (Phase 9 · Stage 2). The final architectural layer:
 * secure collaboration *across* organizations while preserving tenant isolation,
 * governance, and auditability.
 *
 * Seven areas: the federation runtime (peers, invitations, trust, shared
 * resources), the organization exchange (signed, versioned publishable
 * artifacts), the enterprise marketplace (visibility scopes), global governance
 * (cross-org policies + shared audit + delegated approvals), enterprise
 * observability, disaster recovery, and federation administration — plus a
 * scalability report.
 */
import type { CloudRegionId } from './cloud';

/* ════════════════════════════ Federation runtime ══════════════════════════ */

export type FederationRole = 'home' | 'peer';
export type FederationStatus = 'active' | 'invited' | 'suspended';
export type TrustLevel = 'none' | 'basic' | 'verified' | 'full';

export interface FederatedOrg {
  id: string;
  name: string;
  slug: string;
  role: FederationRole;
  status: FederationStatus;
  regionId: CloudRegionId;
  trustLevel: TrustLevel;
  joinedAt: string;
  sharedOut: number;
  sharedIn: number;
}

export type InvitationStatus = 'pending' | 'accepted' | 'declined' | 'revoked';
export type InvitationDirection = 'outbound' | 'inbound';

export interface OrgInvitation {
  id: string;
  fromOrg: string;
  fromOrgName: string;
  toOrg: string;
  toOrgName: string;
  direction: InvitationDirection;
  status: InvitationStatus;
  trustLevel: TrustLevel;
  message: string;
  createdAt: string;
  respondedAt: string | null;
}

export interface TrustRelationship {
  id: string;
  /**
   * P13C ROUND 4 — S-10. THE LOCAL SIDE OF THE RELATIONSHIP.
   *
   * A trust relationship is `ownerOrg` ↔ `peerOrg`. Only `peerOrg` existed,
   * because "the local side" was the install's single seeded organization —
   * which is exactly why every tenant saw every trust record.
   *
   * Optional: rows written before this round name only a peer, so they have no
   * local side and are visible to nobody rather than being guessed into one.
   */
  ownerOrg?: string | null;
  peerOrg: string;
  peerOrgName: string;
  trustLevel: TrustLevel;
  delegatedApproval: boolean;
  canShareWorkers: boolean;
  canShareData: boolean;
  establishedAt: string;
}

export type SharedResourceKind = 'project' | 'workspace' | 'ai_worker' | 'governance_policy' | 'connector';
export type ShareDirection = 'outbound' | 'inbound';
export type ShareAccess = 'read' | 'collaborate';

export interface SharedResource {
  id: string;
  /**
   * P13C ROUND 4 — S-10. THE ORGANIZATION THAT OWNS THE SHARED THING.
   *
   * A share is `ownerOrg` → `peerOrg`. Both sides may READ it — that is what
   * sharing means and why a plain `tenantId` filter would break the product —
   * but only the owner may revoke it outright. Unowned rows are visible to
   * nobody.
   */
  ownerOrg?: string | null;
  kind: SharedResourceKind;
  name: string;
  peerOrg: string;
  peerOrgName: string;
  direction: ShareDirection;
  access: ShareAccess;
  sharedAt: string;
}

export interface FederationSummary {
  orgs: number;
  peers: number;
  activePeers: number;
  pendingInvites: number;
  trustedPeers: number;
  sharedOut: number;
  sharedIn: number;
}

/* ════════════════════════════ Organization exchange ═══════════════════════ */

export type ExchangeKind = 'ai_worker' | 'connector_pack' | 'governance_policy' | 'workflow_template' | 'knowledge_package' | 'dashboard_template';
export const EXCHANGE_KINDS: readonly ExchangeKind[] = ['ai_worker', 'connector_pack', 'governance_policy', 'workflow_template', 'knowledge_package', 'dashboard_template'];

export type ExchangeScope = 'private' | 'public' | 'partner' | 'regional';
export type VerificationStatus = 'unverified' | 'verified' | 'official';

export interface ArtifactSignature {
  algorithm: 'ed25519';
  keyId: string;
  digest: string;
  signature: string;
  signedAt: string;
}

export type ExchangeVersionStatus = 'published' | 'rolled_back';

export interface ExchangeVersion {
  id: string;
  version: string;
  changelog: string;
  digest: string;
  signature: ArtifactSignature;
  status: ExchangeVersionStatus;
  publishedAt: string;
}

export interface ExchangeArtifact {
  id: string;
  /**
   * P13C ROUND 4 — S-10. WHO HAS INSTALLED THIS, BY ORGANIZATION.
   *
   * `installs` is an aggregate count and stays one: an install count is a
   * public marketplace signal, and hiding it would say nothing useful while
   * still being derivable from ratings. WHICH organizations installed is a
   * different fact, so it is a per-organization list the reader sees only its
   * own entry of.
   *
   * Installation never rewrites `publisherOrg`. Publisher ownership stays with
   * the publisher; installer ownership is recorded separately and alongside.
   */
  installations?: ArtifactInstallation[];
  kind: ExchangeKind;
  name: string;
  summary: string;
  publisherOrg: string;
  publisherOrgName: string;
  scope: ExchangeScope;
  verification: VerificationStatus;
  regionId: CloudRegionId | null;
  rating: number;
  ratingCount: number;
  installs: number;
  currentVersionId: string;
  versions: ExchangeVersion[];
  createdAt: string;
}

/** One organization's installation of an artifact published by another. */
export interface ArtifactInstallation {
  orgId: string;
  versionId: string;
  installedAt: string;
}

export interface ExchangeSummary {
  artifacts: number;
  byKind: Record<string, number>;
  published: number;
  verified: number;
  installs: number;
}

export interface MarketplaceScopeSummary {
  scope: ExchangeScope;
  artifacts: number;
  installs: number;
}

/* ════════════════════════════ Global governance ═══════════════════════════ */

export type FedPolicyScope = 'all' | 'trusted' | 'partner';
export type FedPolicyEffect = 'allow' | 'deny' | 'require_approval';

export interface FedPolicy {
  id: string;
  /**
   * P13C ROUND 4 — S-10. The organization whose federated actions this governs.
   *
   * Policies were install-wide, so one tenant's governance rules evaluated
   * another tenant's federated actions — and one tenant could disable another's
   * controls through `setPolicyEnabled(id, false)` on a bare id.
   *
   * Optional: pre-Round-4 rows have no owner and govern nobody.
   */
  ownerOrg?: string | null;
  /**
   * P13C ROUND 5 — F6. WHY THIS POLICY IS NOT BEING ENFORCED.
   *
   * A policy written before Round 4 has no `ownerOrg`, and Round 4's filter
   * dropped it from `listPolicies()` — which `recordAction` evaluates. So a
   * pre-existing DENY rule silently stopped being enforced, and nobody could
   * re-enable it because `setPolicyEnabled` filtered on the same list. That is
   * fail-OPEN on a control, and it is worse than fail-open on data: nothing
   * looks wrong.
   *
   * `migration_required` means the row is retained, counted and surfaced, and
   * governance evaluation FAILS CLOSED while any exist. Absent means owned.
   */
  migrationState?: 'migration_required';
  name: string;
  description: string;
  scope: FedPolicyScope;
  effect: FedPolicyEffect;
  action: string;
  enabled: boolean;
  createdAt: string;
}

export type FedComplianceStatus = 'pass' | 'warn' | 'fail';

export interface FedComplianceRule {
  id: string;
  framework: string;
  rule: string;
  status: FedComplianceStatus;
  detail: string;
}

export type DelegatedApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface DelegatedApproval {
  id: string;
  action: string;
  fromOrg: string;
  fromOrgName: string;
  toOrg: string;
  toOrgName: string;
  status: DelegatedApprovalStatus;
  requestedAt: string;
  resolvedAt: string | null;
  resolver: string | null;
}

export interface FedAuditEntry {
  id: string;
  at: string;
  actorOrg: string;
  actorOrgName: string;
  peerOrg: string | null;
  peerOrgName: string | null;
  action: string;
  decision: FedPolicyEffect;
  policyId: string | null;
  detail: string;
}

export interface GlobalGovSummary {
  policies: number;
  activePolicies: number;
  pendingApprovals: number;
  auditEntries: number;
  complianceScore: number;
}

export interface FedActionEvaluation {
  decision: FedPolicyEffect;
  policyId: string | null;
  reason: string;
}

/* ════════════════════════════ Enterprise observability ════════════════════ */

export type ObsSubsystemHealth = 'healthy' | 'degraded' | 'down';

export interface ObsSubsystem {
  id: string;
  label: string;
  status: ObsSubsystemHealth;
  metric: number;
  unit: string;
  detail: string;
}

export type SecuritySeverity = 'info' | 'warning' | 'critical';

export interface SecurityEvent {
  id: string;
  at: string;
  category: string;
  severity: SecuritySeverity;
  source: string;
  detail: string;
}

export interface UsagePoint {
  at: string;
  apiRequests: number;
  syncOps: number;
  workerJobs: number;
  events: number;
}

export interface ObservabilityOverview {
  subsystems: ObsSubsystem[];
  security: SecurityEvent[];
  usage: UsagePoint[];
  healthy: number;
  degraded: number;
  criticalEvents: number;
}

/* ════════════════════════════ Disaster recovery ═══════════════════════════ */

export type BackupScope = 'full' | 'incremental';
export type BackupStatus = 'complete' | 'in_progress' | 'failed';

export interface Backup {
  id: string;
  scope: BackupScope;
  status: BackupStatus;
  regionId: CloudRegionId;
  sizeBytes: number;
  objectCount: number;
  durationMs: number;
  createdAt: string;
}

export type ReplicationStatus = 'in_sync' | 'lagging' | 'failed';

export interface ReplicaState {
  regionId: CloudRegionId;
  status: ReplicationStatus;
  lagSeconds: number;
  lastReplicatedAt: string;
}

export type RecoveryValidationStatus = 'pass' | 'fail';

export interface RecoveryValidation {
  id: string;
  backupId: string;
  status: RecoveryValidationStatus;
  rpoSeconds: number;
  rtoSeconds: number;
  checkedItems: number;
  integrityOk: boolean;
  sandbox: boolean;
  validatedAt: string;
}

export interface ContinuityPosture {
  haEnabled: boolean;
  multiRegion: boolean;
  rpoTargetSeconds: number;
  rtoTargetSeconds: number;
  lastDrillAt: string | null;
  score: number;
}

export interface DrSummary {
  backups: number;
  lastBackupAt: string | null;
  replicas: number;
  inSync: number;
  lastValidationAt: string | null;
  continuityScore: number;
}

/* ════════════════════════════ Federation administration ═══════════════════ */

export interface FedAdminOverview {
  orgs: FederatedOrg[];
  peers: number;
  trustedPeers: number;
  pendingInvites: number;
  pendingApprovals: number;
  sharedOut: number;
  sharedIn: number;
  policies: number;
  complianceScore: number;
  openSecurityEvents: number;
  backups: number;
  replicasInSync: number;
}

/* ════════════════════════════ Scalability ═════════════════════════════════ */

export interface ScalabilityDimension {
  id: string;
  label: string;
  current: number;
  tested: number;
  limit: number;
  headroomPct: number;
  unit: string;
  note: string;
}

export interface ExtensionPoint {
  id: string;
  area: string;
  description: string;
}

export interface ScalabilityBenchmark {
  label: string;
  valueMs: number;
  budgetMs: number;
}

export interface ScalabilityReport {
  dimensions: ScalabilityDimension[];
  extensionPoints: ExtensionPoint[];
  benchmarks: ScalabilityBenchmark[];
  generatedAt: string;
}
