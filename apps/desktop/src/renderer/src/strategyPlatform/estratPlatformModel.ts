/**
 * Phase 6 Stage 10 — the Strategy Platform tab's pure view-model (no DOM, no
 * React, no I/O; tested). Projects the read-only `estrat:*` surfaces — the
 * objectives report, initiative portfolio, business-value report, planning
 * report, capability map, strategy health, and executive dashboard — into
 * presentation rows. Everything renders what the main-process composition
 * computed; unknowns, gaps, disclosures, and unavailable reasons always ride
 * along — nothing is invented at the presentation layer either.
 */
import type {
  BusinessValueReport,
  CapabilityMapView,
  InitiativeState,
  ObjectiveHealthState,
  ObjectivesReport,
  OutcomeVerdict,
  PlanningReport,
  PortfolioReport,
  StrategyDashboard,
  StrategyHealthView,
} from '@neuropause/shared';
import type { IconName } from '@renderer/components/ui/Icon';

/** Presentation tone (the Stage 7/8/9 pattern — accepted by StatusBadge/Pill). */
export type EstratTone = 'green' | 'orange' | 'red' | 'blue' | 'gray';

/* ── tone maps (total; tested) ────────────────────────────────────────────── */

export function healthTone(state: ObjectiveHealthState): EstratTone {
  switch (state) {
    case 'on-track':
      return 'green';
    case 'at-risk':
      return 'orange';
    case 'off-track':
      return 'red';
    case 'unknown':
      return 'gray';
  }
}

export function initiativeTone(state: InitiativeState): EstratTone {
  switch (state) {
    case 'advancing':
      return 'green';
    case 'done':
      return 'blue';
    case 'stalled':
      return 'orange';
    case 'blocked':
      return 'red';
    case 'unknown':
      return 'gray';
  }
}

export function verdictTone(verdict: OutcomeVerdict): EstratTone {
  switch (verdict) {
    case 'delivered':
      return 'green';
    case 'partial':
      return 'blue';
    case 'not-yet-observed':
      return 'orange';
    case 'unmeasurable':
      return 'gray';
  }
}

/* ── header stats (dashboard) ─────────────────────────────────────────────── */

export interface EstratStat {
  label: string;
  value: string;
  hint: string;
  tone: EstratTone;
  icon: IconName;
}

export function estratHeaderStats(d: StrategyDashboard): EstratStat[] {
  const o = d.objectives;
  const p = d.portfolio;
  const v = d.value;
  return [
    {
      label: 'Objectives',
      value: `${o.onTrack}/${o.company + o.departments}`,
      hint: `${o.atRisk} at-risk · ${o.offTrack} off-track · ${o.unknown} unknown`,
      tone: o.offTrack > 0 ? 'red' : o.atRisk > 0 ? 'orange' : o.unknown > 0 ? 'gray' : 'green',
      icon: 'checklist',
    },
    {
      label: 'Portfolio',
      value: `${p.advancing + p.done}/${p.advancing + p.blocked + p.stalled + p.done + p.unknown}`,
      hint: `${p.blocked} blocked · ${p.stalled} stalled · ${p.done} done`,
      tone: p.blocked > 0 ? 'red' : p.stalled > 0 ? 'orange' : 'green',
      icon: 'bolt',
    },
    {
      label: 'Value',
      value: `${v.delivered} delivered`,
      hint: `${v.partial} partial · ${v.notYetObserved} not yet observed · ${v.unmeasurable} unmeasurable (computed, never estimated)`,
      tone: v.delivered > 0 ? 'green' : v.partial > 0 ? 'blue' : 'gray',
      icon: 'gauge',
    },
    {
      label: 'Capabilities',
      value: d.capabilities.weakest ?? 'none weak',
      hint: `${d.capabilities.unsupported} without initiatives · ${d.capabilities.lackingStandards} without matched standards`,
      tone: d.capabilities.unsupported > 0 ? 'orange' : 'green',
      icon: 'grid',
    },
    {
      label: 'Risks',
      value: `${d.risks.substantiated}/${d.risks.substantiated + d.risks.unsubstantiated}`,
      hint: 'substantiated by live signals / registered (quiet risks stay unsubstantiated — stated honestly)',
      tone: d.risks.substantiated > 0 ? 'red' : 'green',
      icon: 'shield',
    },
    {
      label: 'Focus',
      value: String(d.planning.focusItems),
      hint: `executive focus item(s) across ${d.planning.horizons} horizon(s) — recommendations only`,
      tone: d.planning.focusItems > 0 ? 'orange' : 'green',
      icon: 'pin',
    },
  ];
}

/* ── rows ─────────────────────────────────────────────────────────────────── */

export interface ObjectiveRow {
  id: string;
  label: string;
  kindText: string;
  health: ObjectiveHealthState;
  tone: EstratTone;
  healthDetail: string;
  ownerText: string;
  measureText: string;
  capabilityText: string;
}

export function objectiveRows(r: ObjectivesReport): ObjectiveRow[] {
  return [...r.company, ...r.departments].map((o) => ({
    id: o.id,
    label: o.label,
    kindText: o.kind === 'company' ? `company · ${o.unitName}` : `department · ${o.unitName}`,
    health: o.health,
    tone: healthTone(o.health),
    healthDetail: o.healthDetail,
    ownerText: o.owner
      ? `${o.owner.unitName}${o.owner.leadName ? ` · ${o.owner.leadName}` : ' · no lead assigned'}`
      : 'NO OWNER RESOLVED (gap)',
    measureText: o.measures.map((m) => `${m.ref}: ${m.reading ?? 'unreadable'}`).join(' · '),
    capabilityText: o.capabilityKeys.join(', '),
  }));
}

