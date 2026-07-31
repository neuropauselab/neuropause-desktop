/**
 * Phase 6 Stage 6 — the insight model (pure).
 *
 * The composition heart of the Enterprise Intelligence Layer:
 *   - the Intelligence Dependency Graph (enhancement #2): how correlated
 *     signals produced each recommendation, computed from the engines' own
 *     evidence links — no graph store,
 *   - the Confidence Breakdown (enhancement #3) for the composed report,
 *   - the outcome lifecycle derivation (enhancement #3): recommendation →
 *     approval → execution → verification, every stage backed by a real
 *     record (decision / approval event / execution session / deterministic
 *     re-observation) or absent,
 *   - insight recommendations composed from the P7 engine output + predictions,
 *   - the executive dashboard composition (6.11),
 *   - the ten-question resolvers (Primary Objective) shaping the 6.10 answer
 *     contract: answer + evidence + affected systems + confidence +
 *     assumptions/unavailability + suggested action.
 *
 * Pure + deterministic + IO-free.
 */
import type {
  AssistantStructuredReport,
  ConfidenceBreakdown,
  EnterpriseIntelligenceReport,
  ExecutionSession,
  Incident,
  InsightDashboard,
  InsightDependencyGraph,
  InsightHealthFramework,
  InsightIncidentView,
  InsightOutcome,
  InsightOutcomeStep,
  InsightPrediction,
  InsightQuestionKey,
  InsightRecommendation,
  InsightRecommendationCategory,
  InsightReport,
  InsightTrendPoint,
  IntelRecommendation,
  RootCauseReport,
  SignalRuntimeStatus,
} from '@neuropause/shared';
import { SIGNAL_BY_ID } from './signalRegistry';

const round2 = (n: number): number => Math.round(n * 100) / 100;
const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/* ── evidence → signal attribution ────────────────────────────────────────── */

/** Which registry signal an engine evidence id came from, by its namespace. */
export function signalForEvidence(evidenceId: string): string | null {
  if (evidenceId.startsWith('ops:connector:') || evidenceId.startsWith('connector:')) return 'connector-health';
  if (evidenceId.startsWith('ops:automation:') || evidenceId.startsWith('autorun:')) return 'automation-runs';
  if (evidenceId.startsWith('ops:worker:') || evidenceId.startsWith('ops:approvals:') || evidenceId.startsWith('job:')) return 'workforce-jobs';
  if (evidenceId.startsWith('ops:workflow:')) return 'workflow-runs';
  if (evidenceId.startsWith('ops:project:') || evidenceId.startsWith('entity:')) return 'work-entities';
  if (evidenceId === 'ops:execute-engine' || evidenceId.startsWith('exec:')) return 'executions';
  if (evidenceId === 'ops:assistant') return 'assistant-conversations';
  if (evidenceId.startsWith('res:')) return 'p7-intelligence';
  if (evidenceId.startsWith('erp:')) return 'work-entities';
  if (evidenceId.startsWith('health:')) return 'org-health';
  if (evidenceId.startsWith('incident:')) return 'timeline-events';
  return null;
}

/* ── Confidence breakdown for the whole report (enhancement #3) ───────────── */

export function reportConfidence(args: {
  signals: SignalRuntimeStatus[];
  historyDays: number;
  incidentConfidences: number[];
  crossDomainEdges: number;
  totalEdges: number;
}): ConfidenceBreakdown {
  const available = args.signals.filter((s) => s.available);
  const dataAvailability = args.signals.length ? available.length / args.signals.length : 0;
  // Trust-weighted mean of the available signals' registry trust × observed completeness.
  let quality = 0;
  if (available.length) {
    let sum = 0;
    for (const s of available) {
      const trust = SIGNAL_BY_ID.get(s.id)?.trust.score ?? 0.5;
      sum += trust * s.completeness;
    }
    quality = sum / available.length;
  }
  const historicalCoverage = clamp01(args.historyDays / 90);
  const corrFromIncidents = args.incidentConfidences.length
    ? args.incidentConfidences.reduce((a, b) => a + b, 0) / args.incidentConfidences.length
    : 0;
  const corrFromGraph = args.totalEdges > 0 ? clamp01(args.crossDomainEdges / args.totalEdges + 0.3) : 0.3;
  const correlationStrength = clamp01(corrFromIncidents * 0.6 + corrFromGraph * 0.4);
  const overall = dataAvailability * 0.3 + quality * 0.3 + historicalCoverage * 0.15 + correlationStrength * 0.25;
  return {
    dataAvailability: round2(dataAvailability),
    signalQuality: round2(quality),
    historicalCoverage: round2(historicalCoverage),
    correlationStrength: round2(correlationStrength),
    overall: round2(clamp01(overall)),
  };
}

