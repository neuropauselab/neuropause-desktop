/**
 * Enterprise Ecosystem UI helpers (Phase 8 · Stage 2). Status → {label, tone}
 * maps for the network concepts (install status, connector tiers, partner types
 * and tiers, pack kinds, template categories, ecosystem health), plus the
 * navigation preference store. Reuses the marketplace-listing helpers from the
 * Developer surface so listings render identically across both.
 */
import type {
  ConnectorTier,
  EcoHealthStatus,
  InstallStatus,
  PackKind,
  PartnerTier,
  PartnerType,
  TemplateCategory,
} from '@neuropause/shared';
import type { IconName } from '@renderer/components/ui/Icon';
import { type OpsTone } from '@renderer/operations/lib';

export { DOT_BG, TEXT_TONE, TINT_TONE, type OpsTone } from '@renderer/operations/lib';
export { relativeTime, titleCase, formatPct, formatMs } from '@renderer/workforce/lib';
export { kindMeta, listingStatusMeta, pricingLabel, formatMoney, formatNum, type Meta } from '@renderer/developer/lib';

export interface Meta2 {
  label: string;
  tone: OpsTone;
}

/** The six surfaces of the Enterprise Ecosystem. */
export type EcosystemTab = 'workers' | 'connectors' | 'templates' | 'exchange' | 'partners' | 'analytics';

export function installStatusMeta(s: InstallStatus): Meta2 {
  switch (s) {
    case 'installed':
      return { label: 'Installed', tone: 'green' };
    case 'update_available':
      return { label: 'Update available', tone: 'orange' };
    case 'disabled':
      return { label: 'Disabled', tone: 'gray' };
    default:
      return { label: s, tone: 'gray' };
  }
}

export function connectorTierMeta(t: ConnectorTier): Meta2 {
  switch (t) {
    case 'certified':
      return { label: 'Certified', tone: 'green' };
    case 'enterprise':
      return { label: 'Enterprise', tone: 'blue' };
    case 'community':
      return { label: 'Community', tone: 'gray' };
    default:
      return { label: t, tone: 'gray' };
  }
}

export interface IconMeta {
  label: string;
  icon: IconName;
  tone: OpsTone;
}

const PARTNER_TYPE: Record<PartnerType, IconMeta> = {
  technology: { label: 'Technology', icon: 'cpu', tone: 'purple' },
  consulting: { label: 'Consulting', icon: 'user', tone: 'blue' },
  system_integrator: { label: 'System Integrator', icon: 'layers', tone: 'accent' },
  msp: { label: 'Managed Service Provider', icon: 'server', tone: 'green' },
};

export function partnerTypeMeta(t: PartnerType): IconMeta {
  return PARTNER_TYPE[t] ?? { label: t, icon: 'user', tone: 'gray' };
}

export function partnerTierMeta(t: PartnerTier): Meta2 {
  switch (t) {
    case 'premier':
      return { label: 'Premier', tone: 'purple' };
    case 'select':
      return { label: 'Select', tone: 'blue' };
    case 'registered':
      return { label: 'Registered', tone: 'gray' };
    default:
      return { label: t, tone: 'gray' };
  }
}

const PACK_KIND: Record<PackKind, IconMeta> = {
  knowledge: { label: 'Knowledge Pack', icon: 'memory', tone: 'accent' },
  ai_worker: { label: 'AI Worker Pack', icon: 'cpu', tone: 'purple' },
  automation: { label: 'Automation Pack', icon: 'automations', tone: 'green' },
  connector: { label: 'Connector Pack', icon: 'connectors', tone: 'blue' },
};

export function packKindMeta(k: PackKind): IconMeta {
  return PACK_KIND[k] ?? { label: k, icon: 'package', tone: 'gray' };
}

const TEMPLATE_CATEGORY: Record<TemplateCategory, IconMeta> = {
  workflow: { label: 'Workflows', icon: 'automations', tone: 'green' },
  governance_policy: { label: 'Governance Policies', icon: 'shield', tone: 'red' },
  approval_chain: { label: 'Approval Chains', icon: 'checklist', tone: 'orange' },
  dashboard: { label: 'Dashboards', icon: 'grid', tone: 'blue' },
  industry: { label: 'Industry Templates', icon: 'layers', tone: 'accent' },
};

export function templateCategoryMeta(c: TemplateCategory): IconMeta {
  return TEMPLATE_CATEGORY[c] ?? { label: c, icon: 'grid', tone: 'gray' };
}

export function healthStatusTone(s: EcoHealthStatus): OpsTone {
  switch (s) {
    case 'good':
      return 'green';
    case 'watch':
      return 'orange';
    case 'risk':
      return 'red';
    default:
      return 'gray';
  }
}

/* ── navigation preferences ── */

const NAV_KEY = 'np.ecosystem.nav';

export function loadNavPrefs(all: readonly string[]): Set<string> {
  try {
    const raw = localStorage.getItem(NAV_KEY);
    if (raw) {
      const ids = JSON.parse(raw) as string[];
      const next = new Set(ids.filter((id) => all.includes(id)));
      next.add('workers');
      return next;
    }
  } catch {
    /* default to all */
  }
  return new Set(all);
}

export function saveNavPrefs(ids: Set<string>): void {
  try {
    const next = new Set(ids);
    next.add('workers');
    localStorage.setItem(NAV_KEY, JSON.stringify([...next]));
  } catch {
    /* best-effort */
  }
}
