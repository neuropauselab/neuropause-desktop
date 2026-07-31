/**
 * Phase 6 Stage 10 — the executive dashboard + the board report. Both are
 * COMPOSITIONS of the already-computed views (objectives, portfolio, value,
 * planning, capability map, strategy health, executive KPIs). The dashboard's
 * recommendation list is the planning horizons' focus, deduped by id — the
 * Stage 9 Principle-C type throughout. The board report is sectioned,
 * evidence-cited text built from the same views (no new facts). Pure.
 */
import type {
  BoardReport,
  BusinessValueReport,
  CapabilityMapView,
  ObjectivesReport,
  OperationsRecommendation,
  PlanningReport,
  PortfolioReport,
  StrategyDashboard,
  StrategyHealthView,
} from '@neuropause/shared';
import { VALUE_DISCLOSURE } from './businessOutcome';
import { CAPABILITY_DISCLOSURE } from './capabilityMap';

export const STRATEGY_DISCLOSURES: readonly string[] = [
  'Objectives, initiatives, themes, and risks are code-shipped registry data; every view is computed per read from existing aggregates — nothing is persisted.',
  VALUE_DISCLOSURE,
  CAPABILITY_DISCLOSURE,
] as const;

export interface DashboardInputs {
  nowIso: string;
  objectives: ObjectivesReport;
  portfolio: PortfolioReport;
  value: BusinessValueReport;
  planning: PlanningReport;
  capabilities: CapabilityMapView;
  health: StrategyHealthView;
  kpis: { key: string; label: string; display: string; band: string | null }[];
}

export function composeStrategyDashboard(inp: DashboardInputs): StrategyDashboard {
  const seen = new Set<string>();
  const recommendations: OperationsRecommendation[] = [];
  for (const h of inp.planning.horizons) {
    for (const r of h.focus) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      recommendations.push(r);
    }
  }
  const unavailable = [
    ...inp.objectives.unavailable,
    ...inp.portfolio.unavailable,
    ...inp.value.unavailable,
    ...inp.planning.unavailable,
    ...inp.capabilities.unavailable,
    ...inp.health.unavailable,
  ].filter((u, i, arr) => arr.findIndex((x) => x.system === u.system) === i);

  return {
    generatedAt: inp.nowIso,
    objectives: { ...inp.objectives.totals, company: inp.objectives.company.length, departments: inp.objectives.departments.length },
    portfolio: inp.portfolio.totals,
    value: inp.value.totals,
    planning: { horizons: inp.planning.horizons.length, focusItems: recommendations.length },
    capabilities: {
      weakest: inp.capabilities.weakest?.key ?? null,
      unsupported: inp.capabilities.unsupported.length,
      lackingStandards: inp.capabilities.lackingStandards.length,
    },
    risks: {
      substantiated: inp.health.risks.filter((r) => r.substantiated).length,
      unsubstantiated: inp.health.risks.filter((r) => !r.substantiated).length,
    },
    kpis: inp.kpis,
    recommendations,
    disclosures: [...STRATEGY_DISCLOSURES],
    unavailable,
  };
}

export function composeBoardReport(inp: DashboardInputs): BoardReport {
  const o = inp.objectives.totals;
  const p = inp.portfolio.totals;
  const v = inp.value.totals;
  const current = inp.planning.horizons.find((h) => h.horizon === 'current-quarter');
  const substantiated = inp.health.risks.filter((r) => r.substantiated);
  return {
    generatedAt: inp.nowIso,
    title: `Enterprise strategy — board brief (${current?.label ?? 'current period'})`,
    sections: [
      {
        title: 'Objectives',
        lines: [
          `${inp.objectives.company.length} company + ${inp.objectives.departments.length} department objectives: ${o.onTrack} on-track · ${o.atRisk} at-risk · ${o.offTrack} off-track · ${o.unknown} unknown.`,
          ...inp.objectives.company
            .filter((x) => x.health !== 'on-track')
            .map((x) => `${x.label}: ${x.health.toUpperCase()} — ${x.healthDetail}`),
        ],
      },
      {
        title: 'Initiative portfolio',
        lines: [
          `${inp.portfolio.initiatives.length} initiatives: ${p.advancing} advancing · ${p.blocked} blocked · ${p.stalled} stalled · ${p.done} done · ${p.unknown} unknown.`,
          ...inp.portfolio.initiatives
            .filter((i) => i.state === 'blocked')
            .map((i) => `${i.label}: BLOCKED — ${i.blockers.map((b) => b.reason).join('; ')}`),
        ],
      },
      {
        title: 'Business value (computed, never estimated)',
        lines: [
          `${inp.value.decisions.length} governed decision(s): ${v.delivered} delivered · ${v.partial} partial · ${v.notYetObserved} not yet observed · ${v.unmeasurable} unmeasurable.`,
          inp.value.disclosure,
        ],
      },
      {
        title: 'Capabilities',
        lines: [
          inp.capabilities.weakest
            ? `Weakest: ${inp.capabilities.weakest.detail}`
            : 'No capability is judged weak by its readable evidence.',
          inp.capabilities.unsupported.length > 0
            ? `Unsupported by any initiative: ${inp.capabilities.unsupported.join(', ')}.`
            : 'Every capability has at least one supporting initiative.',
          inp.capabilities.lackingStandards.length > 0
            ? `Lacking matched knowledge standards: ${inp.capabilities.lackingStandards.join(', ')}.`
            : 'Every capability matched at least one knowledge standard.',
        ],
      },
      {
        title: 'Strategic risks',
        lines:
          substantiated.length === 0
            ? [`No strategic risk is currently substantiated by live signals (${inp.health.risks.length} registered, all quiet).`]
            : substantiated.map((r) => `${r.label}: ${r.detail}`),
      },
      {
        title: 'Executive focus (recommendations only — nothing executes from here)',
        lines:
          current && current.focus.length > 0
            ? current.focus.map((f) => `${f.priority.toUpperCase()} · ${f.title} → ${f.suggestedAction}`)
            : ['No focus items this quarter by the composed signals.'],
      },
    ],
  };
}
