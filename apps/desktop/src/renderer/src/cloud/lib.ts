/**
 * Shared helpers for the Cloud surface: tab model, tone metadata for tenant /
 * identity / sync / deployment / compliance states, formatters, and nav prefs.
 * Reuses the operations + developer + workforce primitives so the Cloud section
 * matches the rest of the app.
 */
import type { Meta } from '@renderer/developer/lib';
import type { OpsTone } from '@renderer/operations/lib';
import type {
  CloudComplianceStatus,
  DataResidency,
  DeploymentStatus,
  MfaMethod,
  SsoProtocol,
  SsoStatus,
  SyncStatus,
  TenantStatus,
  TenantTier,
  WebhookStatus,
} from '@neuropause/shared';

export { formatMoney, formatNum } from '@renderer/developer/lib';
export { relativeTime, titleCase, formatPct, formatMs } from '@renderer/workforce/lib';
export type { Meta } from '@renderer/developer/lib';

export type CloudTab = 'tenants' | 'identity' | 'sync' | 'apiplatform' | 'admin';

export function tenantTierMeta(tier: TenantTier): Meta {
  switch (tier) {
    case 'enterprise':
      return { tone: 'purple', label: 'Enterprise' };
    case 'business':
      return { tone: 'blue', label: 'Business' };
    default:
      return { tone: 'gray', label: 'Free' };
  }
}

export function tenantStatusMeta(status: TenantStatus): Meta {
  switch (status) {
    case 'active':
      return { tone: 'green', label: 'Active' };
    case 'provisioning':
      return { tone: 'orange', label: 'Provisioning' };
    default:
      return { tone: 'red', label: 'Suspended' };
  }
}

export function residencyMeta(residency: DataResidency): Meta {
  switch (residency) {
    case 'eu':
      return { tone: 'blue', label: 'EU' };
    case 'apac':
      return { tone: 'purple', label: 'APAC' };
    default:
      return { tone: 'green', label: 'US' };
  }
}

export function ssoProtocolMeta(protocol: SsoProtocol): Meta {
  return protocol === 'saml' ? { tone: 'purple', label: 'SAML' } : { tone: 'blue', label: 'OIDC' };
}

export function ssoStatusMeta(status: SsoStatus): Meta {
  switch (status) {
    case 'active':
      return { tone: 'green', label: 'Active' };
    case 'error':
      return { tone: 'red', label: 'Error' };
    default:
      return { tone: 'gray', label: 'Disabled' };
  }
}

export function syncStatusMeta(status: SyncStatus): Meta {
  switch (status) {
    case 'synced':
      return { tone: 'green', label: 'Synced' };
    case 'syncing':
      return { tone: 'blue', label: 'Syncing' };
    case 'pending':
      return { tone: 'orange', label: 'Pending' };
    case 'conflict':
      return { tone: 'red', label: 'Conflict' };
    default:
      return { tone: 'gray', label: 'Offline' };
  }
}

export function deploymentStatusMeta(status: DeploymentStatus): Meta {
  switch (status) {
    case 'healthy':
      return { tone: 'green', label: 'Healthy' };
    case 'degraded':
      return { tone: 'orange', label: 'Degraded' };
    default:
      return { tone: 'red', label: 'Down' };
  }
}

export function webhookStatusMeta(status: WebhookStatus): Meta {
  switch (status) {
    case 'active':
      return { tone: 'green', label: 'Active' };
    case 'paused':
      return { tone: 'gray', label: 'Paused' };
    default:
      return { tone: 'red', label: 'Failing' };
  }
}

export function complianceStatusMeta(status: CloudComplianceStatus): Meta {
  switch (status) {
    case 'pass':
      return { tone: 'green', label: 'Pass' };
    case 'warn':
      return { tone: 'orange', label: 'Warn' };
    default:
      return { tone: 'red', label: 'Fail' };
  }
}

const MFA_LABEL: Record<MfaMethod, string> = { totp: 'TOTP', webauthn: 'WebAuthn', sms: 'SMS' };
export function mfaMethodLabel(method: MfaMethod): string {
  return MFA_LABEL[method];
}

export function visibilityTone(visibility: 'public' | 'partner' | 'private'): OpsTone {
  return visibility === 'public' ? 'green' : visibility === 'partner' ? 'blue' : 'gray';
}

export function scoreTone(score: number): OpsTone {
  if (score >= 85) return 'green';
  if (score >= 65) return 'orange';
  return 'red';
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

const NAV_KEY = 'np.cloud.nav';
const ALL_TABS: CloudTab[] = ['tenants', 'identity', 'sync', 'apiplatform', 'admin'];

export function loadCloudNav(): Set<CloudTab> {
  try {
    const raw = localStorage.getItem(NAV_KEY);
    if (!raw) return new Set(ALL_TABS);
    const parsed = JSON.parse(raw) as string[];
    const set = new Set(parsed.filter((x): x is CloudTab => (ALL_TABS as string[]).includes(x)));
    set.add('tenants');
    return set.size > 0 ? set : new Set(ALL_TABS);
  } catch {
    return new Set(ALL_TABS);
  }
}

export function saveCloudNav(tabs: Set<CloudTab>): void {
  try {
    localStorage.setItem(NAV_KEY, JSON.stringify([...tabs]));
  } catch {
    /* ignore */
  }
}
