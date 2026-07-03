/**
 * Shared helpers for the Federation surface: the tab model, tone metadata for
 * trust / status / verification / scope / policy / compliance / subsystem /
 * replication states, formatters, and nav prefs. Reuses the operations +
 * developer + workforce primitives so the Federation section matches the rest of
 * the app.
 */
import type { Meta } from '@renderer/developer/lib';
import type { OpsTone } from '@renderer/operations/lib';
import type {
  BackupScope,
  ExchangeKind,
  ExchangeScope,
  FedComplianceStatus,
  FedPolicyEffect,
  FederationStatus,
  InvitationStatus,
  ObsSubsystemHealth,
  RecoveryValidationStatus,
  ReplicationStatus,
  SecuritySeverity,
  SharedResourceKind,
  TrustLevel,
  VerificationStatus,
} from '@neuropause/shared';

export { formatMoney, formatNum } from '@renderer/developer/lib';
export { relativeTime, titleCase, formatPct, formatMs } from '@renderer/workforce/lib';
export { formatBytes, scoreTone } from '@renderer/cloud/lib';
export type { Meta } from '@renderer/developer/lib';

export type FederationTab = 'runtime' | 'exchange' | 'marketplace' | 'governance' | 'observability' | 'recovery' | 'admin';

export function trustLevelMeta(level: TrustLevel): Meta {
  switch (level) {
    case 'full':
      return { tone: 'purple', label: 'Full' };
    case 'verified':
      return { tone: 'blue', label: 'Verified' };
    case 'basic':
      return { tone: 'orange', label: 'Basic' };
    default:
      return { tone: 'gray', label: 'None' };
  }
}

export function federationStatusMeta(status: FederationStatus): Meta {
  switch (status) {
    case 'active':
      return { tone: 'green', label: 'Active' };
    case 'invited':
      return { tone: 'orange', label: 'Invited' };
    default:
      return { tone: 'red', label: 'Suspended' };
  }
}

export function invitationStatusMeta(status: InvitationStatus): Meta {
  switch (status) {
    case 'accepted':
      return { tone: 'green', label: 'Accepted' };
    case 'pending':
      return { tone: 'orange', label: 'Pending' };
    case 'declined':
      return { tone: 'red', label: 'Declined' };
    default:
      return { tone: 'gray', label: 'Revoked' };
  }
}

export function verificationMeta(status: VerificationStatus): Meta {
  switch (status) {
    case 'official':
      return { tone: 'purple', label: 'Official' };
    case 'verified':
      return { tone: 'blue', label: 'Verified' };
    default:
      return { tone: 'gray', label: 'Unverified' };
  }
}

export function scopeMeta(scope: ExchangeScope): Meta {
  switch (scope) {
    case 'public':
      return { tone: 'green', label: 'Public' };
    case 'partner':
      return { tone: 'blue', label: 'Partner' };
    case 'regional':
      return { tone: 'purple', label: 'Regional' };
    default:
      return { tone: 'gray', label: 'Private' };
  }
}

export function policyEffectMeta(effect: FedPolicyEffect): Meta {
  switch (effect) {
    case 'allow':
      return { tone: 'green', label: 'Allow' };
    case 'require_approval':
      return { tone: 'orange', label: 'Approval' };
    default:
      return { tone: 'red', label: 'Deny' };
  }
}

export function complianceMeta(status: FedComplianceStatus): Meta {
  switch (status) {
    case 'pass':
      return { tone: 'green', label: 'Pass' };
    case 'warn':
      return { tone: 'orange', label: 'Warn' };
    default:
      return { tone: 'red', label: 'Fail' };
  }
}

export function subsystemHealthMeta(health: ObsSubsystemHealth): Meta {
  switch (health) {
    case 'healthy':
      return { tone: 'green', label: 'Healthy' };
    case 'degraded':
      return { tone: 'orange', label: 'Degraded' };
    default:
      return { tone: 'red', label: 'Down' };
  }
}

export function replicationMeta(status: ReplicationStatus): Meta {
  switch (status) {
    case 'in_sync':
      return { tone: 'green', label: 'In sync' };
    case 'lagging':
      return { tone: 'orange', label: 'Lagging' };
    default:
      return { tone: 'red', label: 'Failed' };
  }
}

export function validationMeta(status: RecoveryValidationStatus): Meta {
  return status === 'pass' ? { tone: 'green', label: 'Pass' } : { tone: 'red', label: 'Fail' };
}

export function severityMeta(severity: SecuritySeverity): Meta {
  switch (severity) {
    case 'critical':
      return { tone: 'red', label: 'Critical' };
    case 'warning':
      return { tone: 'orange', label: 'Warning' };
    default:
      return { tone: 'gray', label: 'Info' };
  }
}

const KIND_LABEL: Record<ExchangeKind, string> = {
  ai_worker: 'AI Worker',
  connector_pack: 'Connector Pack',
  governance_policy: 'Governance Policy',
  workflow_template: 'Workflow Template',
  knowledge_package: 'Knowledge Package',
  dashboard_template: 'Dashboard Template',
};
export function exchangeKindLabel(kind: ExchangeKind): string {
  return KIND_LABEL[kind];
}

const SHARED_KIND_LABEL: Record<SharedResourceKind, string> = {
  project: 'Project',
  workspace: 'Workspace',
  ai_worker: 'AI Worker',
  governance_policy: 'Governance Policy',
  connector: 'Connector',
};
export function sharedKindLabel(kind: SharedResourceKind): string {
  return SHARED_KIND_LABEL[kind];
}

export function backupScopeMeta(scope: BackupScope): Meta {
  return scope === 'full' ? { tone: 'blue', label: 'Full' } : { tone: 'gray', label: 'Incremental' };
}

export function trustTone(level: TrustLevel): OpsTone {
  return trustLevelMeta(level).tone;
}

const NAV_KEY = 'np.federation.nav';
const ALL_TABS: FederationTab[] = ['runtime', 'exchange', 'marketplace', 'governance', 'observability', 'recovery', 'admin'];

export function loadFederationNav(): Set<FederationTab> {
  try {
    const raw = localStorage.getItem(NAV_KEY);
    if (!raw) return new Set(ALL_TABS);
    const parsed = JSON.parse(raw) as string[];
    const set = new Set(parsed.filter((x): x is FederationTab => (ALL_TABS as string[]).includes(x)));
    set.add('runtime');
    return set.size > 0 ? set : new Set(ALL_TABS);
  } catch {
    return new Set(ALL_TABS);
  }
}

export function saveFederationNav(tabs: Set<FederationTab>): void {
  try {
    localStorage.setItem(NAV_KEY, JSON.stringify([...tabs]));
  } catch {
    /* ignore */
  }
}
