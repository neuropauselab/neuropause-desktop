/**
 * Phase 6 Stage 9 — the Service Catalog (D-1): registry × live signals.
 *
 * Every row's `state` comes from the REAL aggregate the registry names for it
 * (`execution-stats` → engine stats; `workforce` → job pages; `automation-
 * monitor` → the monitor; `connectors` → the connector list; `ai-engine` →
 * the engine state). A `none-measured` service is honestly `unknown`. Owners
 * resolve registry-domain → live org unit + lead; a unit without a lead is an
 * ownership GAP, never an invented owner. KPI keys are joined against the LIVE
 * executive snapshot; missing keys are gaps. Pure; reads injected.
 */
import type {
  OperationsGap,
  OperationsUnavailable,
  ServiceCatalog,
  ServiceCatalogEntry,
  ServiceOwnerRef,
  ServiceState,
} from '@neuropause/shared';
import { DOMAIN_REGISTRY, SERVICE_REGISTRY } from './operationsRegistry';

export interface CatalogSignals {
  executions: { active: number; queued: number; successRate: number | null; averageRuntimeMs: number | null } | null;
  workforce: { queueDepth: number; awaitingApproval: number; oldestApprovalHours: number | null } | null;
  automation: { running: number; completed: number; failed: number; paused: number } | null;
  connectors: { id: string; name: string; configured: boolean; health: string }[] | null;
  aiState: string | null;
  /** Live executive KPI keys present in the snapshot. */
  kpiKeys: string[] | null;
  /** Live org units (name + lead) for ownership resolution. */
  units: { id: string; name: string; leadUserId: string | null }[] | null;
  users: { id: string; name: string }[] | null;
}

export interface CatalogInput {
  nowIso: string;
  signals: CatalogSignals;
  failures: Record<string, string>;
}

/** Resolve a domain's owner against the LIVE units — null when unmatched. */
export function resolveOwner(
  owningUnitName: string,
  units: CatalogSignals['units'],
  users: CatalogSignals['users'],
): ServiceOwnerRef | null {
  if (!units) return null;
  const unit = units.find((u) => u.name.toLowerCase() === owningUnitName.toLowerCase());
  if (!unit) return null;
  const lead = unit.leadUserId ? (users?.find((x) => x.id === unit.leadUserId) ?? null) : null;
  return { unitId: unit.id, unitName: unit.name, leadUserId: unit.leadUserId, leadName: lead?.name ?? null };
}

function serviceState(
  signal: (typeof SERVICE_REGISTRY)[number]['signal'],
  s: CatalogSignals,
): { state: ServiceState; detail: string; evidence: string[] } {
  switch (signal) {
    case 'execution-stats': {
      if (!s.executions) return { state: 'unknown', detail: 'execution stats unavailable', evidence: [] };
      const rate = s.executions.successRate;
      const state: ServiceState = rate === null ? 'operational' : rate < 0.5 ? 'failed' : rate < 0.9 ? 'degraded' : 'operational';
      return {
        state,
        detail:
          rate === null
            ? `no finished executions yet · ${s.executions.active} active, ${s.executions.queued} queued`
            : `success rate ${(rate * 100).toFixed(0)}% · ${s.executions.active} active, ${s.executions.queued} queued`,
        evidence: ['execution-stats'],
      };
    }
    case 'workforce': {
      if (!s.workforce) return { state: 'unknown', detail: 'job store unavailable', evidence: [] };
      const state: ServiceState =
        s.workforce.queueDepth > 50 || (s.workforce.oldestApprovalHours ?? 0) > 72
          ? 'failed'
          : s.workforce.queueDepth > 25 || (s.workforce.oldestApprovalHours ?? 0) > 24
            ? 'degraded'
            : 'operational';
      return {
        state,
        detail: `${s.workforce.queueDepth} queued · ${s.workforce.awaitingApproval} awaiting approval${s.workforce.oldestApprovalHours !== null ? ` (oldest ${s.workforce.oldestApprovalHours.toFixed(1)} h)` : ''}`,
        evidence: ['workforce-jobs'],
      };
    }
    case 'automation-monitor': {
      if (!s.automation) return { state: 'unknown', detail: 'automation monitor unavailable', evidence: [] };
      const finished = s.automation.completed + s.automation.failed;
      const failRatio = finished > 0 ? s.automation.failed / finished : null;
      const state: ServiceState = failRatio === null ? 'operational' : failRatio > 0.5 ? 'failed' : failRatio > 0.2 ? 'degraded' : 'operational';
      return {
        state,
        detail:
          failRatio === null
            ? 'no finished automation runs yet'
            : `failure ratio ${(failRatio * 100).toFixed(0)}% over ${finished} finished run(s)`,
        evidence: ['automation-monitor'],
      };
    }
    case 'connectors': {
      if (!s.connectors) return { state: 'unknown', detail: 'connector service unavailable', evidence: [] };
      const configured = s.connectors.filter((c) => c.configured);
      if (configured.length === 0) return { state: 'operational', detail: 'no connectors configured (nothing to degrade)', evidence: [] };
      const healthy = configured.filter((c) => c.health === 'healthy').length;
      const ratio = healthy / configured.length;
      const state: ServiceState = ratio < 0.5 ? 'failed' : ratio < 0.8 ? 'degraded' : 'operational';
      return {
        state,
        detail: `${healthy}/${configured.length} configured connector(s) healthy`,
        evidence: configured.slice(0, 6).map((c) => c.id),
      };
    }
    case 'ai-engine': {
      if (s.aiState === null) return { state: 'unknown', detail: 'engine manager unavailable', evidence: [] };
      const state: ServiceState = s.aiState === 'ready' ? 'operational' : s.aiState === 'error' ? 'failed' : 'degraded';
      return { state, detail: `engine state: ${s.aiState}`, evidence: ['ai-engine-state'] };
    }
    case 'none-measured':
      return {
        state: 'unknown',
        detail: 'no measuring aggregate exists for this service (declared, not estimated)',
        evidence: [],
      };
    default:
      return { state: 'unknown', detail: 'unrecognized signal', evidence: [] };
  }
}

