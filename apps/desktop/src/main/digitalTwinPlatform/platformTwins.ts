/**
 * Phase 6 Stage 13 — the platform twins (G-2).
 *
 * P15 shipped before every Phase 6 platform, so its nine domains have no view
 * of Stage 6–12. This module places the two side by side: P15's own domains,
 * composed VERBATIM from `TwinService.domains()`, and one twin row per Stage
 * 6–12 platform built from the pre-composed slice each platform already
 * publishes.
 *
 * No dashboard logic is duplicated. Each slice is a handful of numbers the
 * owning platform has already computed; Stage 13 only decides whether a row
 * reads `steady`, `attention` or `unknown`, and `unknown` is used honestly
 * whenever a platform could not be read. Pure; reads injected.
 */
import type {
  EtwinDomainRow,
  EtwinPlatformRow,
  EtwinPlatformTwins,
  EtwinTwinState,
  EtwinUnavailable,
  TwinDomains,
} from '@neuropause/shared';
import { PLATFORM_REGISTRY } from './twinRegistry';

export const PLATFORM_TWINS_DISCLOSURE =
  'The domain rows are P15’s own, composed verbatim — Stage 13 recomputes no twin health. Each platform row is built from the slice its owning platform already publishes, so `attention` means that platform reported something outstanding, not that Stage 13 assessed it. A platform that could not be read is `unknown`; it is never assumed steady.';

/** The narrow, already-computed slice each Stage 6–12 platform publishes. */
export interface PlatformSlices {
  s6Insight: { findings: number; criticalOrHigh: number } | null;
  s7Knowledge: { assets: number; gaps: number } | null;
  s8Automation: { automations: number; failures: number } | null;
  s9Operations: { posture: string; bottlenecks: number } | null;
  s10Strategy: { objectives: number; atRisk: number } | null;
  s11Federation: { partners: number; degraded: number } | null;
  s12Analytics: { kpis: number; regressing: number } | null;
}

export interface PlatformTwinsInput {
  nowIso: string;
  /** P15's own domain projection, or null when the twin could not be read. */
  domains: TwinDomains | null;
  slices: PlatformSlices;
  failures: Record<string, string>;
}

interface SliceView {
  state: EtwinTwinState;
  summary: string;
  metrics: { label: string; value: string }[];
}

/** `attention` when the owning platform reports outstanding work; never inferred. */
function view(attention: boolean, summary: string, metrics: { label: string; value: string }[]): SliceView {
  return { state: attention ? 'attention' : 'steady', summary, metrics };
}

const UNKNOWN: SliceView = {
  state: 'unknown',
  summary: 'Not readable this pass — no state is assumed.',
  metrics: [],
};

function sliceView(id: string, slices: PlatformSlices): SliceView {
  switch (id) {
    case 's6-insight': {
      const s = slices.s6Insight;
      if (s === null) return UNKNOWN;
      return view(
        s.criticalOrHigh > 0,
        `${s.findings} finding(s), ${s.criticalOrHigh} critical or high.`,
        [
          { label: 'Findings', value: String(s.findings) },
          { label: 'Critical/high', value: String(s.criticalOrHigh) },
        ],
      );
    }
    case 's7-knowledge': {
      const s = slices.s7Knowledge;
      if (s === null) return UNKNOWN;
      return view(s.gaps > 0, `${s.assets} asset(s) inventoried, ${s.gaps} coverage gap(s).`, [
        { label: 'Assets', value: String(s.assets) },
        { label: 'Gaps', value: String(s.gaps) },
      ]);
    }
    case 's8-automation': {
      const s = slices.s8Automation;
      if (s === null) return UNKNOWN;
      return view(s.failures > 0, `${s.automations} automation(s), ${s.failures} failing.`, [
        { label: 'Automations', value: String(s.automations) },
        { label: 'Failures', value: String(s.failures) },
      ]);
    }
    case 's9-operations': {
      const s = slices.s9Operations;
      if (s === null) return UNKNOWN;
      return view(
        s.bottlenecks > 0,
        `Posture ${s.posture}; ${s.bottlenecks} capacity bottleneck(s).`,
        [
          { label: 'Posture', value: s.posture },
          { label: 'Bottlenecks', value: String(s.bottlenecks) },
        ],
      );
    }
    case 's10-strategy': {
      const s = slices.s10Strategy;
      if (s === null) return UNKNOWN;
      return view(s.atRisk > 0, `${s.objectives} objective(s), ${s.atRisk} at risk.`, [
        { label: 'Objectives', value: String(s.objectives) },
        { label: 'At risk', value: String(s.atRisk) },
      ]);
    }
    case 's11-federation': {
      const s = slices.s11Federation;
      if (s === null) return UNKNOWN;
      return view(s.degraded > 0, `${s.partners} partner(s), ${s.degraded} degraded.`, [
        { label: 'Partners', value: String(s.partners) },
        { label: 'Degraded', value: String(s.degraded) },
      ]);
    }
    case 's12-analytics': {
      const s = slices.s12Analytics;
      if (s === null) return UNKNOWN;
      return view(s.regressing > 0, `${s.kpis} KPI(s) catalogued, ${s.regressing} regressing.`, [
        { label: 'KPIs', value: String(s.kpis) },
        { label: 'Regressing', value: String(s.regressing) },
      ]);
    }
    default:
      return UNKNOWN;
  }
}

function domainRows(domains: TwinDomains | null): EtwinDomainRow[] {
  if (domains === null) return [];
  return domains.domains.map((d) => ({
    id: d.id,
    label: d.name,
    entities: d.entityCount,
    band: d.band,
  }));
}

export function buildPlatformTwins(input: PlatformTwinsInput): EtwinPlatformTwins {
  const unavailable: EtwinUnavailable[] = Object.entries(input.failures).map(([system, reason]) => ({
    system,
    reason,
  }));

  const platforms: EtwinPlatformRow[] = PLATFORM_REGISTRY.map((def) => {
    const v = sliceView(def.id, input.slices);
    return {
      id: def.id,
      stage: def.stage,
      label: def.label,
      module: def.module,
      state: v.state,
      summary: v.summary,
      metrics: v.metrics,
    };
  });

  return {
    generatedAt: input.nowIso,
    domains: domainRows(input.domains),
    domainTotals:
      input.domains === null
        ? null
        : {
            domains: input.domains.domains.length,
            entities: input.domains.totalEntities,
            healthy: input.domains.healthyDomains,
            degraded: input.domains.degradedDomains,
          },
    platforms,
    totals: {
      platforms: platforms.length,
      steady: platforms.filter((p) => p.state === 'steady').length,
      attention: platforms.filter((p) => p.state === 'attention').length,
      unknown: platforms.filter((p) => p.state === 'unknown').length,
    },
    disclosure: PLATFORM_TWINS_DISCLOSURE,
    unavailable,
  };
}