export interface InitiativeRow {
  id: string;
  label: string;
  state: InitiativeState;
  tone: EstratTone;
  stateDetail: string;
  ownerText: string;
  milestoneText: string;
  blockerText: string | null;
  capabilityText: string;
}

export function initiativeRows(r: PortfolioReport): InitiativeRow[] {
  return r.initiatives.map((i) => ({
    id: i.id,
    label: i.label,
    state: i.state,
    tone: initiativeTone(i.state),
    stateDetail: i.stateDetail,
    ownerText: i.owner
      ? `${i.owner.unitName}${i.owner.leadName ? ` · ${i.owner.leadName}` : ' · no lead assigned'}`
      : 'ownership gap',
    milestoneText: i.milestones
      .map((m) => `${m.label}: ${m.satisfied === null ? 'not evaluable' : m.satisfied ? 'satisfied' : 'unmet'}`)
      .join(' · '),
    blockerText: i.blockers.length > 0 ? i.blockers.map((b) => b.reason).join('; ') : null,
    capabilityText: i.capabilityKeys.join(', '),
  }));
}

export interface ValueRow {
  decisionId: string;
  title: string;
  category: string;
  verdict: OutcomeVerdict;
  tone: EstratTone;
  verdictDetail: string;
  stageText: string;
  deltaText: string;
}

export function valueRows(r: BusinessValueReport): ValueRow[] {
  return r.decisions.map((d) => ({
    decisionId: d.decisionId,
    title: d.title,
    category: d.category,
    verdict: d.verdict,
    tone: verdictTone(d.verdict),
    verdictDetail: d.verdictDetail,
    stageText: d.outcomeStage ? `outcome loop: ${d.outcomeStage}` : 'no verification link',
    deltaText: d.deltas.map((x) => `${x.label}: ${x.detail}`).join(' · '),
  }));
}

export interface CapabilityRow {
  key: string;
  label: string;
  condition: ObjectiveHealthState;
  tone: EstratTone;
  coverageText: string;
  ownerText: string;
  countsText: string;
  gapText: string | null;
  riskText: string;
}

export function capabilityRows(c: CapabilityMapView): CapabilityRow[] {
  return c.capabilities.map((x) => ({
    key: x.key,
    label: x.label,
    condition: x.condition,
    tone: healthTone(x.condition),
    coverageText: `evidence coverage ${(x.evidenceCoverage * 100).toFixed(0)}%`,
    ownerText: x.owner
      ? `${x.owner.unitName}${x.owner.leadName ? ` · ${x.owner.leadName}` : ' · no lead assigned'}`
      : 'ownership gap',
    countsText: `${x.objectives.total} objective(s) · ${x.initiatives.total} initiative(s) · attention ${x.decisionAttention} · ${x.kpis.length} KPI(s)`,
    gapText: x.gaps.length > 0 ? x.gaps.join('; ') : null,
    riskText: x.operationalRisk.detail,
  }));
}

export interface RiskRow {
  id: string;
  label: string;
  substantiated: boolean;
  tone: EstratTone;
  detail: string;
  capabilityText: string;
}

export function riskRows(h: StrategyHealthView): RiskRow[] {
  return h.risks.map((r) => ({
    id: r.id,
    label: r.label,
    substantiated: r.substantiated,
    tone: r.substantiated ? 'red' : 'green',
    detail: r.detail,
    capabilityText: r.capabilityKeys.join(', '),
  }));
}

export interface FocusRow {
  id: string;
  horizonLabel: string;
  title: string;
  priority: string;
  tone: EstratTone;
  detail: string;
  suggestedAction: string;
  principleC: string;
}

export function focusRows(p: PlanningReport): FocusRow[] {
  return p.horizons.flatMap((h) =>
    h.focus.map((r) => ({
      id: r.id,
      horizonLabel: h.label,
      title: r.title,
      priority: r.priority,
      tone: (r.priority === 'critical' ? 'red' : r.priority === 'high' ? 'orange' : r.priority === 'medium' ? 'blue' : 'gray') as EstratTone,
      detail: r.detail,
      suggestedAction: r.suggestedAction,
      principleC: `Impact: ${r.operationalImpact} Outcome: ${r.expectedBusinessOutcome} Rollback: ${r.rollbackImplications} (confidence ${(r.confidence * 100).toFixed(0)}%, ${r.evidence.length} evidence ref(s))`,
    })),
  );
}

export interface AlignmentRow {
  unitName: string;
  aligned: boolean;
  tone: EstratTone;
  detail: string;
}

export function alignmentRows(h: StrategyHealthView): AlignmentRow[] {
  return h.alignment.map((a) => ({
    unitName: a.unitName,
    aligned: a.aligned,
    tone: a.aligned ? 'green' : 'orange',
    detail: a.detail,
  }));
}

/* ── honesty strips ───────────────────────────────────────────────────────── */

export function unavailableLines(parts: { unavailable: { system: string; reason: string }[] }[]): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const part of parts) {
    for (const u of part.unavailable) {
      const line = `${u.system}: ${u.reason}`;
      if (seen.has(line)) continue;
      seen.add(line);
      lines.push(line);
    }
  }
  return lines;
}
