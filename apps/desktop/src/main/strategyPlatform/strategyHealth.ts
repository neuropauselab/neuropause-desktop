/**
 * Phase 6 Stage 10 — strategy health (D-5): themes, the five composed layers
 * (S6 intelligence, S7 knowledge, S8 automation, S9 operations, P14 platform
 * strategy — P14 as ONE injected input, the P19←P7 precedent), the Capability
 * Map, the strategic risk register (substantiated ONLY by live signals — a
 * quiet risk reports `unsubstantiated`, never invented severity), and the
 * unit→company-objective alignment view. Per-layer isolation: a failing layer
 * degrades to unknown with the reason. Pure.
 */
import type {
  CapabilityMapView,
  ObjectiveHealthState,
  ObjectivesReport,
  StrategicRiskView,
  StrategyHealthView,
  StrategyUnavailable,
} from '@neuropause/shared';
import { COMPANY_OBJECTIVE_REGISTRY, DEPARTMENT_OBJECTIVE_REGISTRY, RISK_REGISTRY, THEME_REGISTRY } from './strategyRegistry';

export interface LayerSignals {
  /** S6: overall band or null. */
  insightBand: string | null;
  /** S7: knowledge asset total + hygiene finding count, or null. */
  knowledge: { assets: number; findings: number } | null;
  /** S8: monitor finding count (critical/high), or null. */
  automation: { criticalFindings: number; totalFindings: number } | null;
  /** S9: readiness totals, or null. */
  operations: { ready: number; notReady: number; unknown: number } | null;
  /** P14: the platform-strategy overview slice, or null. */
  p14: { goalsOnTrack: number; goalsTotal: number; healthBand: string } | null;
}

export interface RiskSignals {
  slaStatuses: { targetId: string; status: string; detail: string }[] | null;
  readiness: { key: string; state: string; detail: string }[] | null;
  apFindings: { kind: string; severity: string }[] | null;
  incidentDomains: { domain: string | null; severity: string }[] | null;
}

export interface StrategyHealthInput {
  nowIso: string;
  objectives: ObjectivesReport;
  capabilities: CapabilityMapView;
  layers: LayerSignals;
  risks: RiskSignals;
  units: { id: string; name: string }[] | null;
  failures: Record<string, string>;
}

const RANK: Record<ObjectiveHealthState, number> = { 'on-track': 0, unknown: 1, 'at-risk': 2, 'off-track': 3 };

export function buildRiskViews(s: RiskSignals): StrategicRiskView[] {
  return RISK_REGISTRY.map((def) => {
    const evidence = def.evidencedBy.map((e) => {
      if (e.kind === 'sla-target') {
        const sla = s.slaStatuses?.find((x) => x.targetId === e.ref);
        return { kind: e.kind, ref: e.ref, live: sla?.status === 'breached', detail: sla ? sla.detail : 'SLA status unreadable' };
      }
      if (e.kind === 'readiness-dimension') {
        const d = s.readiness?.find((x) => x.key === e.ref);
        return { kind: e.kind, ref: e.ref, live: d?.state === 'not-ready' || d?.state === 'degraded', detail: d ? `${e.ref}: ${d.state}` : 'readiness unreadable' };
      }
      if (e.kind === 'ap-finding-kind') {
        const hits = (s.apFindings ?? []).filter((f) => f.kind === e.ref).length;
        return { kind: e.kind, ref: e.ref, live: hits > 0, detail: s.apFindings === null ? 'monitor unreadable' : `${hits} ${e.ref} finding(s)` };
      }
      const hits = (s.incidentDomains ?? []).filter((i) => i.domain === e.ref && i.severity !== 'info').length;
      return { kind: e.kind, ref: e.ref, live: hits > 0, detail: s.incidentDomains === null ? 'incidents unreadable' : `${hits} open incident(s) in domain` };
    });
    const substantiated = evidence.some((e) => e.live);
    return {
      id: def.id,
      label: def.label,
      description: def.description,
      capabilityKeys: [...def.capabilityKeys],
      substantiated,
      evidence,
      detail: substantiated
        ? `SUBSTANTIATED by live signals: ${evidence.filter((e) => e.live).map((e) => e.detail).join('; ')}`
        : 'unsubstantiated — its evidencing signals are currently quiet (stated honestly, not escalated)',
    };
  });
}

