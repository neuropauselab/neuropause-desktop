/**
 * Enterprise Experience UI helpers (Phase 7 · Stage 2). Status → {label, tone}
 * maps for the org-level concepts (compliance, risk, graph nodes), small
 * formatters, and the renderer-local widget-preference store that powers the
 * configurable dashboards. Pure; reuses the Operations tone system so colours
 * stay consistent across the whole app.
 */
import type { ComplianceSeverity, ComplianceStatus, OrgGraphNodeKind } from '@neuropause/shared';
import type { IconName } from '@renderer/components/ui/Icon';
import { type OpsTone } from '@renderer/operations/lib';

export { DOT_BG, TEXT_TONE, TINT_TONE, type OpsTone } from '@renderer/operations/lib';
export { relativeTime, titleCase, formatPct, formatTrust, formatMs } from '@renderer/workforce/lib';

export interface Meta {
  label: string;
  tone: OpsTone;
}

/** The surfaces of the Enterprise experience. */
export type EnterpriseTab =
  | 'command'
  | 'executive'
  | 'decision'
  | 'organization'
  | 'operations'
  | 'process'
  | 'schedule'
  | 'execution'
  | 'relationship'
  | 'trust'
  | 'personalize'
  | 'modules'
  | 'search'
  | 'workspace'
  | 'briefings'
  | 'customize';

export function complianceStatusMeta(s: ComplianceStatus): Meta {
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

export function severityMeta(s: ComplianceSeverity): Meta {
  switch (s) {
    case 'critical':
      return { label: 'Critical', tone: 'red' };
    case 'warning':
      return { label: 'Warning', tone: 'orange' };
    case 'info':
      return { label: 'Info', tone: 'blue' };
    default:
      return { label: s, tone: 'gray' };
  }
}

export function riskLevelMeta(level: 'low' | 'elevated' | 'high'): Meta {
  switch (level) {
    case 'low':
      return { label: 'Low', tone: 'green' };
    case 'elevated':
      return { label: 'Elevated', tone: 'orange' };
    case 'high':
      return { label: 'High', tone: 'red' };
    default:
      return { label: level, tone: 'gray' };
  }
}

export function healthLabelTone(label: string): OpsTone {
  if (label === 'Healthy') return 'green';
  if (label === 'Watch') return 'orange';
  return 'red';
}

export interface NodeKindMeta {
  label: string;
  icon: IconName;
  tone: OpsTone;
}

const NODE_KIND: Record<OrgGraphNodeKind, NodeKindMeta> = {
  organization: { label: 'Organization', icon: 'grid', tone: 'accent' },
  unit: { label: 'Unit', icon: 'layers', tone: 'blue' },
  user: { label: 'Person', icon: 'user', tone: 'green' },
  worker: { label: 'AI Worker', icon: 'cpu', tone: 'purple' },
  project: { label: 'Project', icon: 'checklist', tone: 'orange' },
  customer: { label: 'Customer', icon: 'heart', tone: 'accent' },
  document: { label: 'Document', icon: 'doc', tone: 'gray' },
  connector: { label: 'Connector', icon: 'connectors', tone: 'blue' },
};

export function nodeKindMeta(kind: OrgGraphNodeKind): NodeKindMeta {
  return NODE_KIND[kind] ?? { label: kind, icon: 'dot', tone: 'gray' };
}

const UNIT_KIND_LABEL: Record<string, string> = {
  business_unit: 'Business Unit',
  department: 'Department',
  team: 'Team',
};

export function unitKindLabel(kind: string): string {
  return UNIT_KIND_LABEL[kind] ?? kind;
}

/** Format an age in ms as a coarse human string. */
export function formatAge(ms: number | null): string {
  if (ms === null) return '—';
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

/* ── renderer-local widget preferences (configurable dashboards) ── */

const PREFIX = 'np.enterprise.widgets.';

export function loadWidgetPrefs(key: string, all: readonly string[]): Set<string> {
  try {
    const raw = localStorage.getItem(`${PREFIX}${key}`);
    if (raw) {
      const ids = JSON.parse(raw) as string[];
      return new Set(ids.filter((id) => all.includes(id)));
    }
  } catch {
    /* fall through to default */
  }
  return new Set(all);
}

export function saveWidgetPrefs(key: string, ids: Set<string>): void {
  try {
    localStorage.setItem(`${PREFIX}${key}`, JSON.stringify([...ids]));
  } catch {
    /* non-fatal: preferences are best-effort */
  }
}

/* ── navigation preferences (which enterprise surfaces are shown) ── */

/**
 * P13C ROUND 36 — GATE 5. STORE WHAT WAS HIDDEN, NOT WHAT WAS ALLOWED.
 *
 * The old scheme persisted the ENABLED set under `np.enterprise.nav` — but the
 * only writer (Customize) manages 8 of the 16 Enterprise tabs, so its first
 * save silently excluded the other 8, and `loadNavPrefs` (called with all 16)
 * INTERSECTED against that stored subset: Executive, Process Explorer,
 * Production Schedule, Operator Console, Relationship Intelligence, Trust
 * Center, Favorites and Modules vanished permanently, with no in-app recovery
 * — the reset button never cleared the key and the lost tabs were not listed
 * in Customize to re-enable.
 *
 * Storing the HIDDEN set inverts the failure mode: a tab nobody ever toggled
 * off can never disappear, whatever subset of tabs the writing surface happens
 * to manage. The legacy enabled-list key is DISCARDED on first read — a user
 * who deliberately hid one of the 8 managed tabs loses that one preference
 * once (trivially re-settable), which is the right trade against users who
 * lost half their navigation.
 */
const NAV_KEY = 'np.enterprise.nav'; // legacy enabled-list; migrated away (round 36)
const NAV_HIDDEN_KEY = 'np.enterprise.nav.hidden';

export function loadNavPrefs(all: readonly string[]): Set<string> {
  try {
    localStorage.removeItem(NAV_KEY); // discard the legacy lossy format
    const raw = localStorage.getItem(NAV_HIDDEN_KEY);
    if (raw) {
      const hidden = new Set(JSON.parse(raw) as string[]);
      hidden.delete('command'); // the home surface is always available
      return new Set(all.filter((id) => !hidden.has(id)));
    }
  } catch {
    /* default to all */
  }
  return new Set(all);
}

/**
 * Persist the toggles from a surface that manages `managed` tabs: hidden =
 * managed − enabled. Tabs outside `managed` are untouched by construction.
 */
export function saveNavPrefs(enabled: Set<string>, managed: readonly string[]): void {
  try {
    const hidden = managed.filter((id) => id !== 'command' && !enabled.has(id));
    localStorage.setItem(NAV_HIDDEN_KEY, JSON.stringify(hidden));
    localStorage.removeItem(NAV_KEY);
  } catch {
    /* best-effort */
  }
}

export function resetWidgetPrefs(): void {
  try {
    localStorage.removeItem('np.enterprise.widgets.command');
    localStorage.removeItem('np.enterprise.widgets.operations');
  } catch {
    /* best-effort */
  }
}
