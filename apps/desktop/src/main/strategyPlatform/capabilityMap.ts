/**
 * Phase 6 Stage 10 — the Enterprise Capability Map (the approved enhancement).
 *
 * Twelve BUSINESS capabilities, each analyzed from its DECLARED evidence
 * signals (insight domains, KPIs, S9 services/readiness, mined processes,
 * compliance checks) plus the registry cross-references (objectives,
 * initiatives, risks, KPI map, decision categories) and the Stage 7 standards
 * join. Honesty rules: a capability with thin readable evidence carries a low
 * `evidenceCoverage` and an `unknown` condition rather than an invented score;
 * "investment focus" is ATTENTION COUNTS (initiatives + recent decisions),
 * never currency — the disclosure states it. Pure; reads injected.
 */
import type {
  CapabilityAnalysis,
  CapabilityMapView,
  InitiativeView,
  ObjectiveView,
  ObjectiveHealthState,
  StrategyUnavailable,
} from '@neuropause/shared';
import { resolveOwner } from '../operationsPlatform/serviceCatalog';
import {
  CAPABILITY_REGISTRY,
  DECISION_CATEGORY_CAPABILITIES,
  KPI_CAPABILITY_REGISTRY,
  RISK_REGISTRY,
} from './strategyRegistry';

export const CAPABILITY_DISCLOSURE =
  'Capability condition composes only the declared live evidence signals; investment focus counts initiatives and governed decisions (attention), never currency — the platform records no costs.';

export interface CapabilitySignals {
  domains: { key: string; band: string; score: number | null }[] | null;
  kpis: { key: string; band: string | null; display: string }[] | null;
  s9Services: { serviceId: string; state: string }[] | null;
  readiness: { key: string; state: string }[] | null;
  minedTypes: string[] | null;
  compliance: { status: string }[] | null;
  slaStatuses: { targetId: string; status: string }[] | null;
  apFindings: { kind: string; severity: string }[] | null;
  decisions: { category: string; status: string }[] | null;
}

export interface CapabilityInput {
  nowIso: string;
  signals: CapabilitySignals;
  objectives: Pick<ObjectiveView, 'id' | 'capabilityKeys' | 'health'>[];
  initiatives: Pick<InitiativeView, 'id' | 'capabilityKeys' | 'state'>[];
  units: { id: string; name: string; leadUserId: string | null }[] | null;
  users: { id: string; name: string }[] | null;
  knowledgeMatch: ((refs: string[]) => { ref: string; matched: boolean }[]) | null;
  failures: Record<string, string>;
}

type Verdict = 'good' | 'bad' | 'unknown';

