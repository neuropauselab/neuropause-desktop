/**
 * Phase 6 Stage 9 — the operations model: the seven-dimension readiness
 * assessment (four HONEST states), the KPI catalog (existing producers only),
 * Principle-C recommendations (seven mandatory fields — the composer THROWS on
 * an incomplete one), the ten assistant question resolvers (disjoint from the
 * Stage 5/6/7/8 matchers, both directions test-locked), the answers (read-only,
 * the existing 'intelligence' report kind), and the dashboard compose. Pure.
 */
import type {
  AssistantStructuredReport,
  CapacityView,
  ContinuityView,
  IncidentLifecycleReport,
  KpiCatalogRow,
  OperationalHealthView,
  OperationsDashboard,
  OperationsQuestionKey,
  OperationsRecommendation,
  ReadinessAssessment,
  ReadinessDimension,
  ReadinessState,
  ServiceCatalog,
  ServiceOwnerRef,
  SlaReport,
} from '@neuropause/shared';
import { recommendationIssues } from '@neuropause/shared';
import type { BusinessProcessReport } from '@neuropause/shared';
import { DOMAIN_REGISTRY, OBJECTIVE_REGISTRY } from './operationsRegistry';
import { resolveOwner } from './serviceCatalog';

/* ── the structural disclosures (ship on every dashboard) ─────────────────── */

export const OPERATIONS_DISCLOSURES: readonly string[] = [
  'Incidents are transient computed views — no incident/ticket store exists; the persistent operational record is a governed decision (the existing decision store).',
  'SLA measurement is bounded by aggregates the platform already records; targets without a recording aggregate are declared unmeasurable, never estimated.',
  'Organizational maturity is computed in the renderer capability registry (the declared Stage 7 boundary) and is not recomputed here.',
] as const;

/* ── readiness (seven dimensions, four honest states) ─────────────────────── */

export interface ReadinessSignals {
  validation: { totalRuns: number; certifies: number; latestCertification: string | null } | null;
  compliance: { ruleId: string; ruleName: string; severity: string; status: string }[] | null;
  connectors: { configured: number; healthy: number } | null;
  automation: { completed: number; failed: number; errorRules: number } | null;
  workforce: { healthy: number; degraded: number; unhealthy: number; unknown: number; queueDepth: number } | null;
  aiState: string | null;
  governance: { enabledChains: number } | null;
}

