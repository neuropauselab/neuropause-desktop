/**
 * Developer Portal UI helpers (Phase 8 · Stage 1). Status → {label, tone} maps
 * for the platform concepts (plan tiers, listing lifecycle, scan severity, review
 * decisions, package kinds), small formatters, and the renderer-local navigation
 * preference store. Pure; reuses the Operations tone system so colours stay
 * consistent across the app.
 */
import type {
  ApiMethod,
  ApiVersionInfo,
  ListingKind,
  ListingStatus,
  PlanTier,
  PluginExtensionKind,
  ReviewDecision,
  ScanSeverity,
  ScanStatus,
  WebhookDeliveryStatus,
} from '@neuropause/shared';
import type { IconName } from '@renderer/components/ui/Icon';
import { type OpsTone } from '@renderer/operations/lib';

export { DOT_BG, TEXT_TONE, TINT_TONE, type OpsTone } from '@renderer/operations/lib';
export { relativeTime, titleCase, formatPct, formatMs } from '@renderer/workforce/lib';

export interface Meta {
  label: string;
  tone: OpsTone;
}

/** The surfaces of the Developer Portal. The first six are the ecosystem/publishing
 *  surfaces; the last four are the platform surfaces added in P3.0 (Increment 7):
 *  the API explorer, the OpenAPI reference, webhooks, and plugin extensions. */
export type DeveloperTab =
  | 'dashboard'
  | 'apikeys'
  | 'marketplace'
  | 'gateway'
  | 'billing'
  | 'sdk'
  | 'explorer'
  | 'reference'
  | 'webhooks'
  | 'extensions';

export function planMeta(tier: PlanTier): Meta {
  switch (tier) {
    case 'free':
      return { label: 'Free', tone: 'gray' };
    case 'pro':
      return { label: 'Pro', tone: 'blue' };
    case 'enterprise':
      return { label: 'Enterprise', tone: 'purple' };
    default:
      return { label: tier, tone: 'gray' };
  }
}

export function listingStatusMeta(s: ListingStatus): Meta {
  switch (s) {
    case 'published':
    case 'approved':
      return { label: titleCaseLocal(s), tone: 'green' };
    case 'in_review':
    case 'rolled_back':
      return { label: s === 'in_review' ? 'In review' : 'Rolled back', tone: 'orange' };
    case 'rejected':
      return { label: 'Rejected', tone: 'red' };
    case 'submitted':
    case 'scanning':
    case 'signing':
      return { label: titleCaseLocal(s), tone: 'blue' };
    case 'draft':
      return { label: 'Draft', tone: 'gray' };
    default:
      return { label: s, tone: 'gray' };
  }
}

export function scanStatusMeta(s: ScanStatus): Meta {
  switch (s) {
    case 'pass':
      return { label: 'Pass', tone: 'green' };
    case 'warn':
      return { label: 'Warn', tone: 'orange' };
    case 'fail':
      return { label: 'Fail', tone: 'red' };
    default:
      return { label: s, tone: 'gray' };
  }
}

export function severityMeta(s: ScanSeverity): Meta {
  switch (s) {
    case 'critical':
    case 'high':
      return { label: titleCaseLocal(s), tone: 'red' };
    case 'medium':
      return { label: 'Medium', tone: 'orange' };
    case 'low':
      return { label: 'Low', tone: 'gray' };
    case 'info':
      return { label: 'Info', tone: 'blue' };
    default:
      return { label: s, tone: 'gray' };
  }
}

export function reviewDecisionMeta(d: ReviewDecision): Meta {
  switch (d) {
    case 'approved':
      return { label: 'Approved', tone: 'green' };
    case 'rejected':
      return { label: 'Rejected', tone: 'red' };
    case 'changes_requested':
      return { label: 'Changes requested', tone: 'orange' };
    default:
      return { label: d, tone: 'gray' };
  }
}

export function versionStatusTone(status: ApiVersionInfo['status']): OpsTone {
  switch (status) {
    case 'current':
      return 'green';
    case 'beta':
      return 'blue';
    case 'deprecated':
      return 'orange';
    case 'sunset':
      return 'red';
    default:
      return 'gray';
  }
}