function readEvidence(e: { kind: string; ref: string }, s: CapabilitySignals): { verdict: Verdict; detail: string } {
  switch (e.kind) {
    case 'insight-domain': {
      const d = s.domains?.find((x) => x.key === e.ref);
      if (!d || d.band === 'unknown') return { verdict: 'unknown', detail: `domain ${e.ref} unreadable/unknown` };
      return { verdict: d.band === 'healthy' ? 'good' : 'bad', detail: `domain ${e.ref}: ${d.band}` };
    }
    case 'kpi': {
      const k = s.kpis?.find((x) => x.key === e.ref);
      if (!k || k.band === null) return { verdict: 'unknown', detail: `KPI ${e.ref} unreadable/bandless` };
      return { verdict: k.band === 'healthy' ? 'good' : 'bad', detail: `KPI ${e.ref}: ${k.band}` };
    }
    case 's9-service': {
      const svc = s.s9Services?.find((x) => x.serviceId === e.ref);
      if (!svc || svc.state === 'unknown') return { verdict: 'unknown', detail: `service ${e.ref} unreadable/unknown` };
      return { verdict: svc.state === 'operational' ? 'good' : 'bad', detail: `service ${e.ref}: ${svc.state}` };
    }
    case 'readiness-dimension': {
      const d = s.readiness?.find((x) => x.key === e.ref);
      if (!d || d.state === 'unknown') return { verdict: 'unknown', detail: `readiness ${e.ref} unreadable/unknown` };
      return { verdict: d.state === 'ready' ? 'good' : 'bad', detail: `readiness ${e.ref}: ${d.state}` };
    }
    case 'mined-process': {
      if (s.minedTypes === null) return { verdict: 'unknown', detail: 'process mining unreadable' };
      return s.minedTypes.includes(e.ref)
        ? { verdict: 'good', detail: `process ${e.ref} mined from real events` }
        : { verdict: 'unknown', detail: `process ${e.ref} has no mined cases yet (declared, not judged)` };
    }
    case 'compliance-checks': {
      if (s.compliance === null) return { verdict: 'unknown', detail: 'compliance evaluation unreadable' };
      const fails = s.compliance.filter((c) => c.status === 'fail').length;
      const warns = s.compliance.filter((c) => c.status === 'warn').length;
      if (fails > 0) return { verdict: 'bad', detail: `${fails} compliance check(s) failing` };
      if (warns > 0) return { verdict: 'bad', detail: `${warns} compliance warning(s)` };
      return { verdict: 'good', detail: `all ${s.compliance.length} compliance check(s) passing` };
    }
    default:
      return { verdict: 'unknown', detail: `unrecognized evidence kind ${e.kind}` };
  }
}

export function conditionFrom(readings: { verdict: Verdict }[]): { condition: ObjectiveHealthState; coverage: number } {
  const readable = readings.filter((r) => r.verdict !== 'unknown');
  const coverage = readings.length > 0 ? readable.length / readings.length : 0;
  if (readable.length === 0) return { condition: 'unknown', coverage };
  const bad = readable.filter((r) => r.verdict === 'bad').length;
  if (bad === 0) return { condition: 'on-track', coverage };
  return { condition: bad * 2 >= readable.length ? 'off-track' : 'at-risk', coverage };
}