export function buildReadiness(nowIso: string, s: ReadinessSignals, failures: Record<string, string>): ReadinessAssessment {
  const dims: ReadinessDimension[] = [];

  // deployment — the EXISTING continuous-validation platform's recorded runs.
  if (s.validation === null) {
    dims.push(dim('deployment', 'Deployment', 'unknown', [], ['continuous-validation summary unreadable'], 'Validation platform unavailable this read.'));
  } else if (s.validation.latestCertification !== null) {
    dims.push(dim('deployment', 'Deployment', 'ready', ['continuous-validation'], [], `Latest certification: ${s.validation.latestCertification} (${s.validation.totalRuns} validation run(s) recorded).`));
  } else if (s.validation.totalRuns > 0) {
    dims.push(dim('deployment', 'Deployment', 'degraded', ['continuous-validation'], ['run a certifying release-candidate pipeline'], `${s.validation.totalRuns} validation run(s) recorded but no certification yet (${s.validation.certifies} certifying pipeline(s) available).`));
  } else {
    dims.push(dim('deployment', 'Deployment', 'not-ready', [], ['no validation runs recorded — run the existing pipelines'], 'Zero validation runs recorded (honest zero).'));
  }

  // organization — the EXISTING compliance checks (fail → not-ready, warn → degraded).
  if (s.compliance === null) {
    dims.push(dim('organization', 'Organization', 'unknown', [], ['compliance findings unreadable'], 'Governance compliance evaluation unavailable this read.'));
  } else {
    const fails = s.compliance.filter((f) => f.status === 'fail');
    const warns = s.compliance.filter((f) => f.status === 'warn');
    if (fails.length > 0) {
      dims.push(dim('organization', 'Organization', 'not-ready', fails.map((f) => f.ruleId), fails.map((f) => `fix: ${f.ruleName}`), `${fails.length} compliance check(s) failing.`));
    } else if (warns.length > 0) {
      dims.push(dim('organization', 'Organization', 'degraded', warns.map((f) => f.ruleId), warns.map((f) => `address: ${f.ruleName}`), `${warns.length} compliance warning(s).`));
    } else {
      dims.push(dim('organization', 'Organization', 'ready', s.compliance.map((f) => f.ruleId), [], `All ${s.compliance.length} compliance check(s) passing.`));
    }
  }

  // connectors — configured fleet health (zero configured is a declared gap, not failure).
  if (s.connectors === null) {
    dims.push(dim('connectors', 'Connectors', 'unknown', [], ['connector service unreadable'], 'Connector service unavailable this read.'));
  } else if (s.connectors.configured === 0) {
    dims.push(dim('connectors', 'Connectors', 'degraded', [], ['configure at least one connector'], 'No connectors configured — integration readiness cannot be demonstrated.'));
  } else {
    const ratio = s.connectors.healthy / s.connectors.configured;
    if (ratio < 0.5) dims.push(dim('connectors', 'Connectors', 'not-ready', ['connector-service'], ['recover failing connectors'], `${s.connectors.healthy}/${s.connectors.configured} configured connector(s) healthy.`));
    else if (ratio < 0.8) dims.push(dim('connectors', 'Connectors', 'degraded', ['connector-service'], ['recover degraded connectors'], `${s.connectors.healthy}/${s.connectors.configured} configured connector(s) healthy.`));
    else dims.push(dim('connectors', 'Connectors', 'ready', ['connector-service'], [], `${s.connectors.healthy}/${s.connectors.configured} configured connector(s) healthy.`));
  }

  // automation — the monitor + error rules; zero finished runs is honestly unknown.
  if (s.automation === null) {
    dims.push(dim('automation', 'Automation', 'unknown', [], ['automation monitor unreadable'], 'Automation monitor unavailable this read.'));
  } else {
    const finished = s.automation.completed + s.automation.failed;
    if (s.automation.errorRules > 0) {
      dims.push(dim('automation', 'Automation', 'not-ready', ['automation-monitor'], [`fix ${s.automation.errorRules} rule(s) in error state`], `${s.automation.errorRules} rule(s) in error state.`));
    } else if (finished === 0) {
      dims.push(dim('automation', 'Automation', 'unknown', [], ['no finished automation runs recorded to judge from'], 'No finished automation runs — readiness cannot be demonstrated yet (unknown, not assumed).'));
    } else {
      const ratio = s.automation.failed / finished;
      if (ratio > 0.5) dims.push(dim('automation', 'Automation', 'not-ready', ['automation-monitor'], ['fix the failing rules'], `Failure ratio ${(ratio * 100).toFixed(0)}% over ${finished} run(s).`));
      else if (ratio > 0.2) dims.push(dim('automation', 'Automation', 'degraded', ['automation-monitor'], ['reduce the failure ratio'], `Failure ratio ${(ratio * 100).toFixed(0)}% over ${finished} run(s).`));
      else dims.push(dim('automation', 'Automation', 'ready', ['automation-monitor'], [], `Failure ratio ${(ratio * 100).toFixed(0)}% over ${finished} run(s).`));
    }
  }

  // workforce — health summary + queue depth.
  if (s.workforce === null) {
    dims.push(dim('workforce', 'Workforce', 'unknown', [], ['worker health summary unreadable'], 'Workforce health unavailable this read.'));
  } else {
    const known = s.workforce.healthy + s.workforce.degraded + s.workforce.unhealthy;
    if (known === 0) {
      dims.push(dim('workforce', 'Workforce', 'unknown', [], ['no worker health checks recorded'], 'Every worker health state is unknown — readiness cannot be demonstrated.'));
    } else if (s.workforce.unhealthy > 0 || s.workforce.queueDepth > 50) {
      dims.push(dim('workforce', 'Workforce', 'not-ready', ['worker-health'], ['recover unhealthy workers / drain the queue'], `${s.workforce.unhealthy} unhealthy worker(s) · queue depth ${s.workforce.queueDepth}.`));
    } else if (s.workforce.degraded > 0 || s.workforce.queueDepth > 25) {
      dims.push(dim('workforce', 'Workforce', 'degraded', ['worker-health'], ['investigate degraded workers'], `${s.workforce.degraded} degraded worker(s) · queue depth ${s.workforce.queueDepth}.`));
    } else {
      dims.push(dim('workforce', 'Workforce', 'ready', ['worker-health'], [], `${s.workforce.healthy} healthy worker(s) · queue depth ${s.workforce.queueDepth}.`));
    }
  }

  // ai — the engine manager's own state machine.
  if (s.aiState === null) {
    dims.push(dim('ai', 'AI Runtime', 'unknown', [], ['engine manager unreadable'], 'Engine manager unavailable this read.'));
  } else if (s.aiState === 'ready') {
    dims.push(dim('ai', 'AI Runtime', 'ready', ['ai-engine-state'], [], 'Engine state: ready.'));
  } else if (s.aiState === 'needs-setup' || s.aiState === 'error') {
    dims.push(dim('ai', 'AI Runtime', 'not-ready', ['ai-engine-state'], [s.aiState === 'needs-setup' ? 'configure an AI provider' : 'resolve the engine error'], `Engine state: ${s.aiState}.`));
  } else {
    dims.push(dim('ai', 'AI Runtime', 'degraded', ['ai-engine-state'], ['wait for the engine to settle'], `Engine state: ${s.aiState}.`));
  }

  // governance — enabled chains gate side effects.
  if (s.governance === null) {
    dims.push(dim('governance', 'Governance', 'unknown', [], ['governance store unreadable'], 'Governance unavailable this read.'));
  } else if (s.governance.enabledChains > 0) {
    dims.push(dim('governance', 'Governance', 'ready', ['approval-chains'], [], `${s.governance.enabledChains} enabled approval chain(s) govern side effects.`));
  } else {
    dims.push(dim('governance', 'Governance', 'degraded', [], ['enable at least one approval chain'], 'No enabled approval chains — side-effect proposals still park for a human, but no chain routes them.'));
  }

  return {
    generatedAt: nowIso,
    dimensions: dims,
    totals: {
      ready: dims.filter((d) => d.state === 'ready').length,
      degraded: dims.filter((d) => d.state === 'degraded').length,
      notReady: dims.filter((d) => d.state === 'not-ready').length,
      unknown: dims.filter((d) => d.state === 'unknown').length,
    },
    unavailable: Object.entries(failures).map(([system, reason]) => ({ system, reason })),
  };
}

