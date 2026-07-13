/**
 * The Cloud Platform Center view-model (P6). Framework-free pure functions that transform the IPC DTOs
 * (`CloudPlatformDto`, `CloudPlatformStats`, `ResourceGraphModel`) into view state — status/tone metadata,
 * filtered platform lists, and rollups. This mirrors `connectorCenterModel.ts` exactly (the Cloud Platform
 * Center is the infrastructure sibling of the Connector Center), so the React root is a thin renderer over
 * these and the logic is unit-tested under the node vitest gate. Zero `@renderer/*` imports.
 */
import type {
  CloudPlatformDto,
  CloudPlatformHealth,
  CloudPlatformStats,
  CloudPlatformStatus,
  CloudProviderKind,
  ResourceGraphModel,
  ResourceHealth,
} from '@neuropause/shared';

/** A subset of the ops tone vocabulary, so results feed StatusBadge / Stat directly. */
export type CenterTone = 'green' | 'orange' | 'red' | 'gray' | 'blue';

export interface PlatformStatusMeta {
  label: string;
  tone: CenterTone;
}

/** Present a platform's lifecycle status + health as a label + tone. */
export function platformStatusMeta(status: CloudPlatformStatus, health: CloudPlatformHealth): PlatformStatusMeta {
  if (status === 'unconfigured') return { label: 'Not configured', tone: 'gray' };
  if (status === 'error' || health === 'down') return { label: 'Error', tone: 'red' };
  if (status === 'discovering') return { label: 'Discovering', tone: 'blue' };
  if (status === 'degraded' || health === 'degraded') return { label: 'Degraded', tone: 'orange' };
  if (status === 'disconnected') return { label: 'Disconnected', tone: 'gray' };
  return { label: 'Connected', tone: 'green' };
}

/** Map a resource health onto a tone. */
export function healthTone(health: ResourceHealth): CenterTone {
  switch (health) {
    case 'healthy': return 'green';
    case 'degraded': return 'orange';
    case 'critical': return 'red';
    default: return 'gray';
  }
}

/** A platform that needs the operator's attention (error, degraded, or a failing account). */
export function platformNeedsAttention(dto: CloudPlatformDto): boolean {
  return dto.status === 'error' || dto.status === 'degraded' || dto.health === 'down' || dto.accounts.some((a) => a.consecutiveFailures > 0);
}

export interface PlatformFilter {
  query: string;
  provider: CloudProviderKind | 'all';
}

/** Does a platform match a free-text query (name / provider / domain)? */
export function matchesPlatformQuery(dto: CloudPlatformDto, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    dto.name.toLowerCase().includes(q) ||
    dto.provider.toLowerCase().includes(q) ||
    dto.domains.some((d) => d.toLowerCase().includes(q))
  );
}

/** Filter platforms by query + provider. */
export function filterPlatforms(dtos: CloudPlatformDto[], filter: PlatformFilter): CloudPlatformDto[] {
  return dtos.filter((d) => (filter.provider === 'all' || d.provider === filter.provider) && matchesPlatformQuery(d, filter.query));
}

/** The distinct provider kinds present, in first-seen order (for the provider filter chips). */
export function presentProviders(dtos: CloudPlatformDto[]): CloudProviderKind[] {
  const seen: CloudProviderKind[] = [];
  for (const d of dtos) if (!seen.includes(d.provider)) seen.push(d.provider);
  return seen;
}

export interface CloudOverviewMetrics {
  platforms: number;
  configured: number;
  connected: number;
  discovering: number;
  degraded: number;
  down: number;
  accounts: number;
  resources: number;
  domains: number;
}

/** The Overview KPI rollup. */
export function cloudOverviewMetrics(stats: CloudPlatformStats): CloudOverviewMetrics {
  return {
    platforms: stats.platforms,
    configured: stats.configured,
    connected: stats.connected,
    discovering: stats.discovering,
    degraded: stats.degraded,
    down: stats.down,
    accounts: stats.accounts,
    resources: stats.resources,
    domains: stats.domains,
  };
}

export interface ResourceGraphSummary {
  resources: number;
  edges: number;
  critical: number;
  degraded: number;
  orphaned: number;
  accounts: number;
  regions: number;
  topBlastRadius: ResourceGraphModel['insights']['topBlastRadius'];
}

/** Summarize a Resource Graph model for the Resource Graph tab. */
export function summarizeResourceGraph(model: ResourceGraphModel): ResourceGraphSummary {
  return {
    resources: model.counts.resources,
    edges: model.counts.edges,
    critical: model.insights.critical,
    degraded: model.insights.degraded,
    orphaned: model.insights.orphaned,
    accounts: model.insights.accounts,
    regions: model.insights.regions,
    topBlastRadius: model.insights.topBlastRadius,
  };
}
