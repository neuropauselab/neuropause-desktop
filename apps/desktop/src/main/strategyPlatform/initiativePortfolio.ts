/**
 * Phase 6 Stage 10 — the initiative portfolio (D-2): registry initiatives ×
 * EXISTING records (UDM project entities, Stage 8 playbooks + monitor, Stage 9
 * services + SLAs + readiness, governed decisions). Milestones are OBSERVABLE
 * CONDITIONS evaluated against live signals — true/false when evaluable, null
 * (with the reason) when not. State composes honestly: all milestones true →
 * done; any blocker (failed source, breached SLA it depends on) → blocked WITH
 * evidence; some progress → advancing; readable-but-unmoving → stalled;
 * nothing readable → unknown. Pure; reads injected.
 */
import type {
  InitiativeSourceReading,
  InitiativeState,
  InitiativeView,
  MilestoneCondition,
  MilestoneReading,
  PortfolioReport,
  StrategyGap,
  StrategyUnavailable,
} from '@neuropause/shared';
import { resolveOwner } from '../operationsPlatform/serviceCatalog';
import { CAPABILITY_BY_KEY, INITIATIVE_REGISTRY } from './strategyRegistry';

export interface PortfolioSignals {
  slaStatuses: { targetId: string; status: 'met' | 'breached' | 'unmeasurable'; detail: string }[] | null;
  readiness: { key: string; state: string; detail: string }[] | null;
  kpis: { key: string; band: string | null; display: string }[] | null;
  apFindings: { kind: string; severity: string }[] | null;
  playbooks: { id: string; version: number }[] | null;
  s9Services: { serviceId: string; state: string; stateDetail: string }[] | null;
  projects: { id: string; title: string; syncState: string; status: string | null }[] | null;
  decisions: { id: string; category: string; status: string }[] | null;
  minedTypes: string[] | null;
}

export interface PortfolioInput {
  nowIso: string;
  signals: PortfolioSignals;
  units: { id: string; name: string; leadUserId: string | null }[] | null;
  users: { id: string; name: string }[] | null;
  failures: Record<string, string>;
}

export function readSource(ref: { kind: string; ref: string }, s: PortfolioSignals): InitiativeSourceReading {
  switch (ref.kind) {
    case 'playbook': {
      const pb = s.playbooks?.find((p) => p.id === ref.ref);
      return pb
        ? { kind: 'playbook', ref: ref.ref, available: true, summary: `playbook v${pb.version} shipped` }
        : { kind: 'playbook', ref: ref.ref, available: false, summary: 'playbook registry unreadable or id missing' };
    }
    case 's9-service': {
      const svc = s.s9Services?.find((x) => x.serviceId === ref.ref);
      return svc
        ? { kind: 's9-service', ref: ref.ref, available: true, summary: `${svc.state} — ${svc.stateDetail}` }
        : { kind: 's9-service', ref: ref.ref, available: false, summary: 'service catalog unreadable' };
    }
    case 'project-entities': {
      if (s.projects === null) return { kind: 'project-entities', ref: ref.ref, available: false, summary: 'UDM project query unreadable' };
      const active = s.projects.filter((p) => p.syncState === 'active');
      return {
        kind: 'project-entities',
        ref: ref.ref,
        available: true,
        summary: `${active.length} active project entit${active.length === 1 ? 'y' : 'ies'} (of ${s.projects.length} synced)`,
      };
    }
    case 'decision-category': {
      if (s.decisions === null) return { kind: 'decision-category', ref: ref.ref, available: false, summary: 'decision store unreadable' };
      const inCat = s.decisions.filter((d) => d.category === ref.ref);
      return { kind: 'decision-category', ref: ref.ref, available: true, summary: `${inCat.length} governed decision(s) in category` };
    }
    case 'mined-process': {
      if (s.minedTypes === null) return { kind: 'mined-process', ref: ref.ref, available: false, summary: 'process mining unreadable' };
      const mined = s.minedTypes.includes(ref.ref);
      return { kind: 'mined-process', ref: ref.ref, available: true, summary: mined ? 'process mined from real events' : 'no cases mined yet (declared)' };
    }
    default:
      return { kind: ref.kind as InitiativeSourceReading['kind'], ref: ref.ref, available: false, summary: 'unrecognized source kind' };
  }
}