function dim(
  key: ReadinessDimension['key'],
  label: string,
  state: ReadinessState,
  evidence: string[],
  missing: string[],
  detail: string,
): ReadinessDimension {
  return { key, label, state, evidence, missing, detail };
}

/* ── KPI catalog (existing producers only) ────────────────────────────────── */

export function buildKpiCatalog(
  executive: { key: string; label: string; display: string; value: number | null; band?: string }[] | null,
  processKpis: { key: string; label: string; display: string; value: number | null; band?: string }[] | null,
): KpiCatalogRow[] {
  const rows: KpiCatalogRow[] = [];
  const seen = new Set<string>();
  for (const [source, list] of [
    ['executive-center', executive],
    ['process-mining', processKpis],
  ] as const) {
    for (const k of list ?? []) {
      if (seen.has(k.key)) continue;
      seen.add(k.key);
      rows.push({ key: k.key, label: k.label, display: k.display, value: k.value, band: k.band ?? null, source });
    }
  }
  return rows;
}

/* ── Principle-C recommendations (the composer THROWS on incompleteness) ──── */

export function mkRecommendation(r: OperationsRecommendation): OperationsRecommendation {
  const issues = recommendationIssues(r);
  if (issues.length > 0) {
    // Principle C is structural: an incomplete recommendation is a defect.
    throw new Error(`operations recommendation incomplete: ${issues.join('; ')}`);
  }
  return r;
}

export interface RecommendationInputs {
  sla: SlaReport;
  readiness: ReadinessAssessment;
  incidents: IncidentLifecycleReport;
  capacity: CapacityView;
  continuity: ContinuityView;
}

