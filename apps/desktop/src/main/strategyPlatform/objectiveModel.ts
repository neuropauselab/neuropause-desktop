/**
 * Phase 6 Stage 10 — objectives (D-1): registry objectives × live measures.
 *
 * A measure is ALWAYS an existing aggregate: an executive KPI band, a Stage 9
 * SLA status, or a Stage 6 domain band. Health is computed, never asserted:
 * any breached measure drags the objective to at-risk (≥ half → off-track);
 * an objective whose EVERY measure is unreadable/unmeasurable is `unknown`;
 * declared-unmeasurable measures on an otherwise-good objective stay visible
 * in the detail (never silently dropped). Ownership resolves live org units
 * via the Stage 9 resolver; a unit without a lead is an honest gap. Pure.
 */
import type {
  MeasureReading,
  ObjectiveHealthState,
  ObjectiveMeasureRef,
  ObjectivesReport,
  ObjectiveView,
  StrategyGap,
  StrategyUnavailable,
} from '@neuropause/shared';
import { resolveOwner } from '../operationsPlatform/serviceCatalog';
import { COMPANY_OBJECTIVE_REGISTRY, DEPARTMENT_OBJECTIVE_REGISTRY } from './strategyRegistry';

/** The thin live-signal slice objectives read (injected by the root). */
export interface MeasureSignals {
  kpis: { key: string; band: string | null; display: string }[] | null;
  slaStatuses: { targetId: string; status: 'met' | 'breached' | 'unmeasurable'; detail: string }[] | null;
  domains: { key: string; band: string; score: number | null }[] | null;
}

export interface ObjectivesInput {
  nowIso: string;
  signals: MeasureSignals;
  units: { id: string; name: string; leadUserId: string | null }[] | null;
  users: { id: string; name: string }[] | null;
  failures: Record<string, string>;
}

const GOOD_BANDS = new Set(['healthy']);
const BAD_BANDS = new Set(['at-risk', 'critical', 'watch']);

export function readMeasure(m: ObjectiveMeasureRef, s: MeasureSignals): MeasureReading {
  if (m.kind === 'kpi') {
    const kpi = s.kpis?.find((k) => k.key === m.ref);
    if (!kpi) return { kind: m.kind, ref: m.ref, reading: null, state: 'unknown', detail: 'KPI not present in the live executive snapshot' };
    if (kpi.band === null || kpi.band === undefined)
      return { kind: m.kind, ref: m.ref, reading: kpi.display, state: 'unknown', detail: 'KPI carries no band (status metric)' };
    const good = GOOD_BANDS.has(kpi.band);
    return {
      kind: m.kind,
      ref: m.ref,
      reading: `${kpi.display} (${kpi.band})`,
      state: good ? 'good' : BAD_BANDS.has(kpi.band) ? 'bad' : 'unknown',
      detail: `live executive KPI band: ${kpi.band}`,
    };
  }
  if (m.kind === 'sla') {
    const sla = s.slaStatuses?.find((x) => x.targetId === m.ref);
    if (!sla) return { kind: m.kind, ref: m.ref, reading: null, state: 'unknown', detail: 'SLA status unreadable this pass' };
    if (sla.status === 'unmeasurable')
      return { kind: m.kind, ref: m.ref, reading: 'unmeasurable', state: 'unknown', detail: sla.detail };
    return {
      kind: m.kind,
      ref: m.ref,
      reading: sla.status,
      state: sla.status === 'met' ? 'good' : 'bad',
      detail: sla.detail,
    };
  }
  const domain = s.domains?.find((d) => d.key === m.ref);
  if (!domain) return { kind: m.kind, ref: m.ref, reading: null, state: 'unknown', detail: 'Stage 6 domain unreadable this pass' };
  if (domain.band === 'unknown')
    return { kind: m.kind, ref: m.ref, reading: 'unknown', state: 'unknown', detail: 'the domain itself is unknown (sources unavailable)' };
  const good = GOOD_BANDS.has(domain.band);
  return {
    kind: m.kind,
    ref: m.ref,
    reading: `${domain.score ?? '—'} (${domain.band})`,
    state: good ? 'good' : 'bad',
    detail: `Stage 6 domain band: ${domain.band}`,
  };
}