export function buildCapabilityMap(input: CapabilityInput): CapabilityMapView {
  const unavailable: StrategyUnavailable[] = Object.entries(input.failures).map(([system, reason]) => ({ system, reason }));
  const kpiByCap = new Map<string, string[]>();
  for (const k of KPI_CAPABILITY_REGISTRY) {
    kpiByCap.set(k.capabilityKey, [...(kpiByCap.get(k.capabilityKey) ?? []), k.key]);
  }
  const capsByCategory = new Map(DECISION_CATEGORY_CAPABILITIES.map((d) => [d.category, d.capabilityKeys]));
  // Recent-decision attention per capability (all recorded decisions count; counts, not currency).
  const attention = new Map<string, number>();
  for (const d of input.signals.decisions ?? []) {
    for (const cap of capsByCategory.get(d.category) ?? []) attention.set(cap, (attention.get(cap) ?? 0) + 1);
  }

  const breachedSlas = (input.signals.slaStatuses ?? []).filter((x) => x.status === 'breached').length;
  const criticalFindings = (input.signals.apFindings ?? []).filter((f) => f.severity === 'critical' || f.severity === 'high').length;

  const capabilities: CapabilityAnalysis[] = CAPABILITY_REGISTRY.map((def) => {
    const readings = def.evidence.map((e) => readEvidence(e, input.signals));
    const cond = conditionFrom(readings);
    const objs = input.objectives.filter((o) => o.capabilityKeys.includes(def.key));
    const inits = input.initiatives.filter((i) => i.capabilityKeys.includes(def.key));
    const kpiKeys = kpiByCap.get(def.key) ?? [];
    const kpis = kpiKeys.map((key) => ({ key, band: input.signals.kpis?.find((k) => k.key === key)?.band ?? null }));
    const riskIds = RISK_REGISTRY.filter((r) => r.capabilityKeys.includes(def.key)).map((r) => r.id);
    const standardsRefs = input.knowledgeMatch
      ? input.knowledgeMatch(def.knowledgeTopics)
      : def.knowledgeTopics.map((ref) => ({ ref, matched: false }));
    const initiativeAttention = inits.length;
    const decisionAttention = (attention.get(def.key) ?? 0) + initiativeAttention;
    const gaps: string[] = [];
    if (inits.length === 0) gaps.push('no initiative supports this capability');
    if (!standardsRefs.some((r) => r.matched)) gaps.push('no knowledge standard matched its topics');
    if (cond.coverage < 0.5) gaps.push(`evidence coverage ${(cond.coverage * 100).toFixed(0)}% — condition is low-confidence`);
    const opRisk = {
      // Operational risk attributes ONLY the capability's own bad evidence, plus
      // platform-wide breach/finding counts for the operations capability.
      findings: def.key === 'operations' ? criticalFindings : readings.filter((r) => r.verdict === 'bad').length,
      breachedSlas: def.key === 'operations' ? breachedSlas : 0,
      detail:
        def.key === 'operations'
          ? `${criticalFindings} critical/high automation finding(s); ${breachedSlas} SLA breach(es) platform-wide`
          : `${readings.filter((r) => r.verdict === 'bad').length} of ${readings.length} declared signal(s) unhealthy`,
    };
    return {
      key: def.key,
      label: def.label,
      owner: resolveOwner(def.owningUnitName, input.units, input.users),
      condition: cond.condition,
      conditionDetail: readings.map((r) => r.detail).join(' · '),
      evidenceCoverage: Math.round(cond.coverage * 100) / 100,
      objectives: { total: objs.length, atRisk: objs.filter((o) => o.health === 'at-risk' || o.health === 'off-track').length },
      initiatives: { total: inits.length, blocked: inits.filter((i) => i.state === 'blocked').length },
      kpis,
      riskIds,
      decisionAttention,
      standards: { matched: standardsRefs.some((r) => r.matched), refs: standardsRefs },
      operationalRisk: opRisk,
      gaps,
    };
  });

  const rank: Record<ObjectiveHealthState, number> = { 'on-track': 0, unknown: 1, 'at-risk': 2, 'off-track': 3 };
  const judged = capabilities.filter((c) => c.condition !== 'unknown');
  const weakestCap = judged.length > 0 ? [...judged].sort((a, b) => rank[b.condition] - rank[a.condition] || a.evidenceCoverage - b.evidenceCoverage)[0] : null;
  const worstOp = [...capabilities].sort(
    (a, b) => b.operationalRisk.findings + b.operationalRisk.breachedSlas - (a.operationalRisk.findings + a.operationalRisk.breachedSlas),
  )[0];

  return {
    generatedAt: input.nowIso,
    capabilities,
    // Weakest is named ONLY when a judged capability is actually below the bar
    // (at-risk/off-track). All-on-track or nothing-judged → null — naming an
    // arbitrary registry entry would be an invented judgment.
    weakest:
      weakestCap && rank[weakestCap.condition] >= 2
        ? { key: weakestCap.key, detail: `${weakestCap.label}: ${weakestCap.condition} — ${weakestCap.conditionDetail}` }
        : null,
    unsupported: capabilities.filter((c) => c.initiatives.total === 0).map((c) => c.key),
    investmentFocus: [...capabilities]
      .sort((a, b) => b.decisionAttention - a.decisionAttention)
      .slice(0, 5)
      .map((c) => ({ key: c.key, attention: c.decisionAttention })),
    lackingStandards: capabilities.filter((c) => !c.standards.matched).map((c) => c.key),
    highestOperationalRisk:
      worstOp && worstOp.operationalRisk.findings + worstOp.operationalRisk.breachedSlas > 0
        ? { key: worstOp.key, detail: worstOp.operationalRisk.detail }
        : null,
    disclosure: CAPABILITY_DISCLOSURE,
    unavailable,
  };
}