export function composeRecommendations(inp: RecommendationInputs): OperationsRecommendation[] {
  const recs: OperationsRecommendation[] = [];

  for (const s of inp.sla.statuses.filter((x) => x.status === 'breached')) {
    recs.push(
      mkRecommendation({
        id: `opsrec:sla:${s.targetId}`,
        title: `SLA breached: ${s.label}`,
        detail: s.detail,
        priority: 'high',
        suggestedAction: `Investigate the ${s.serviceId} service on the Platform tab; recovery actions run only through the existing gated flow.`,
        evidence: [...s.evidence, s.targetId],
        reasoning: `The measured value violates the registry target (${s.comparator} ${s.target} ${s.unit}) using the platform's own aggregate — not an estimate.`,
        confidence: 0.9,
        affectedSystems: [s.serviceId],
        operationalImpact: `The ${s.serviceId} service is operating outside its agreed target.`,
        expectedBusinessOutcome: 'Restoring the target returns the service to its agreed operating level for its consumers.',
        rollbackImplications: 'Investigation is read-only; any corrective execution parks for approval and follows that action’s own rollback reality.',
      }),
    );
  }

  for (const d of inp.readiness.dimensions.filter((x) => x.state === 'not-ready')) {
    recs.push(
      mkRecommendation({
        id: `opsrec:readiness:${d.key}`,
        title: `Readiness: ${d.label} is not ready`,
        detail: d.detail,
        priority: 'high',
        suggestedAction: d.missing.join('; ') || 'Address the failing signals.',
        evidence: d.evidence.length > 0 ? d.evidence : [`readiness:${d.key}`],
        reasoning: 'The dimension’s own existing signals place it below the ready bar.',
        confidence: 0.85,
        affectedSystems: [d.key],
        operationalImpact: `${d.label} readiness gates operational work that depends on it.`,
        expectedBusinessOutcome: 'Closing the missing items moves the organization toward demonstrable operational readiness.',
        rollbackImplications: 'The assessment itself changes nothing; each missing item names its own (existing, governed) surface.',
      }),
    );
  }

  const criticalOpen = inp.incidents.incidents.filter((i) => i.stage !== 'verified-closed' && i.incident.severity === 'critical');
  for (const i of criticalOpen.slice(0, 5)) {
    recs.push(
      mkRecommendation({
        id: `opsrec:incident:${i.incident.id}`,
        title: `Critical incident open: ${i.incident.title}`,
        detail: i.stageDetail,
        priority: 'critical',
        suggestedAction: i.owner
          ? `Route to ${i.owner.unitName}${i.owner.leadName ? ` (${i.owner.leadName})` : ' (no lead assigned — an ownership gap)'}; replay the correlated events on the existing timeline.`
          : 'No owner resolved (ownership gap) — triage via the Operations Center incidents tab.',
        evidence: [i.incident.id, ...i.incident.eventIds.slice(0, 4)],
        reasoning: `The Stage 6 correlation computed a critical incident (root cause ${i.investigation.rootCauseLabel ?? 'unresolved'} at ${(i.investigation.rootCauseConfidence * 100).toFixed(0)}%).`,
        confidence: Math.max(0.5, i.investigation.rootCauseConfidence),
        affectedSystems: i.incident.resourceIds.slice(0, 6).length > 0 ? i.incident.resourceIds.slice(0, 6) : ['operations'],
        operationalImpact: `Blast radius ${i.incident.blastRadius} resource(s); the incident is ${i.stage}.`,
        expectedBusinessOutcome: 'Resolving the incident restores the affected systems; converting it to a governed decision preserves the record.',
        rollbackImplications: 'Recovery actions run only through the existing approval-gated execution spine; external effects carry that flow’s honest rollback.',
      }),
    );
  }

  if (inp.capacity.pressure === 'high') {
    recs.push(
      mkRecommendation({
        id: 'opsrec:capacity:pressure',
        title: 'Capacity pressure is high',
        detail: inp.capacity.pressureDetail,
        priority: 'high',
        suggestedAction: 'Drain the queue and decide parked approvals via the existing surfaces; review the flagged bottlenecks.',
        evidence: inp.capacity.bottlenecks.slice(0, 5).map((b) => `${b.scope}:${b.key}`).concat('capacity-composition'),
        reasoning: 'Composed queue depth, execution backlog, and workforce bottlenecks exceed the elevated thresholds.',
        confidence: 0.8,
        affectedSystems: ['workforce', 'executions'],
        operationalImpact: 'Work waits longer; approvals and jobs back up.',
        expectedBusinessOutcome: 'Reduced queue latency and restored throughput.',
        rollbackImplications: 'Queue and approval decisions are reversible through the same existing surfaces that made them.',
      }),
    );
  }

  if (inp.continuity.localBackups !== null && inp.continuity.localBackups.count === 0) {
    recs.push(
      mkRecommendation({
        id: 'opsrec:continuity:no-backups',
        title: 'No local backups exist',
        detail: 'The backup manager is available but zero backups have been created (honest zero).',
        priority: 'medium',
        suggestedAction: 'Create a first sha256-manifest backup through the existing maintenance surface.',
        evidence: ['backup-manager'],
        reasoning: 'Continuity composition found a configured mechanism with nothing recorded — recovery from local data loss is currently undemonstrated.',
        confidence: 1,
        affectedSystems: ['backup-manager'],
        operationalImpact: 'A local data-loss event would have no snapshot to restore from.',
        expectedBusinessOutcome: 'A validated backup gives the organization a demonstrated local recovery point.',
        rollbackImplications: 'Creating a backup is additive and reversible (backups can be deleted); restores use the existing safety-snapshot path.',
      }),
    );
  }

  return recs;
}