export function buildServiceCatalog(input: CatalogInput): ServiceCatalog {
  const gaps: OperationsGap[] = [];
  const unavailable: OperationsUnavailable[] = Object.entries(input.failures).map(([system, reason]) => ({
    system,
    reason,
  }));
  const s = input.signals;
  const liveKpis = new Set(s.kpiKeys ?? []);

  const domains = DOMAIN_REGISTRY.map((d) => {
    const owner = resolveOwner(d.owningUnitName, s.units, s.users);
    if (!owner) {
      gaps.push({ kind: 'ownership', subject: d.key, detail: `no org unit named "${d.owningUnitName}" — domain has no resolvable owner` });
    } else if (owner.leadUserId === null) {
      gaps.push({ kind: 'ownership', subject: d.key, detail: `unit "${owner.unitName}" has no lead assigned — ownership is a unit, not a person` });
    }
    return {
      key: d.key,
      label: d.label,
      owner,
      services: SERVICE_REGISTRY.filter((svc) => svc.domain === d.key).length,
    };
  });
  const ownerByDomain = new Map(domains.map((d) => [d.key, d.owner]));

  const entries: ServiceCatalogEntry[] = SERVICE_REGISTRY.map((svc) => {
    const st = serviceState(svc.signal, s);
    if (svc.signal === 'none-measured') {
      gaps.push({ kind: 'signal', subject: svc.id, detail: 'service has no measuring aggregate (declared)' });
    }
    const kpiJoin = svc.kpiKeys.map((key) => {
      const present = liveKpis.has(key);
      if (!present && s.kpiKeys !== null) {
        gaps.push({ kind: 'kpi', subject: svc.id, detail: `KPI key "${key}" not present in the live executive snapshot` });
      }
      return { key, present };
    });
    return {
      serviceId: svc.id,
      name: svc.name,
      description: svc.description,
      domain: svc.domain,
      signal: svc.signal,
      state: st.state,
      stateDetail: st.detail,
      owner: ownerByDomain.get(svc.domain) ?? null,
      slaTargetIds: [...svc.slaTargetIds],
      kpiKeys: kpiJoin,
      dependsOn: [...svc.dependsOn],
      evidence: st.evidence,
    };
  });

  return {
    generatedAt: input.nowIso,
    entries,
    domains,
    gaps,
    totals: {
      services: entries.length,
      operational: entries.filter((e) => e.state === 'operational').length,
      degraded: entries.filter((e) => e.state === 'degraded').length,
      failed: entries.filter((e) => e.state === 'failed').length,
      unknown: entries.filter((e) => e.state === 'unknown').length,
    },
    unavailable,
  };
}