export interface KindMeta {
  label: string;
  icon: IconName;
  tone: OpsTone;
}

const KIND: Record<ListingKind, KindMeta> = {
  ai_app: { label: 'AI App', icon: 'sparkles', tone: 'accent' },
  ai_worker: { label: 'AI Worker', icon: 'cpu', tone: 'purple' },
  connector: { label: 'Connector', icon: 'connectors', tone: 'blue' },
  plugin: { label: 'Plugin', icon: 'puzzle', tone: 'orange' },
  automation_template: { label: 'Automation', icon: 'automations', tone: 'green' },
  enterprise_template: { label: 'Enterprise', icon: 'grid', tone: 'accent' },
};

export function kindMeta(kind: ListingKind): KindMeta {
  return KIND[kind] ?? { label: kind, icon: 'package', tone: 'gray' };
}

export function statusHttpTone(status: number): OpsTone {
  if (status >= 200 && status < 300) return 'green';
  if (status === 401 || status === 403) return 'orange';
  if (status === 429) return 'orange';
  if (status >= 400) return 'red';
  return 'gray';
}

/** Colour an HTTP method like the API tools people already know. */
export function methodTone(method: ApiMethod): OpsTone {
  switch (method) {
    case 'GET':
      return 'green';
    case 'POST':
      return 'blue';
    case 'PUT':
    case 'PATCH':
      return 'orange';
    case 'DELETE':
      return 'red';
    default:
      return 'gray';
  }
}

export function deliveryStatusMeta(status: WebhookDeliveryStatus): Meta {
  switch (status) {
    case 'delivered':
      return { label: 'Delivered', tone: 'green' };
    case 'pending':
      return { label: 'Pending', tone: 'blue' };
    case 'failed':
      return { label: 'Failed', tone: 'orange' };
    case 'dead':
      return { label: 'Dead-lettered', tone: 'red' };
    default:
      return { label: status, tone: 'gray' };
  }
}

const EXTENSION_KIND: Record<PluginExtensionKind, KindMeta> = {
  erp_module: { label: 'ERP Module', icon: 'grid', tone: 'accent' },
  executive_kpi: { label: 'Executive KPI', icon: 'gauge', tone: 'purple' },
  timeline_provider: { label: 'Timeline Provider', icon: 'clock', tone: 'blue' },
  graph_node: { label: 'Graph Node', icon: 'layers', tone: 'blue' },
  graph_relationship: { label: 'Graph Relationship', icon: 'connectors', tone: 'blue' },
  memory_projector: { label: 'Memory Projector', icon: 'memory', tone: 'green' },
  automation_trigger: { label: 'Automation Trigger', icon: 'bolt', tone: 'orange' },
  automation_action: { label: 'Automation Action', icon: 'automations', tone: 'orange' },
  search_provider: { label: 'Search Provider', icon: 'search', tone: 'gray' },
  context_provider: { label: 'Context Provider', icon: 'lightbulb', tone: 'accent' },
};

export function extensionKindMeta(kind: PluginExtensionKind): KindMeta {
  return EXTENSION_KIND[kind] ?? { label: kind, icon: 'puzzle', tone: 'gray' };
}

export function formatMoney(amount: number, currency = 'USD'): string {
  if (amount === 0) return 'Free';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

export function formatNum(n: number): string {
  return new Intl.NumberFormat().format(n);
}

function titleCaseLocal(s: string): string {
  return s
    .split('_')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

export function pricingLabel(model: string, amount: number, currency: string): string {
  if (model === 'free' || amount === 0) return 'Free';
  if (model === 'subscription') return `${formatMoney(amount, currency)}/mo`;
  return formatMoney(amount, currency);
}

/* ── navigation preferences (which developer surfaces are shown) ── */

const NAV_KEY = 'np.developer.nav';

export function loadNavPrefs(all: readonly string[]): Set<string> {
  try {
    const raw = localStorage.getItem(NAV_KEY);
    if (raw) {
      const ids = JSON.parse(raw) as string[];
      const next = new Set(ids.filter((id) => all.includes(id)));
      next.add('dashboard');
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
    next.add('dashboard');
    localStorage.setItem(NAV_KEY, JSON.stringify([...next]));
  } catch {
    /* best-effort */
  }
}