/* ── the ten question resolvers (five-way disjointness test-locked) ───────── */

export function resolveOperationsQuestion(text: string): OperationsQuestionKey | null {
  const t = text.trim().toLowerCase();
  if (t.length === 0) return null;
  if (/\b(operations?|ops) (status|overview)\b/.test(t) || /\bhow are (our |the )?operations\b/.test(t)) return 'ops-status';
  if (/\bservice health\b/.test(t) || /\bhealth of (our |the )?services\b/.test(t) || /\bwhich services (are )?(degraded|down|failing|unhealthy)\b/.test(t))
    return 'service-health';
  if (/\bbottlenecks?\b/.test(t)) return 'bottlenecks';
  if (/\b(operational|production|deployment) readiness\b/.test(t) || /\breadiness assessment\b/.test(t) || /\bare we ready (for|to)\b/.test(t))
    return 'readiness';
  if (/\bbusiness continuity\b/.test(t) || /\bdisaster recovery\b/.test(t) || /\bcontinuity (posture|status|plan)\b/.test(t)) return 'continuity';
  if (/\b(open|active|operational|current) incidents?\b/.test(t) || /\bincident (status|report|overview)\b/.test(t)) return 'incidents';
  if (/\bslas?\b/.test(t)) return 'sla';
  if (/\bbusiness impact\b/.test(t)) return 'business-impact';
  if (/\bcapacity (status|outlook|planning|pressure)\b/.test(t) || /\bdo we have (the |enough )?capacity\b/.test(t) || /\brunning (out of|low on) capacity\b/.test(t))
    return 'capacity';
  if (/\b(operations?|ops) plan(ning)?\b/.test(t) || /\boperational objectives\b/.test(t)) return 'ops-planning';
  return null;
}

/* ── the dashboard compose ────────────────────────────────────────────────── */

export interface DashboardInputs {
  nowIso: string;
  catalog: ServiceCatalog;
  health: OperationalHealthView;
  sla: SlaReport;
  readiness: ReadinessAssessment;
  incidents: IncidentLifecycleReport;
  capacity: CapacityView;
  continuity: ContinuityView;
  kpis: KpiCatalogRow[];
  units: { id: string; name: string; leadUserId: string | null }[] | null;
  users: { id: string; name: string }[] | null;
}