/* ── Outcome lifecycle (enhancement #3) ───────────────────────────────────── */

export interface OutcomeJoins {
  /** Decisions created from a recommendation (fromRecommendationId → status). */
  decisions: { id: string; fromRecommendationId: string | null; status: string; updatedAt: string }[];
  /** Approval events observed on the timeline (approval.granted with correlation). */
  approvalEvents: { id: string; correlationId: string | null; at: string }[];
  /** Execution sessions (joined by correlation id). */
  executions: Pick<ExecutionSession, 'id' | 'state' | 'correlationId' | 'completedAt' | 'startedAt'>[];
  /** Recommendation ids whose underlying condition is no longer observed NOW,
   *  but was observed before (deterministic re-observation → verification). */
  clearedRecommendationIds: Set<string>;
  nowIso: string;
}

/** Derive the observed lifecycle of one recommendation. Pure; nothing assumed. */
export function deriveOutcome(
  recoId: string,
  correlationId: string,
  producedAt: string,
  joins: OutcomeJoins,
): InsightOutcome {
  const steps: InsightOutcomeStep[] = [
    {
      stage: 'recommended',
      at: producedAt,
      evidence: { kind: 'recommendation', id: recoId },
      detail: 'Recommendation produced from cited evidence.',
    },
  ];

  const decision = joins.decisions.find(
    (d) => d.fromRecommendationId === recoId && d.status !== 'rejected' && d.status !== 'draft' && d.status !== 'suggested',
  );
  const approvalEvent = joins.approvalEvents.find((e) => e.correlationId === correlationId);
  if (decision) {
    steps.push({
      stage: 'approved',
      at: decision.updatedAt,
      evidence: { kind: 'decision', id: decision.id },
      detail: `Decision ${decision.id} accepted (status ${decision.status}).`,
    });
  } else if (approvalEvent) {
    steps.push({
      stage: 'approved',
      at: approvalEvent.at,
      evidence: { kind: 'approval-event', id: approvalEvent.id },
      detail: 'Approval granted in the recommendation’s correlation chain.',
    });
  }

  const execution = joins.executions.find(
    (s) => s.correlationId === correlationId && (s.state === 'completed' || s.state === 'running'),
  );
  if (execution && steps.some((s) => s.stage === 'approved')) {
    steps.push({
      stage: 'executed',
      at: execution.completedAt ?? execution.startedAt,
      evidence: { kind: 'execution', id: execution.id },
      detail: `Execution ${execution.id} ${execution.state}.`,
    });
  }

  if (joins.clearedRecommendationIds.has(recoId)) {
    steps.push({
      stage: 'verified',
      at: joins.nowIso,
      evidence: { kind: 'observation', id: recoId },
      detail: 'The underlying condition is no longer observed in the current signals.',
    });
  }

  return { stage: steps[steps.length - 1].stage, steps };
}

/* ── Insight recommendations (compose engines + predictions) ──────────────── */

const CATEGORY_MAP: Record<IntelRecommendation['category'], InsightRecommendationCategory> = {
  incident: 'incident',
  risk: 'risk',
  health: 'health',
  dependency: 'dependency',
  capacity: 'capacity',
  drift: 'drift',
  security: 'security',
};