export function healthFrom(measures: MeasureReading[]): { health: ObjectiveHealthState; detail: string } {
  const bad = measures.filter((m) => m.state === 'bad');
  const good = measures.filter((m) => m.state === 'good');
  const unknown = measures.filter((m) => m.state === 'unknown');
  if (measures.length === 0) return { health: 'unknown', detail: 'no measures declared' };
  if (bad.length > 0) {
    const off = bad.length * 2 >= measures.length;
    return {
      health: off ? 'off-track' : 'at-risk',
      detail: `${bad.length}/${measures.length} measure(s) failing: ${bad.map((m) => m.ref).join(', ')}`,
    };
  }
  if (good.length === 0) return { health: 'unknown', detail: 'no measure was readable — health is unknown, not assumed' };
  if (unknown.length > 0) {
    return {
      health: 'on-track',
      detail: `all ${good.length} measurable measure(s) good; ${unknown.length} unmeasurable/unreadable declared (${unknown.map((m) => m.ref).join(', ')})`,
    };
  }
  return { health: 'on-track', detail: `all ${good.length} measure(s) good` };
}

export function buildObjectivesReport(input: ObjectivesInput): ObjectivesReport {
  const gaps: StrategyGap[] = [];
  const unavailable: StrategyUnavailable[] = Object.entries(input.failures).map(([system, reason]) => ({ system, reason }));

  const mkOwner = (unitName: string, subject: string) => {
    const owner = resolveOwner(unitName, input.units, input.users);
    if (!owner) gaps.push({ kind: 'ownership', subject, detail: `no org unit named "${unitName}"` });
    else if (owner.leadUserId === null) gaps.push({ kind: 'ownership', subject, detail: `unit "${owner.unitName}" has no lead assigned` });
    return owner;
  };

  const departments: ObjectiveView[] = DEPARTMENT_OBJECTIVE_REGISTRY.map((o) => {
    const measures = o.measures.map((m) => readMeasure(m, input.signals));
    const h = healthFrom(measures);
    return {
      id: o.id,
      kind: 'department',
      label: o.label,
      description: '',
      themeId: null,
      horizon: null,
      owner: mkOwner(o.unitName, o.id),
      unitName: o.unitName,
      companyObjectiveId: o.companyObjectiveId,
      capabilityKeys: [...o.capabilityKeys],
      measures,
      health: h.health,
      healthDetail: h.detail,
      rollup: [],
    };
  });

  const company: ObjectiveView[] = COMPANY_OBJECTIVE_REGISTRY.map((o) => {
    const measures = o.measures.map((m) => readMeasure(m, input.signals));
    const own = healthFrom(measures);
    const children = departments.filter((d) => d.companyObjectiveId === o.id);
    // A company objective cannot outrank its worst rolling-up department.
    const rank: Record<ObjectiveHealthState, number> = { 'on-track': 0, unknown: 1, 'at-risk': 2, 'off-track': 3 };
    const worstChild = children.reduce<ObjectiveHealthState | null>(
      (acc, c) => (acc === null || rank[c.health] > rank[acc] ? c.health : acc),
      null,
    );
    let health = own.health;
    let detail = own.detail;
    if (worstChild !== null && rank[worstChild] > rank[health] && worstChild !== 'unknown') {
      health = worstChild;
      detail = `${own.detail}; dragged by department rollup (${children.filter((c) => c.health === worstChild).map((c) => c.id).join(', ')})`;
    }
    return {
      id: o.id,
      kind: 'company',
      label: o.label,
      description: o.description,
      themeId: o.themeId,
      horizon: o.horizon,
      owner: mkOwner(o.owningUnitName, o.id),
      unitName: o.owningUnitName,
      companyObjectiveId: null,
      capabilityKeys: [...o.capabilityKeys],
      measures,
      health,
      healthDetail: detail,
      rollup: children.map((c) => c.id),
    };
  });

  const all = [...company, ...departments];
  return {
    generatedAt: input.nowIso,
    company,
    departments,
    totals: {
      onTrack: all.filter((o) => o.health === 'on-track').length,
      atRisk: all.filter((o) => o.health === 'at-risk').length,
      offTrack: all.filter((o) => o.health === 'off-track').length,
      unknown: all.filter((o) => o.health === 'unknown').length,
    },
    gaps,
    unavailable,
  };
}
