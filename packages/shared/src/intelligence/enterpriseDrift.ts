/**
 * P7 — merged Drift Intelligence. Generalizes the P6 IaC desired-vs-actual drift shape into a domain-neutral
 * engine that MERGES infrastructure drift, IaC drift, configuration drift, identity drift, and permission drift
 * into ONE `EnterpriseDriftReport`. It does not replace the IaC drift engine — the IaC report is fed in as one
 * domain (already computed), while identity/permission/config drift are diffed here from desired-vs-actual
 * baselines with the same status vocabulary.
 *
 * Pure + deterministic. Each item is classified `in_sync | drifted | missing | unmanaged | changed`; per-domain
 * counts + an overall 0–100 drift score (100 = fully in sync) + a 0–100 severity (for the risk engine) + the top
 * drifted items are emitted. Bounded for large estates.
 */
import type { ExecutiveKpi } from '../types/executiveCenter';

export type DriftDomain = 'infrastructure' | 'iac' | 'configuration' | 'identity' | 'permission';
export const DRIFT_DOMAINS: readonly DriftDomain[] = ['infrastructure', 'iac', 'configuration', 'identity', 'permission'] as const;
export type DriftItemStatus = 'in_sync' | 'drifted' | 'missing' | 'unmanaged' | 'changed';

/** Cap items merged per domain. */
export const MAX_DRIFT_ITEMS = 50_000;

/** A desired-or-actual record: a stable key + a content signature (timestamp-free) for equality. */
export interface DriftRecord {
  key: string;
  signature: string;
  label?: string;
}
export interface DriftItem {
  key: string;
  label: string;
  domain: DriftDomain;
  status: DriftItemStatus;
  detail: string;
  /** 0–100 risk contribution of this drift. */
  risk: number;
}
/** One domain's contribution: precomputed `items`, OR `desired`/`actual` baselines to diff. */
export interface DomainDriftInput {
  domain: DriftDomain;
  items?: DriftItem[];
  desired?: DriftRecord[];
  actual?: DriftRecord[];
}

export interface DomainDriftSummary {
  domain: DriftDomain;
  total: number;
  inSync: number;
  drifted: number;
  missing: number;
  unmanaged: number;
  changed: number;
  driftScore: number;
}
export interface EnterpriseDriftReport {
  domains: DomainDriftSummary[];
  items: DriftItem[];
  topDrift: DriftItem[];
  totalItems: number;
  totalDrifted: number;
  /** 0–100, 100 = fully in sync. */
  driftScore: number;
  /** 0–100 severity (risk-weighted), for the Risk Engine. */
  severity: number;
  truncated: boolean;
  builtAt: string;
}

/** Default risk weight per non-in-sync status, biased higher for permission/identity domains. */
function statusRisk(status: DriftItemStatus, domain: DriftDomain): number {
  const base: Record<DriftItemStatus, number> = { in_sync: 0, drifted: 60, changed: 55, missing: 50, unmanaged: 45 };
  const lift = domain === 'permission' ? 25 : domain === 'identity' ? 15 : 0;
  return status === 'in_sync' ? 0 : Math.min(100, base[status] + lift);
}

/** Diff a domain's desired vs actual baselines into drift items (by key + signature). */
export function diffDomain(domain: DriftDomain, desired: DriftRecord[], actual: DriftRecord[]): DriftItem[] {
  const desiredByKey = new Map(desired.map((d) => [d.key, d] as const));
  const actualByKey = new Map(actual.map((a) => [a.key, a] as const));
  const keys = new Set<string>([...desiredByKey.keys(), ...actualByKey.keys()]);
  const items: DriftItem[] = [];
  for (const key of keys) {
    if (items.length >= MAX_DRIFT_ITEMS) break;
    const d = desiredByKey.get(key);
    const a = actualByKey.get(key);
    let status: DriftItemStatus;
    if (d && a) status = d.signature === a.signature ? 'in_sync' : 'drifted';
    else if (d) status = 'missing';
    else status = 'unmanaged';
    const label = (a?.label ?? d?.label ?? key);
    items.push({ key, label, domain, status, detail: status === 'drifted' ? 'configuration differs from baseline' : status === 'missing' ? 'declared but absent' : status === 'unmanaged' ? 'present but undeclared' : 'in sync', risk: statusRisk(status, domain) });
  }
  return items.sort((x, y) => x.key.localeCompare(y.key));
}

function summarize(domain: DriftDomain, items: DriftItem[]): DomainDriftSummary {
  const s: DomainDriftSummary = { domain, total: items.length, inSync: 0, drifted: 0, missing: 0, unmanaged: 0, changed: 0, driftScore: 100 };
  for (const it of items) {
    if (it.status === 'in_sync') s.inSync += 1;
    else if (it.status === 'drifted') s.drifted += 1;
    else if (it.status === 'missing') s.missing += 1;
    else if (it.status === 'unmanaged') s.unmanaged += 1;
    else s.changed += 1;
  }
  s.driftScore = s.total ? Math.round((s.inSync / s.total) * 100) : 100;
  return s;
}

/** Merge every domain's drift into one enterprise drift report. */
export function computeEnterpriseDrift(inputs: DomainDriftInput[], nowMs: number): EnterpriseDriftReport {
  const allItems: DriftItem[] = [];
  const domains: DomainDriftSummary[] = [];
  let truncated = false;
  for (const input of inputs) {
    let items = input.items ?? diffDomain(input.domain, input.desired ?? [], input.actual ?? []);
    if (items.length > MAX_DRIFT_ITEMS) {
      items = items.slice(0, MAX_DRIFT_ITEMS);
      truncated = true;
    }
    domains.push(summarize(input.domain, items));
    for (const it of items) allItems.push(it);
  }
  const totalItems = allItems.length;
  const drifted = allItems.filter((i) => i.status !== 'in_sync');
  const driftScore = totalItems ? Math.round(((totalItems - drifted.length) / totalItems) * 100) : 100;
  const severity = drifted.length ? Math.round(drifted.reduce((s, i) => s + i.risk, 0) / drifted.length) : 0;
  const topDrift = [...drifted].sort((a, b) => b.risk - a.risk || a.key.localeCompare(b.key)).slice(0, 25);

  return { domains, items: allItems, topDrift, totalItems, totalDrifted: drifted.length, driftScore, severity, truncated, builtAt: new Date(nowMs).toISOString() };
}

export function driftKpis(report: EnterpriseDriftReport): ExecutiveKpi[] {
  const band: ExecutiveKpi['band'] = report.driftScore >= 90 ? 'healthy' : report.driftScore >= 70 ? 'watch' : report.driftScore >= 40 ? 'at-risk' : 'critical';
  return [
    { key: 'enterprise.drift.score', label: 'Configuration In-Sync', value: report.driftScore, display: `${report.driftScore}%`, band },
    { key: 'enterprise.drift.count', label: 'Drifted Items', value: report.totalDrifted, display: String(report.totalDrifted), band: report.totalDrifted === 0 ? 'healthy' : report.totalDrifted < 10 ? 'watch' : 'at-risk' },
  ];
}