export function composeRecommendations(args: {
  engine: IntelRecommendation[];
  predictions: InsightPrediction[];
  base: ConfidenceBreakdown;
  joins: OutcomeJoins;
}): InsightRecommendation[] {
  const out: InsightRecommendation[] = [];

  for (const r of args.engine) {
    const signals = [...new Set(r.evidence.map(signalForEvidence).filter((s): s is string => s != null))];
    const correlationId = `ins_${r.id.replace(/[^a-zA-Z0-9_-]+/g, '_')}`;
    const confidence: ConfidenceBreakdown = {
      ...args.base,
      correlationStrength: round2(clamp01(r.confidence)),
      overall: round2(clamp01(args.base.overall * 0.5 + r.confidence * 0.5)),
    };
    out.push({
      id: r.id,
      category: CATEGORY_MAP[r.category],
      title: r.title,
      detail: r.detail,
      priority: r.priority,
      confidence,
      evidence: r.evidence,
      signals: signals.length ? signals : ['p7-intelligence'],
      suggestedAction: r.detail,
      correlationId,
      outcome: deriveOutcome(r.id, correlationId, args.joins.nowIso, args.joins),
    });
  }

  for (const p of args.predictions) {
    const correlationId = `ins_${p.id.replace(/[^a-zA-Z0-9_-]+/g, '_')}`;
    out.push({
      id: `reco:${p.id}`,
      category: 'prediction',
      title: p.title,
      detail: p.detail,
      priority: p.likelihood >= 0.7 ? 'high' : p.likelihood >= 0.5 ? 'medium' : 'low',
      confidence: p.confidence,
      evidence: p.evidence,
      signals: p.signals,
      suggestedAction: p.suggestedAction,
      correlationId,
      outcome: deriveOutcome(`reco:${p.id}`, correlationId, args.joins.nowIso, args.joins),
    });
  }

  const rank: Record<InsightRecommendation['priority'], number> = { critical: 4, high: 3, medium: 2, low: 1 };
  return out
    .sort((a, b) => rank[b.priority] - rank[a.priority] || b.confidence.overall - a.confidence.overall || a.id.localeCompare(b.id))
    .slice(0, 50);
}

/* ── Intelligence Dependency Graph (enhancement #2) ───────────────────────── */