export function composeOperationsDashboard(inp: DashboardInputs): OperationsDashboard {
  const recommendations = composeRecommendations({
    sla: inp.sla,
    readiness: inp.readiness,
    incidents: inp.incidents,
    capacity: inp.capacity,
    continuity: inp.continuity,
  });
  const objectives = OBJECTIVE_REGISTRY.map((o) => {
    const domainDef = DOMAIN_REGISTRY.find((d) => d.key === o.domain);
    const owner: ServiceOwnerRef | null = domainDef ? resolveOwner(domainDef.owningUnitName, inp.units, inp.users) : null;
    return { id: o.id, label: o.label, reviewCadence: o.reviewCadence, owner };
  });
  const unavailable = [
    ...inp.catalog.unavailable,
    ...inp.health.unavailable,
    ...inp.sla.unavailable,
    ...inp.readiness.unavailable,
    ...inp.incidents.unavailable,
    ...inp.capacity.unavailable,
    ...inp.continuity.unavailable,
  ].filter((u, i, arr) => arr.findIndex((x) => x.system === u.system) === i);

  return {
    generatedAt: inp.nowIso,
    catalog: { ...inp.catalog.totals, gaps: inp.catalog.gaps.length },
    health: {
      overall: inp.health.framework.overall,
      band: inp.health.framework.band,
      domains: inp.health.framework.domains.map((d) => ({ key: d.key, band: d.band })),
    },
    sla: inp.sla.totals,
    readiness: inp.readiness.totals,
    incidents: {
      open: inp.incidents.totals.open,
      critical: inp.incidents.totals.bySeverity.find((s) => s.severity === 'critical')?.count ?? 0,
    },
    capacity: { pressure: inp.capacity.pressure, bottlenecks: inp.capacity.bottlenecks.length },
    continuity: {
      score: inp.continuity.posture?.score ?? null,
      validations: inp.continuity.validations?.total ?? 0,
      localBackups: inp.continuity.localBackups?.count ?? null,
    },
    kpis: inp.kpis,
    objectives,
    recommendations,
    disclosures: [...OPERATIONS_DISCLOSURES],
    unavailable,
  };
}

/* ── the ten answers (read-only; the existing 'intelligence' report kind) ─── */

export interface OperationsQuestionContext {
  catalog: ServiceCatalog;
  health: OperationalHealthView;
  sla: SlaReport;
  readiness: ReadinessAssessment;
  incidents: IncidentLifecycleReport;
  capacity: CapacityView;
  continuity: ContinuityView;
  processes: BusinessProcessReport;
  dashboard: OperationsDashboard;
  nowIso: string;
}

type Section = { title: string; lines: string[] };

function report(title: string, sections: Section[]): AssistantStructuredReport {
  return { kind: 'intelligence', title, sections: sections.filter((s) => s.lines.length > 0), grounded: true };
}