export function buildStrategyHealth(input: StrategyHealthInput): StrategyHealthView {
  const unavailable: StrategyUnavailable[] = Object.entries(input.failures).map(([system, reason]) => ({ system, reason }));
  const allObjectives = [...input.objectives.company, ...input.objectives.departments];

  const themes = THEME_REGISTRY.map((t) => {
    const themeObjectiveIds = COMPANY_OBJECTIVE_REGISTRY.filter((o) => o.themeId === t.id).map((o) => o.id);
    const views = allObjectives.filter(
      (o) => themeObjectiveIds.includes(o.id) || (o.companyObjectiveId !== null && themeObjectiveIds.includes(o.companyObjectiveId)),
    );
    if (views.length === 0) return { id: t.id, label: t.label, state: 'unknown' as ObjectiveHealthState, detail: 'no objectives bound to this theme' };
    const worst = views.reduce((acc, v) => (RANK[v.health] > RANK[acc] ? v.health : acc), 'on-track' as ObjectiveHealthState);
    return {
      id: t.id,
      label: t.label,
      state: worst,
      detail: `${views.length} objective(s); worst: ${worst} (${views.filter((v) => v.health === worst).map((v) => v.id).join(', ')})`,
    };
  });

  const L = input.layers;
  const layers: StrategyHealthView['layers'] = [
    {
      layer: 'intelligence',
      state: L.insightBand === null ? 'unknown' : L.insightBand === 'healthy' ? 'on-track' : 'at-risk',
      detail: L.insightBand === null ? 'Stage 6 framework unreadable' : `Stage 6 overall band: ${L.insightBand}`,
    },
    {
      layer: 'knowledge',
      state: L.knowledge === null ? 'unknown' : L.knowledge.findings === 0 ? 'on-track' : 'at-risk',
      detail: L.knowledge === null ? 'Stage 7 inventory unreadable' : `${L.knowledge.assets} asset(s), ${L.knowledge.findings} hygiene finding(s)`,
    },
    {
      layer: 'automation',
      state: L.automation === null ? 'unknown' : L.automation.criticalFindings === 0 ? 'on-track' : 'at-risk',
      detail: L.automation === null ? 'Stage 8 monitor unreadable' : `${L.automation.criticalFindings} critical/high of ${L.automation.totalFindings} finding(s)`,
    },
    {
      layer: 'operations',
      state:
        L.operations === null
          ? 'unknown'
          : L.operations.notReady > 0
            ? 'off-track'
            : L.operations.unknown > 0
              ? 'at-risk'
              : 'on-track',
      detail: L.operations === null ? 'Stage 9 readiness unreadable' : `${L.operations.ready} ready · ${L.operations.notReady} not-ready · ${L.operations.unknown} unknown`,
    },
    {
      layer: 'p14-strategy',
      state:
        L.p14 === null
          ? 'unknown'
          : L.p14.goalsTotal > 0 && L.p14.goalsOnTrack === L.p14.goalsTotal
            ? 'on-track'
            : L.p14.healthBand === 'critical'
              ? 'off-track'
              : 'at-risk',
      detail: L.p14 === null ? 'P14 overview unreadable' : `${L.p14.goalsOnTrack}/${L.p14.goalsTotal} platform goal(s) on track (band ${L.p14.healthBand}) — composed, not duplicated`,
    },
  ];

  // Alignment: every unit with a department objective, rolled to company objectives.
  const byUnit = new Map<string, string[]>();
  for (const d of DEPARTMENT_OBJECTIVE_REGISTRY) {
    byUnit.set(d.unitName, [...new Set([...(byUnit.get(d.unitName) ?? []), d.companyObjectiveId])]);
  }
  const alignment = (input.units ?? []).map((u) => {
    const companyObjectiveIds = byUnit.get(u.name) ?? [];
    return {
      unitName: u.name,
      companyObjectiveIds,
      aligned: companyObjectiveIds.length > 0,
      detail:
        companyObjectiveIds.length > 0
          ? `contributes to ${companyObjectiveIds.join(', ')}`
          : 'no department objective binds this unit to a company objective (an alignment gap, stated honestly)',
    };
  });

  return {
    generatedAt: input.nowIso,
    themes,
    layers,
    capabilities: input.capabilities,
    risks: buildRiskViews(input.risks),
    alignment,
    unavailable,
  };
}
