/**
 * P5 — Increment 4: the Enterprise Connector Center's pure view-model.
 *
 * All of the Center's derivation — per-service capability presentation, connector search/filtering,
 * category ordering, and the Overview rollup — lives here as pure functions over the existing DTOs
 * (`ConnectorDto`, `ConnectorStats`) and the runtime-driven `ConnectorServiceCapability` the Supervisor
 * now returns on `ConnectorInspection`. Keeping it framework-free means it is unit-tested in the
 * desktop workspace's node test environment (no jsdom), and the Center's React shell stays a thin
 * renderer over these results. Nothing here hardcodes a connector's services — the service list is
 * always the runtime `services` projection; this module only presents it.
 */
import type {
  ConnectorCategory,
  ConnectorDto,
  ConnectorHealth,
  ConnectorServiceCapability,
  ConnectorStats,
  ConnectorStatus,
} from '@neuropause/shared';

/**
 * A monochrome-friendly tone key. Deliberately a subset of the operations design system's `OpsTone`
 * string literals, so the Center's components can hand these straight to `StatusBadge`/`Stat` without
 * a translation table — while this module stays free of any `@renderer/*` import (node-testable).
 */
export type CenterTone = 'green' | 'orange' | 'red' | 'gray' | 'blue';

/* ── Per-service capability presentation (runtime-driven — never a hardcoded service list) ──────── */

export interface ServiceStatusMeta {
  label: string;
  tone: CenterTone;
}

/** Present one runtime service-capability status as a label + tone. Pure. */
export function serviceStatusMeta(status: ConnectorServiceCapability['status']): ServiceStatusMeta {
  switch (status) {
    case 'available':
      return { label: 'Available', tone: 'green' };
    case 'requires_scope':
      return { label: 'Scope needed', tone: 'orange' };
    case 'unprovisioned':
      return { label: 'Not provisioned', tone: 'gray' };
    case 'disabled':
      return { label: 'Disabled', tone: 'gray' };
    default:
      return { label: 'Unknown', tone: 'gray' };
  }
}

export interface ServiceSummary {
  total: number;
  available: number;
  requiresScope: number;
  unprovisioned: number;
  disabled: number;
  /** Total objects synced across all services with a live count. */
  objects: number;
}

/** Roll up a connector's per-service capabilities into counts for the card / Services header. Pure. */
export function summarizeServices(services: readonly ConnectorServiceCapability[]): ServiceSummary {
  const summary: ServiceSummary = {
    total: services.length,
    available: 0,
    requiresScope: 0,
    unprovisioned: 0,
    disabled: 0,
    objects: 0,
  };
  for (const s of services) {
    if (s.status === 'available') summary.available += 1;
    else if (s.status === 'requires_scope') summary.requiresScope += 1;
    else if (s.status === 'unprovisioned') summary.unprovisioned += 1;
    else if (s.status === 'disabled') summary.disabled += 1;
    if (typeof s.objectCount === 'number') summary.objects += s.objectCount;
  }
  return summary;
}

/* ── Connector-level presentation ───────────────────────────────────────────────────────────────── */

export interface ConnectorStatusMeta {
  label: string;
  tone: CenterTone;
}

/**
 * Present a connector's aggregate status + health as a single label + tone for the Overview grid.
 * `error`/`reauth_required` dominate; a connected-but-degraded connector reads as a caution; an
 * unconfigured/disconnected connector reads as neutral. Pure.
 */
export function connectorStatusMeta(status: ConnectorStatus, health: ConnectorHealth): ConnectorStatusMeta {
  switch (status) {
    case 'error':
      return { label: 'Error', tone: 'red' };
    case 'reauth_required':
      return { label: 'Reauth required', tone: 'orange' };
    case 'connecting':
      return { label: 'Connecting', tone: 'blue' };
    case 'unavailable':
      return { label: 'Not configured', tone: 'gray' };
    case 'disconnected':
      return { label: 'Disconnected', tone: 'gray' };
    case 'connected':
      if (health === 'down') return { label: 'Connected · down', tone: 'red' };
      if (health === 'degraded') return { label: 'Connected · degraded', tone: 'orange' };
      return { label: 'Connected', tone: 'green' };
    default:
      return { label: 'Unknown', tone: 'gray' };
  }
}

/** Whether a connector needs operator attention (surfaced first in the Overview). Pure. */
export function connectorNeedsAttention(dto: Pick<ConnectorDto, 'status' | 'health'>): boolean {
  return dto.status === 'error' || dto.status === 'reauth_required' || dto.health === 'down' || dto.health === 'degraded';
}

/* ── Search + filtering (extracted from the page so it is testable) ─────────────────────────────── */

/** Whether a connector matches a free-text query (name / provider / description). Case-insensitive. Pure. */
export function matchesConnectorQuery(dto: ConnectorDto, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    dto.name.toLowerCase().includes(q) ||
    dto.provider.toLowerCase().includes(q) ||
    dto.description.toLowerCase().includes(q)
  );
}

export interface ConnectorFilter {
  query: string;
  category: ConnectorCategory | 'all';
}

/** Filter connectors by category + free-text query, preserving input order. Pure. */
export function filterConnectors(dtos: readonly ConnectorDto[], filter: ConnectorFilter): ConnectorDto[] {
  return dtos.filter((c) => {
    if (filter.category !== 'all' && c.category !== filter.category) return false;
    return matchesConnectorQuery(c, filter.query);
  });
}

/** The categories actually present among the connectors, in a fixed display order. Pure. */
export function presentCategories(
  dtos: readonly ConnectorDto[],
  order: readonly ConnectorCategory[],
): ConnectorCategory[] {
  const present = new Set(dtos.map((c) => c.category));
  return order.filter((c) => present.has(c));
}

/* ── Overview rollup ────────────────────────────────────────────────────────────────────────────── */

export interface OverviewMetrics {
  total: number;
  configured: number;
  connected: number;
  accounts: number;
  healthy: number;
  degraded: number;
  down: number;
  /** Connectors needing attention (degraded + down), for the headline attention stat. */
  attention: number;
}

/** Roll the connector stats into the Overview headline metrics. Null-safe (pre-load). Pure. */
export function overviewMetrics(stats: ConnectorStats | null): OverviewMetrics {
  return {
    total: stats?.total ?? 0,
    configured: stats?.configured ?? 0,
    connected: stats?.connected ?? 0,
    accounts: stats?.accounts ?? 0,
    healthy: stats?.healthy ?? 0,
    degraded: stats?.degraded ?? 0,
    down: stats?.down ?? 0,
    attention: (stats?.degraded ?? 0) + (stats?.down ?? 0),
  };
}