export function buildDependencyGraph(args: {
  recommendations: InsightRecommendation[];
  incidents: InsightIncidentView[];
  predictions: InsightPrediction[];
  health: InsightHealthFramework;
}): InsightDependencyGraph {
  const nodes = new Map<string, { id: string; kind: 'signal' | 'finding' | 'recommendation'; label: string }>();
  const edges = new Map<string, { from: string; to: string; relation: 'evidence-of' | 'derived-from' | 'correlated-with' }>();

  const addNode = (id: string, kind: 'signal' | 'finding' | 'recommendation', label: string): void => {
    if (!nodes.has(id)) nodes.set(id, { id, kind, label });
  };
  const addEdge = (from: string, to: string, relation: 'evidence-of' | 'derived-from' | 'correlated-with'): void => {
    const id = `${from}→${to}`;
    if (!edges.has(id) && from !== to) edges.set(id, { from, to, relation });
  };
  const signalNode = (signalId: string): string => {
    const def = SIGNAL_BY_ID.get(signalId);
    const id = `signal:${signalId}`;
    addNode(id, 'signal', def?.name ?? signalId);
    return id;
  };

  // Findings: incidents + predictions + unhealthy health domains.
  for (const inc of args.incidents) {
    const fid = `finding:${inc.id}`;
    addNode(fid, 'finding', inc.title);
    const sigs = new Set<string>();
    for (const ev of [...inc.resourceIds, ...inc.eventIds]) {
      const s = signalForEvidence(ev);
      if (s) sigs.add(s);
    }
    (sigs.size ? sigs : new Set(['timeline-events'])).forEach((s) => addEdge(signalNode(s), fid, 'evidence-of'));
  }
  for (const p of args.predictions) {
    const fid = `finding:${p.id}`;
    addNode(fid, 'finding', p.title);
    for (const s of p.signals) addEdge(signalNode(s), fid, 'evidence-of');
  }
  for (const d of args.health.domains) {
    if (d.score != null && d.band !== 'healthy' && d.band !== 'unknown') {
      const fid = `finding:health:${d.key}`;
      addNode(fid, 'finding', `${d.label} health ${d.score}/100 (${d.band})`);
      for (const s of d.signals) addEdge(signalNode(s), fid, 'evidence-of');
    }
  }

  // Recommendations ← findings (matching evidence/id) and ← signals directly.
  for (const r of args.recommendations) {
    const rid = `recommendation:${r.id}`;
    addNode(rid, 'recommendation', r.title);
    for (const s of r.signals) addEdge(signalNode(s), rid, 'evidence-of');
    // Incident-born recommendations: engine ids embed the incident id.
    for (const inc of args.incidents) {
      if (r.id.includes(inc.id) || r.evidence.some((e) => inc.resourceIds.includes(e) || inc.eventIds.includes(e))) {
        addEdge(`finding:${inc.id}`, rid, 'derived-from');
      }
    }
    for (const p of args.predictions) {
      if (r.id === `reco:${p.id}`) addEdge(`finding:${p.id}`, rid, 'derived-from');
    }
    for (const d of args.health.domains) {
      const fid = `finding:health:${d.key}`;
      if (nodes.has(fid) && r.id === `reco:health:${d.key}`) addEdge(fid, rid, 'derived-from');
    }
  }

  // Cross-links: findings sharing a signal are correlated (bounded fan-out).
  const findingsBySignal = new Map<string, string[]>();
  for (const e of edges.values()) {
    if (e.relation === 'evidence-of' && e.to.startsWith('finding:')) {
      (findingsBySignal.get(e.from) ?? findingsBySignal.set(e.from, []).get(e.from)!).push(e.to);
    }
  }
  for (const group of findingsBySignal.values()) {
    for (let i = 0; i + 1 < group.length && i < 6; i += 1) addEdge(group[i], group[i + 1], 'correlated-with');
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

/* ── incident view mapping ────────────────────────────────────────────────── */

export function toIncidentView(i: Incident): InsightIncidentView {
  return {
    id: i.id,
    title: i.title,
    severity: i.severity,
    startTs: i.startTs,
    endTs: i.endTs,
    eventIds: i.eventIds,
    resourceIds: i.resourceIds,
    rootCauseLabel: i.rootCause?.label ?? null,
    rootCauseConfidence: i.rootCause?.confidence ?? 0,
    blastRadius: i.impact.blastRadius,
    recommendedActions: i.recommendedActions,
  };
}

/* ── dashboard composition (6.11) ─────────────────────────────────────────── */

export function composeDashboard(args: {
  report: InsightReport;
  trend: InsightTrendPoint[];
  recentlyVerified: { id: string; title: string; at: string }[];
  nowIso: string;
}): InsightDashboard {
  return {
    generatedAt: args.nowIso,
    health: args.report.health,
    activeIncidents: args.report.incidents.filter((i) => i.severity !== 'info').slice(0, 10),
    predictions: args.report.predictions.slice(0, 10),
    recommendations: args.report.recommendations.slice(0, 12),
    trend: args.trend,
    signals: args.report.signals,
    dependencies: args.report.dependencies,
    recentlyVerified: args.recentlyVerified,
    confidence: args.report.confidence,
    unavailable: args.report.unavailable,
  };
}

/* ── The ten questions (Primary Objective) ────────────────────────────────── */

/** Deterministic matcher for the ten enterprise intelligence questions. */
export function resolveInsightQuestion(text: string): InsightQuestionKey | null {
  const t = ` ${text.toLowerCase()} `;
  if (/\bwhy (did|have|has|are|is)?\s*(our |the )?(sales|revenue|orders?|bookings?)\b.*\b(decreas|declin|drop|fall|fell|down|lower)/.test(t) || /\b(sales|revenue) (decreas|declin|drop)/.test(t)) {
    return 'why-sales-decreased';
  }
  if (/\bwhich projects?\b.*\b(at risk|risk|slip|behind|delay)/.test(t) || /\bprojects? (are )?(most )?at risk\b/.test(t)) return 'projects-at-risk';
  if (/\bwhat('s| is| has)? changed (in the enterprise )?today\b/.test(t) || /\bwhat changed today\b/.test(t)) return 'what-changed-today';
  if (/\bwhich (teams?|departments?|units?)\b.*\b(attention|help|struggl|support)\b/.test(t)) return 'teams-need-attention';
  if (/\b(show|list|any)?\s*(me )?(operational )?anomal(y|ies)\b/.test(t) || /\boperational anomalies\b/.test(t)) return 'operational-anomalies';
  if (/\b(explain|why|what).*(yesterday'?s?|last night'?s?) (failures?|errors?|problems?)\b/.test(t) || /\bfailures? (from )?yesterday\b/.test(t)) return 'yesterdays-failures';
  if (/\bwhich (workflows?|automations?)\b.*\b(repeatedly|keep|always|often)?\s*fail/.test(t)) return 'workflows-failing';
  if (/\bwhich approvals?\b.*\b(block|hold|delay)/.test(t) || /\bapprovals? (are )?blocking\b/.test(t)) return 'blocking-approvals';
  if (/\bpredict\b.*\b(next week|risks?)\b/.test(t) || /\bnext week'?s? risks?\b/.test(t) || /\bwhat risks? (do you )?(expect|predict|foresee)\b/.test(t)) return 'predict-next-week';
  if (/\bsummari[sz]e (the )?(current )?enterprise health\b/.test(t) || /\benterprise health (summary|status)\b/.test(t) || /\bhow (healthy )?is (the |our )?enterprise( health)?\b/.test(t)) {
    return 'enterprise-health-summary';
  }
  return null;
}

/* answer shaping — every answer follows the 6.10 contract:
   answer · evidence · affected systems · confidence · assumptions/unavailable ·
   suggested action. Sections with nothing to say state so plainly. */

export interface QuestionContext {
  report: InsightReport;
  /** The P7 composition the report was built from (for risk/graph detail). */
  engine: EnterpriseIntelligenceReport;
  /** Root-cause runner over the SAME projected inputs (window ms). */
  rootCause: (targetId: string | null, windowMs: number) => RootCauseReport;
  /** Timeline: events observed today / yesterday (already-read counts + tops). */
  changedToday: { type: string; label: string; at: string }[];
  yesterdayFailures: { id: string; type: string; label: string; at: string }[];
  /** Revenue-adjacent evidence presence (ERP/relationship data connected?). */
  revenueSignal: { connected: boolean; nodes: number };
  nowIso: string;
}

function confidenceLine(c: ConfidenceBreakdown): string {
  return `Confidence ${Math.round(c.overall * 100)}% (data availability ${Math.round(c.dataAvailability * 100)}%, signal quality ${Math.round(c.signalQuality * 100)}%, historical coverage ${Math.round(c.historicalCoverage * 100)}%, correlation strength ${Math.round(c.correlationStrength * 100)}%).`;
}

function section(title: string, lines: string[]): { title: string; lines: string[] } {
  return { title, lines: lines.length ? lines : ['Nothing to report.'] };
}

function report(
  title: string,
  sections: { title: string; lines: string[] }[],
  grounded: boolean,
): AssistantStructuredReport {
  return { kind: 'intelligence', title, sections, grounded };
}

/** Answer one resolved question from the composed report. Pure. */
export function answerInsightQuestion(key: InsightQuestionKey, ctx: QuestionContext): AssistantStructuredReport {
  const r = ctx.report;
  const conf = confidenceLine(r.confidence);
  const unavailableLines = r.unavailable.map((u) => `${u.system}: ${u.reason}`);

  switch (key) {
    case 'why-sales-decreased': {
      if (!ctx.revenueSignal.connected) {
        return report('Why did sales decrease?', [
          section('Answer', [
            'No revenue signal is connected — sales/ERP entities are not synced, so a sales decline cannot be measured or explained from evidence.',
          ]),
          section('What would answer this', [
            'Connect an ERP/CRM source (orders, invoices, customers). Root-cause analysis then correlates revenue-adjacent entities with operational events.',
          ]),
          section('Confidence', ['Not applicable — the question is outside the connected data.']),
        ], false);
      }
      const rc = ctx.rootCause(null, 7 * 86_400_000);
      const lines = rc.candidates.slice(0, 5).map(
        (c) => `${c.label} — ${c.reason} (confidence ${Math.round(c.confidence * 100)}%)`,
      );
      return report('Why did sales decrease?', [
        section('Answer', [
          `Root-cause ranking over ${ctx.revenueSignal.nodes} revenue-adjacent node(s) and the last 7 days of correlated events${rc.symptom ? `, anchored on “${rc.symptom.label}”` : ''}.`,
        ]),
        section('Probable causes (ranked)', lines),
        section('Evidence', rc.candidates.slice(0, 5).map((c) => `event ${c.eventId}${c.resourceId ? ` on ${c.resourceId}` : ''}`)),
        section('Confidence', [conf, `Root-cause confidence ${Math.round(rc.confidence * 100)}%. Causes are ranked candidates, never a single asserted cause.`]),
        section('Suggested action', ['Open the Intelligence Center and review the top candidate; route any recovery through an approved assistant plan step.']),
      ], rc.candidates.length > 0);
    }

    case 'projects-at-risk': {
      const projects = r.health.domains.find((d) => d.key === 'projects');
      const projRecos = r.recommendations.filter((x) => x.signals.includes('work-entities'));
      const pred = r.predictions.find((p) => p.kind === 'project-delay');
      if (!projects || projects.unavailable) {
        return report('Which projects are most at risk?', [
          section('Answer', [`Project health is unavailable: ${projects?.unavailable ?? 'UDM read failed'}.`]),
          section('Unavailable', unavailableLines),
          section('Confidence', [conf]),
        ], false);
      }
      return report('Which projects are most at risk?', [
        section('Answer', [
          `Project domain health is ${projects.score}/100 (${projects.band}).`,
          ...(pred ? [pred.detail] : []),
        ]),
        section('Evidence', projects.evidence),
        section('Affected systems', [...new Set(projRecos.flatMap((x) => x.signals))].map((s) => SIGNAL_BY_ID.get(s)?.name ?? s)),
        section('Confidence', [conf, `Project domain confidence ${Math.round(projects.confidence * 100)}%.`]),
        section('Suggested action', [pred?.suggestedAction ?? 'Review overdue tasks per project in the Hub.']),
      ], projects.score != null);
    }

    case 'what-changed-today': {
      const lines = ctx.changedToday.slice(0, 12).map((e) => `${e.at.slice(11, 16)} · ${e.type} — ${e.label}`);
      return report('What changed in the enterprise today?', [
        section('Answer', [`${ctx.changedToday.length} tracked change(s) today across the enterprise timeline.`]),
        section('Changes (most recent first)', lines),
        section('Confidence', [conf]),
        section('Suggested action', ['Open the Timeline for the full stream, or ask for a morning brief for the narrative view.']),
      ], ctx.changedToday.length > 0);
    }

    case 'teams-need-attention': {
      const dept = r.health.domains.find((d) => d.key === 'departments');
      const ai = r.health.domains.find((d) => d.key === 'ai');
      const weak = r.health.domains.filter((d) => d.score != null && d.score < 60);
      return report('Which teams require attention?', [
        section('Answer', [
          dept && dept.score != null
            ? `Departments domain scores ${dept.score}/100 (${dept.band}). ${dept.explanation[0] ?? ''}`
            : `Departments domain unavailable: ${dept?.unavailable ?? 'unknown'}.`,
          ...(ai && ai.score != null && ai.score < 70 ? [`The AI workforce needs attention: ${ai.explanation[0] ?? ''}`] : []),
        ]),
        section('Weakest domains', weak.map((d) => `${d.label}: ${d.score}/100 (${d.band})`)),
        section('Evidence', dept?.evidence ?? []),
        section('Assumptions', ['Per-team operational metrics do not exist yet — the answer composes org-unit structure with domain health, at declared confidence.']),
        section('Confidence', [conf, ...(dept ? [`Departments confidence ${Math.round(dept.confidence * 100)}%.`] : [])]),
      ], dept != null && dept.score != null);
    }

    case 'operational-anomalies': {
      const lines = r.incidents.slice(0, 8).map(
        (i) => `${i.severity.toUpperCase()} — ${i.title}${i.rootCauseLabel ? ` · probable cause: ${i.rootCauseLabel} (${Math.round(i.rootCauseConfidence * 100)}%)` : ''}`,
      );
      return report('Operational anomalies', [
        section('Answer', [
          r.incidents.length === 0
            ? 'No anomalies detected: correlated event clusters produced no open incidents in the window.'
            : `${r.incidents.length} correlated incident(s) detected from operational events.`,
        ]),
        section('Incidents', lines),
        section('Evidence', r.incidents.slice(0, 5).flatMap((i) => i.eventIds.slice(0, 3))),
        section('Confidence', [conf]),
        section('Suggested action', r.incidents.length ? [r.incidents[0].recommendedActions[0] ?? 'Investigate the top incident.'] : ['Nothing to act on.']),
      ], true);
    }

    case 'yesterdays-failures': {
      if (ctx.yesterdayFailures.length === 0) {
        return report("Yesterday's failures", [
          section('Answer', ['No failure events were recorded yesterday.']),
          section('Confidence', [conf]),
        ], true);
      }
      const rc = ctx.rootCause(null, 48 * 3_600_000);
      return report("Yesterday's failures", [
        section('Answer', [`${ctx.yesterdayFailures.length} failure event(s) yesterday.`]),
        section('Failures', ctx.yesterdayFailures.slice(0, 10).map((f) => `${f.at.slice(11, 16)} · ${f.type} — ${f.label}`)),
        section('Probable cause', rc.candidates.slice(0, 3).map((c) => `${c.label} — ${c.reason} (${Math.round(c.confidence * 100)}%)`)),
        section('Evidence', ctx.yesterdayFailures.slice(0, 6).map((f) => f.id)),
        section('Confidence', [conf, `Root-cause confidence ${Math.round(rc.confidence * 100)}%.`]),
        section('Suggested action', ['Review the ranked causes; any recovery runs only as an approved assistant plan step.']),
      ], true);
    }

    case 'workflows-failing': {
      const failing = r.recommendations.filter((x) => x.signals.includes('automation-runs') || x.signals.includes('workflow-runs'));
      const preds = r.predictions.filter((p) => p.kind === 'automation-failure');
      return report('Which workflows repeatedly fail?', [
        section('Answer', [
          preds.length === 0 && failing.length === 0
            ? 'No workflow or automation shows a repeated-failure pattern in the recorded run history.'
            : `${preds.length + failing.length} repeated-failure pattern(s) found in run history.`,
        ]),
        section('Repeated failures', [
          ...preds.map((p) => `${p.title} — ${p.basis}`),
          ...failing.filter((f) => !preds.some((p) => f.id === `reco:${p.id}`)).slice(0, 5).map((f) => f.title),
        ]),
        section('Evidence', preds.flatMap((p) => p.evidence.slice(0, 4))),
        section('Confidence', [conf]),
        section('Suggested action', preds.length ? [preds[0].suggestedAction] : ['Nothing to fix right now.']),
      ], true);
    }

    case 'blocking-approvals': {
      const approvals = r.health.domains.find((d) => d.key === 'approvals');
      const pred = r.predictions.find((p) => p.kind === 'approval-backlog');
      return report('Which approvals are blocking?', [
        section('Answer', [
          approvals && approvals.score != null
            ? approvals.explanation[0] ?? `Approvals domain ${approvals.score}/100.`
            : `Approvals domain unavailable: ${approvals?.unavailable ?? 'unknown'}.`,
          ...(pred ? [pred.detail] : []),
        ]),
        section('Evidence', [...(approvals?.evidence ?? []), ...(pred?.evidence.slice(0, 6) ?? [])]),
        section('Confidence', [conf]),
        section('Suggested action', ['Open the Workforce approval queue and decide the oldest proposals first.']),
      ], approvals != null && approvals.score != null);
    }

    case 'predict-next-week': {
      const lines = r.predictions.slice(0, 8).map(
        (p) => `${p.title} — likelihood ${Math.round(p.likelihood * 100)}%, horizon ${p.horizonDays}d. ${p.basis}`,
      );
      return report("Next week's predicted risks", [
        section('Answer', [
          r.predictions.length === 0
            ? 'No prediction heuristic has enough evidence to fire — no risk is being projected, and none is being invented.'
            : `${r.predictions.length} deterministic risk projection(s) for the next 7 days.`,
        ]),
        section('Predictions', lines),
        section('Evidence', r.predictions.slice(0, 5).flatMap((p) => p.evidence.slice(0, 3))),
        section('Confidence', [conf, 'Each prediction carries its own breakdown; all are heuristics over recorded history, not ML.']),
        section('Suggested action', r.predictions.length ? [r.predictions[0].suggestedAction] : ['Keep signals connected so projections stay possible.']),
      ], true);
    }

    case 'enterprise-health-summary': {
      const lines = r.health.domains.map((d) =>
        d.score == null
          ? `${d.label}: unavailable — ${d.unavailable ?? 'no data'}`
          : `${d.label}: ${d.score}/100 (${d.band}) — ${d.explanation[0] ?? ''}`,
      );
      return report('Enterprise health summary', [
        section('Answer', [
          r.health.overall == null
            ? 'Enterprise health cannot be scored — no domain had available sources.'
            : `Overall enterprise health ${r.health.overall}/100 (${r.health.band}), composed from ${r.health.domains.filter((d) => d.score != null).length} of 8 domains.`,
        ]),
        section('Domains', lines),
        section('Unavailable', unavailableLines),
        section('Confidence', [confidenceLine(r.health.confidence)]),
        section('Suggested action', ['Open the Intelligence Center for the full dashboard with evidence and recommendations.']),
      ], r.health.overall != null);
    }
  }
}