export function answerOperationsQuestion(
  key: OperationsQuestionKey,
  ctx: OperationsQuestionContext,
): AssistantStructuredReport {
  switch (key) {
    case 'ops-status': {
      const d = ctx.dashboard;
      return report('Operations status', [
        {
          title: 'Answer',
          lines: [
            `Services: ${d.catalog.operational}/${d.catalog.services} operational (${d.catalog.degraded} degraded · ${d.catalog.failed} failed · ${d.catalog.unknown} unknown).`,
            `Health: ${d.health.overall !== null ? `${d.health.overall}/100 (${d.health.band})` : `not computable (${d.health.band})`} · Incidents open: ${d.incidents.open} (${d.incidents.critical} critical).`,
            `SLA: ${d.sla.met}/${d.sla.targets} met, ${d.sla.breached} breached, ${d.sla.unmeasurable} declared unmeasurable · Capacity pressure: ${d.capacity.pressure}.`,
            `Readiness: ${d.readiness.ready} ready · ${d.readiness.degraded} degraded · ${d.readiness.notReady} not ready · ${d.readiness.unknown} unknown.`,
          ],
        },
        { title: 'Evidence', lines: ctx.catalog.entries.slice(0, 6).map((e) => `${e.serviceId}: ${e.stateDetail}`) },
        { title: 'Uncertainty', lines: d.unavailable.map((u) => `${u.system}: ${u.reason}`) },
      ]);
    }
    case 'service-health': {
      const bad = ctx.catalog.entries.filter((e) => e.state !== 'operational');
      return report('Service health', [
        {
          title: 'Answer',
          lines:
            bad.length === 0
              ? [`All ${ctx.catalog.totals.services} catalogued services are operational by their own signals.`]
              : bad.map((e) => `${e.name}: ${e.state.toUpperCase()} — ${e.stateDetail}${e.owner ? ` · owner ${e.owner.unitName}` : ' · NO OWNER RESOLVED'}`),
        },
        { title: 'Evidence', lines: ctx.catalog.entries.flatMap((e) => e.evidence.slice(0, 2)).slice(0, 8) },
        { title: 'Gaps', lines: ctx.catalog.gaps.slice(0, 6).map((g) => `${g.kind}: ${g.subject} — ${g.detail}`) },
      ]);
    }
    case 'bottlenecks': {
      const b = ctx.capacity.bottlenecks;
      return report('Operational bottlenecks', [
        {
          title: 'Answer',
          lines:
            b.length === 0
              ? ['No workforce bottlenecks flagged by the existing detector (thresholds: failure rate, backlog, groundedness).']
              : b.map((x) => `${x.scope} ${x.key}: ${x.reason} (value ${x.value}, n=${x.sampleSize})`),
        },
        { title: 'Evidence', lines: b.slice(0, 6).map((x) => `${x.scope}:${x.key}`) },
        { title: 'Affected systems', lines: ['workforce', 'executions'] },
      ]);
    }
    case 'readiness': {
      return report('Operational readiness', [
        {
          title: 'Answer',
          lines: ctx.readiness.dimensions.map(
            (d) => `${d.label}: ${d.state.toUpperCase()} — ${d.detail}${d.missing.length > 0 ? ` Missing: ${d.missing.join('; ')}` : ''}`,
          ),
        },
        { title: 'Evidence', lines: ctx.readiness.dimensions.flatMap((d) => d.evidence.slice(0, 2)).slice(0, 10) },
        { title: 'Uncertainty', lines: ctx.readiness.dimensions.filter((d) => d.state === 'unknown').map((d) => `${d.label}: unknown — ${d.missing.join('; ')}`) },
      ]);
    }
    case 'continuity': {
      const c = ctx.continuity;
      return report('Business continuity', [
        {
          title: 'Answer',
          lines: [
            c.posture ? `Continuity score ${c.posture.score}/100 · RPO target ${c.posture.rpoTargetSeconds}s · RTO target ${c.posture.rtoTargetSeconds}s · last drill ${c.posture.lastDrillAt ?? 'never'}.` : 'DR posture unavailable this read.',
            c.validations ? (c.validations.total > 0 ? `${c.validations.total} recorded recovery validation(s); observed RPO ${c.validations.rpoObservedSeconds ?? 'n/a'}s (from the last validation — never estimated).` : 'ZERO recovery validations recorded — observed RPO is unknown.') : 'Validations unreadable.',
            c.localBackups ? (c.localBackups.count > 0 ? `${c.localBackups.count} local backup(s), latest ${c.localBackups.lastAt}.` : 'ZERO local backups (honest zero).') : 'Local backups unreadable.',
          ],
        },
        { title: 'Mechanisms', lines: c.mechanisms.map((m) => `${m.name}: ${m.detail}`) },
        { title: 'Evidence', lines: c.mechanisms.flatMap((m) => m.evidence).slice(0, 8) },
      ]);
    }
    case 'incidents': {
      const open = ctx.incidents.incidents.filter((i) => i.stage !== 'verified-closed');
      return report('Open incidents', [
        {
          title: 'Answer',
          lines:
            open.length === 0
              ? ['No open computed incidents. (Incidents are transient views — history lives in timeline events and converted decisions.)']
              : open.slice(0, 6).map((i) => `${i.incident.severity.toUpperCase()} · ${i.incident.title} — ${i.stage}${i.owner ? ` · owner ${i.owner.unitName}` : ' · ownership gap'}`),
        },
        { title: 'Evidence', lines: open.slice(0, 4).flatMap((i) => i.investigation.eventIds.slice(0, 2)) },
        { title: 'Persistence', lines: [open[0]?.conversion.how ?? 'Convert a related recommendation into a governed decision to persist the record (the existing path).'] },
      ]);
    }
    case 'sla': {
      const s = ctx.sla;
      return report('SLA posture', [
        {
          title: 'Answer',
          lines: s.statuses.map((x) => `${x.label}: ${x.status.toUpperCase()} — ${x.detail}`),
        },
        { title: 'Evidence', lines: s.statuses.filter((x) => x.evidence.length > 0).flatMap((x) => x.evidence.slice(0, 1)).slice(0, 8) },
        { title: 'Uncertainty', lines: [`${s.totals.unmeasurable} target(s) declared unmeasurable — the platform records no aggregate for them.`] },
      ]);
    }
    case 'business-impact': {
      const open = ctx.incidents.incidents.filter((i) => i.stage !== 'verified-closed');
      const breached = ctx.sla.statuses.filter((x) => x.status === 'breached');
      return report('Business impact (qualitative — never invented currency)', [
        {
          title: 'Answer',
          lines: [
            open.length === 0 && breached.length === 0
              ? 'No open incidents and no SLA breaches — no composed operational impact to report.'
              : `Impact composition: ${open.length} open incident(s) touching ${[...new Set(open.flatMap((i) => i.incident.resourceIds))].length} resource(s); ${breached.length} SLA breach(es).`,
            ...open.slice(0, 4).map((i) => `${i.incident.title}: blast radius ${i.incident.blastRadius}, domain ${i.domain ?? 'unmapped'}${i.owner ? `, owner ${i.owner.unitName}` : ''}.`),
            ...breached.slice(0, 3).map((b) => `${b.label}: the ${b.serviceId} service operates outside its agreed target.`),
          ],
        },
        { title: 'Affected systems', lines: [[...new Set([...open.flatMap((i) => i.incident.resourceIds.slice(0, 3)), ...breached.map((b) => b.serviceId)])].slice(0, 10).join(', ') || 'none'] },
        { title: 'Uncertainty', lines: ['Impact is qualitative composition (affected systems + KPI bands); the platform records no revenue-per-system figures and none are invented.'] },
      ]);
    }
    case 'capacity': {
      const c = ctx.capacity;
      return report('Capacity outlook', [
        {
          title: 'Answer',
          lines: [
            `Pressure: ${c.pressure.toUpperCase()} — ${c.pressureDetail}.`,
            c.executions ? `Executions: ${c.executions.active} active, ${c.executions.queued} queued${c.executions.successRate !== null ? `, success ${(c.executions.successRate * 100).toFixed(0)}%` : ''}.` : 'Execution stats unreadable.',
            c.workforce ? `Workforce: ${c.workforce.queueDepth} queued, ${c.workforce.awaitingApproval} awaiting approval.` : 'Workforce reads unavailable.',
          ],
        },
        {
          title: 'Forecast',
          lines:
            c.forecast.length > 0
              ? c.forecast.slice(0, 4).map((f) => `${f.title} — ${(f.likelihood * 100).toFixed(0)}% likelihood over ${f.horizonDays} day(s) (${f.basis})`)
              : ['No capacity-relevant Stage 6 predictions currently tracked (the only forecast source — no new model).'],
        },
        { title: 'Evidence', lines: c.bottlenecks.slice(0, 5).map((b) => `${b.scope}:${b.key}`) },
      ]);
    }
    case 'ops-planning': {
      const d = ctx.dashboard;
      return report('Operations planning', [
        {
          title: 'Answer',
          lines: d.objectives.map(
            (o) => `${o.label} — reviewed ${o.reviewCadence}${o.owner ? ` by ${o.owner.unitName}${o.owner.leadName ? ` (${o.owner.leadName})` : ' (no lead assigned)'}` : ' (no owner resolved — a gap)'}.`,
          ),
        },
        { title: 'Recommendations', lines: d.recommendations.slice(0, 5).map((r) => `${r.priority.toUpperCase()} · ${r.title} → ${r.suggestedAction}`) },
        { title: 'Uncertainty', lines: d.unavailable.slice(0, 5).map((u) => `${u.system}: ${u.reason}`) },
      ]);
    }
    default:
      return report('Operations question', [{ title: 'Answer', lines: ['Unrecognized operations question key.'] }]);
  }
}