export function evaluateMilestone(m: MilestoneCondition, s: PortfolioSignals): MilestoneReading {
  const p = m.predicate;
  if (p.kind === 'sla-met') {
    const sla = s.slaStatuses?.find((x) => x.targetId === p.targetId);
    if (!sla) return { id: m.id, label: m.label, satisfied: null, detail: 'SLA status unreadable — not evaluable now' };
    if (sla.status === 'unmeasurable') return { id: m.id, label: m.label, satisfied: null, detail: `SLA declared unmeasurable: ${sla.detail}` };
    return { id: m.id, label: m.label, satisfied: sla.status === 'met', detail: sla.detail };
  }
  if (p.kind === 'readiness-ready') {
    const dim = s.readiness?.find((d) => d.key === p.dimension);
    if (!dim) return { id: m.id, label: m.label, satisfied: null, detail: 'readiness unreadable — not evaluable now' };
    if (dim.state === 'unknown') return { id: m.id, label: m.label, satisfied: null, detail: `readiness is unknown: ${dim.detail}` };
    return { id: m.id, label: m.label, satisfied: dim.state === 'ready', detail: `${p.dimension}: ${dim.state}` };
  }
  if (p.kind === 'kpi-healthy') {
    const kpi = s.kpis?.find((k) => k.key === p.key);
    if (!kpi) return { id: m.id, label: m.label, satisfied: null, detail: 'KPI not present in the live snapshot' };
    if (kpi.band === null) return { id: m.id, label: m.label, satisfied: null, detail: 'KPI carries no band' };
    return { id: m.id, label: m.label, satisfied: kpi.band === 'healthy', detail: `${p.key}: ${kpi.band}` };
  }
  if (p.kind === 'monitor-clear') {
    if (s.apFindings === null) return { id: m.id, label: m.label, satisfied: null, detail: 'automation monitor unreadable' };
    const hits = s.apFindings.filter((f) => f.kind === p.findingKind).length;
    return { id: m.id, label: m.label, satisfied: hits === 0, detail: hits === 0 ? `no ${p.findingKind} findings` : `${hits} ${p.findingKind} finding(s) open` };
  }
  // decisions-executed — 'completed' is the real terminal success status.
  if (s.decisions === null) return { id: m.id, label: m.label, satisfied: null, detail: 'decision store unreadable' };
  const completed = s.decisions.filter((d) => d.category === p.category && d.status === 'completed').length;
  return {
    id: m.id,
    label: m.label,
    satisfied: completed >= p.atLeast,
    detail: `${completed} completed decision(s) in '${p.category}' (need ≥ ${p.atLeast})`,
  };
}

function composeState(
  sources: InitiativeSourceReading[],
  milestones: MilestoneReading[],
): { state: InitiativeState; detail: string; blockers: { reason: string; evidence: string[] }[] } {
  const blockers: { reason: string; evidence: string[] }[] = [];
  for (const src of sources) {
    if (src.kind === 's9-service' && src.available && (src.summary.startsWith('failed') || src.summary.startsWith('degraded'))) {
      blockers.push({ reason: `depended-on service is ${src.summary.split(' ')[0]}`, evidence: [src.ref] });
    }
    if (!src.available) blockers.push({ reason: `source unreadable: ${src.summary}`, evidence: [src.ref] });
  }
  for (const m of milestones) {
    if (m.satisfied === false && /BREACHED|breached/.test(m.detail)) {
      blockers.push({ reason: `milestone blocked by an SLA breach: ${m.label}`, evidence: [m.id] });
    }
  }

  const evaluable = milestones.filter((m) => m.satisfied !== null);
  const satisfied = evaluable.filter((m) => m.satisfied === true);
  if (evaluable.length === 0 && sources.every((s) => !s.available)) {
    return { state: 'unknown', detail: 'no source or milestone was readable — state is unknown, not assumed', blockers };
  }
  if (evaluable.length > 0 && satisfied.length === evaluable.length && evaluable.length === milestones.length) {
    return { state: 'done', detail: `all ${milestones.length} milestone condition(s) currently satisfied`, blockers };
  }
  if (blockers.some((b) => b.reason.includes('breach') || b.reason.includes('failed'))) {
    return { state: 'blocked', detail: blockers.map((b) => b.reason).join('; '), blockers };
  }
  if (satisfied.length > 0) {
    return { state: 'advancing', detail: `${satisfied.length}/${milestones.length} milestone condition(s) satisfied`, blockers };
  }
  return {
    state: 'stalled',
    detail: `0/${evaluable.length} evaluable milestone condition(s) satisfied${milestones.length - evaluable.length > 0 ? ` (${milestones.length - evaluable.length} not evaluable)` : ''}`,
    blockers,
  };
}

export function buildPortfolio(input: PortfolioInput): PortfolioReport {
  const gaps: StrategyGap[] = [];
  const unavailable: StrategyUnavailable[] = Object.entries(input.failures).map(([system, reason]) => ({ system, reason }));

  const initiatives: InitiativeView[] = INITIATIVE_REGISTRY.map((def) => {
    const sources = def.sources.map((s) => readSource(s, input.signals));
    const milestones = def.milestones.map((m) => evaluateMilestone(m, input.signals));
    const composed = composeState(sources, milestones);
    // Ownership follows the initiative's FIRST capability's owning unit.
    const capability = CAPABILITY_BY_KEY.get(def.capabilityKeys[0]);
    const owner = capability ? resolveOwner(capability.owningUnitName, input.units, input.users) : null;
    if (!owner) gaps.push({ kind: 'ownership', subject: def.id, detail: 'no resolvable owning unit via the capability map' });
    for (const src of sources) {
      if (!src.available) gaps.push({ kind: 'source', subject: def.id, detail: `${src.kind}:${src.ref} — ${src.summary}` });
    }
    return {
      id: def.id,
      label: def.label,
      description: def.description,
      companyObjectiveId: def.companyObjectiveId,
      capabilityKeys: [...def.capabilityKeys],
      owner,
      state: composed.state,
      stateDetail: composed.detail,
      sources,
      milestones,
      blockers: composed.blockers,
      dependsOn: [...def.dependsOn],
    };
  });

  return {
    generatedAt: input.nowIso,
    initiatives,
    totals: {
      advancing: initiatives.filter((i) => i.state === 'advancing').length,
      blocked: initiatives.filter((i) => i.state === 'blocked').length,
      stalled: initiatives.filter((i) => i.state === 'stalled').length,
      done: initiatives.filter((i) => i.state === 'done').length,
      unknown: initiatives.filter((i) => i.state === 'unknown').length,
    },
    gaps,
    unavailable,
  };
}
