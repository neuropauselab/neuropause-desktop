/**
 * Experience Program v1.0 — the decision-first experience composition root.
 *
 * The READ-ONLY compression LAYER over the ENTIRE platform (P1–P20). It composes a snapshot from the
 * EXISTING signals — the P7 report (health/risk/KPIs/incidents), the P14 Strategy decisions + optimization,
 * the P19 operations overview + approvals, the P15 Twin + P16 Knowledge summaries, the P20 commercial
 * revenue/adoption, and the workforce/connector/marketplace stores — and distills them into the executive
 * Decision Center. It imports NO mutator; it reads and compresses only. It creates no new store/runtime and
 * reuses `ecosystem:event` for renderer liveness; every read is defensively wrapped so one failing source
 * degrades rather than crashes the projection. Nothing here executes, approves, or mutates — the interface
 * shows only what the human needs to decide, and every action still flows through the existing engines.
 */
import {
  EmptyRequest,
  IpcChannel,
  type AutoOpsApprovals,
  type AutoOpsOverview,
  type CommercialOverview,
  type DecisionQueue,
  type EnterpriseIntelligenceReport,
  type EnterpriseTwinOverview,
  type ExperienceBand,
  type ExperienceKpiLite,
  type FabricOverview,
  type StrategyOverview,
} from '@neuropause/shared';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { createLogger } from '../logger';
import { connectorService } from '../connectors/connectorService';
import { workerRegistry } from '../workforce/registry/registryInstance';
import { jobStore } from '../workforce/runtime/jobInstance';
import { workforceIntelligence } from '../workforce/intelligence/workforceIntelligence';
import { marketplaceStore } from '../ecosystem/marketplace/marketplaceInstance';
import { ExperienceService } from './experienceService';
import type { DecisionInput, ExperienceState, ModuleSummaryInput } from './experienceModel';
import { valueBand, workforceBand } from './experienceModel';
import { withExperienceAuthz } from './experienceAuthz';
import { activeTenantScope } from '../enterprise/index';

const log = createLogger('experience');

export interface ExperienceDeps {
  enterpriseReport: () => EnterpriseIntelligenceReport;
  strategyDecisions: () => DecisionQueue;
  strategyOverview: () => StrategyOverview;
  opsOverview: () => AutoOpsOverview;
  opsApprovals: () => AutoOpsApprovals;
  twinOverview: () => EnterpriseTwinOverview;
  knowledgeOverview: () => FabricOverview;
  commercialOverview: () => CommercialOverview;
}

export interface ExperienceSubsystem {
  handlers: SecureHandlerDef[];
  service: ExperienceService;
  dispose: () => void;
}

function safe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

const round = (n: number): number => Math.round(Number.isFinite(n) ? n : 0);
const asBand = (b: string | undefined): ExperienceBand => (b === 'healthy' || b === 'watch' || b === 'at-risk' || b === 'critical' ? b : 'watch');

/** Strategy/plan priority → band. */
function priorityBand(p: string): ExperienceBand {
  return p === 'critical' ? 'critical' : p === 'high' ? 'at-risk' : p === 'medium' ? 'watch' : 'healthy';
}
function priorityUrgency(p: string): number {
  return p === 'critical' ? 95 : p === 'high' ? 75 : p === 'medium' ? 50 : 25;
}
/** Risk level (0..100, higher = worse) → band. */
function riskLevelBand(risk: number): ExperienceBand {
  return risk >= 75 ? 'critical' : risk >= 50 ? 'at-risk' : risk >= 25 ? 'watch' : 'healthy';
}
function bandUrgency(b: ExperienceBand): number {
  return b === 'critical' ? 95 : b === 'at-risk' ? 75 : b === 'watch' ? 50 : 25;
}
function bandFor(score: number): ExperienceBand {
  return score >= 75 ? 'healthy' : score >= 50 ? 'watch' : score >= 25 ? 'at-risk' : 'critical';
}

/** Compose the experience snapshot from the EXISTING platform signals (no new store/runtime). */
function buildState(deps: ExperienceDeps): ExperienceState {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const hour = new Date(now).getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const report = safe(() => deps.enterpriseReport());
  const decisionQueue = safe(() => deps.strategyDecisions());
  const strategy = safe(() => deps.strategyOverview());
  const ops = safe(() => deps.opsOverview());
  const approvals = safe(() => deps.opsApprovals());
  const twin = safe(() => deps.twinOverview());
  const knowledge = safe(() => deps.knowledgeOverview());
  const commercial = safe(() => deps.commercialOverview());

  // ── Business health ──
  const health = { score: report?.health.overall ?? 0, band: asBand(report?.health.band) };

  // ── Workforce ──
  const wfi = safe(() => workforceIntelligence(jobStore.page({ limit: 2000 }).jobs));
  const awaitingCount = safe(() => jobStore.page({ status: 'awaiting_approval', limit: 1 }).total) ?? 0;
  const successPct = (wfi?.overallSuccessRate ?? 0) * 100;
  const wfBand = workforceBand(wfi?.totalJobs ?? 0, successPct); // idle (no jobs) → neutral, never false-red
  const workforce = { successPct, activeWorkers: wfi?.activeWorkers ?? 0, needApproval: awaitingCount };
  const totalWorkers = (safe(() => workerRegistry.summaries()) ?? []).length;

  // ── One decision (top strategy decision) ──
  const topDec = decisionQueue?.decisions?.[0] ?? null;
  const oneDecision = topDec
    ? { id: `dec:${topDec.id}`, title: topDec.title, why: topDec.rationale, band: priorityBand(topDec.priority), source: 'Strategy', requiredApprovals: topDec.requiredApprovals?.length ?? 0, evidenceCount: topDec.evidence?.length ?? 0 }
    : null;

  // ── Today's mission (the single most important outcome) ──
  const topOpt = strategy?.optimization?.opportunities?.[0] ?? null;
  const mission = topDec
    ? { title: topDec.title, detail: topDec.recommendation, why: topDec.rationale }
    : topOpt
      ? { title: topOpt.title, detail: topOpt.detail, why: topOpt.recommendedAction }
      : { title: 'Keep the momentum', detail: 'Nothing critical is pending — the platform is running your operations.', why: 'The AI reviewed every subsystem and found nothing that needs you right now.' };

  // ── One risk (top risk contributor) ──
  const topRisk = report?.risk?.topRisks?.[0] ?? null;
  const oneRisk = topRisk
    ? { id: `risk:${topRisk.id}`, title: topRisk.label, domain: topRisk.domain, risk: round(topRisk.risk), band: riskLevelBand(topRisk.risk), reason: topRisk.reason }
    : null;

  // ── One approval (top pending, already unified across workforce/federation/enterprise by P19) ──
  const topApp = approvals?.pending?.[0] ?? null;
  const oneApproval = topApp ? { id: `app:${topApp.id}`, title: topApp.title, source: topApp.source, requestedBy: topApp.requestedBy, band: asBand(topApp.band) } : null;

  // ── Revenue / value (best available signal, honestly labelled) ──
  const revKpi = (report?.kpis ?? []).find((k) => /revenue|arr|mrr|sales/i.test(k.key) || /revenue|sales/i.test(k.label));
  const revenue = revKpi
    ? { display: revKpi.display, label: revKpi.label, band: asBand(revKpi.band), detail: 'From the enterprise KPI set.' }
    : commercial
      ? { display: `${commercial.summary.currency}${Math.round(commercial.summary.monthlySavingUsd).toLocaleString()}`, label: 'Monthly value', band: valueBand(commercial.summary.monthlySavingUsd), detail: 'Estimated monthly value delivered by the platform (P14 ROI).' }
      : { display: 'n/a', label: 'Revenue', band: 'watch' as ExperienceBand, detail: 'No revenue signal is available yet.' };

  // ── Role-adaptive KPI pool ──
  const scoreOf = (key: string): number => report?.health.scores.find((sc) => sc.key === key)?.score ?? 0;
  const bandOfScore = (key: string): ExperienceBand => asBand(report?.health.scores.find((sc) => sc.key === key)?.band);
  const opsHealth = ops?.summary.overallHealth ?? health.score;
  const pendingCount = approvals?.pendingCount ?? awaitingCount;
  const adoption = commercial?.summary.adoptionScore ?? 0;
  const kpiPool: Record<string, ExperienceKpiLite> = {
    health: { label: 'Business health', display: `${round(health.score)}/100`, band: health.band },
    revenue: { label: revenue.label, display: revenue.display, band: revenue.band },
    risk: { label: 'Risk', display: `${round(report?.risk?.overall ?? 0)}/100`, band: asBand(report?.risk?.band) },
    workforce: { label: 'AI workforce', display: `${round(successPct)}%`, band: wfBand },
    approvals: { label: 'Approvals pending', display: `${pendingCount}`, band: pendingCount > 0 ? 'watch' : 'healthy' },
    reliability: { label: 'Reliability', display: `${round(opsHealth)}/100`, band: asBand(ops?.summary.healthBand) },
    security: { label: 'Security', display: `${round(scoreOf('security'))}/100`, band: bandOfScore('security') },
    compliance: { label: 'Compliance', display: `${round(scoreOf('compliance'))}/100`, band: bandOfScore('compliance') },
    cloud: { label: 'Cloud cost', display: `${commercial?.summary.currency ?? '$'}${round(commercial?.summary.estimatedMonthlyCost ?? 0).toLocaleString()}/mo`, band: 'healthy' },
    adoption: { label: 'Adoption', display: `${round(adoption)}/100`, band: bandFor(adoption) },
  };

  // ── Decision queue (only actionable, ranked) ──
  const decisions: DecisionInput[] = [];
  for (const d of (decisionQueue?.decisions ?? []).slice(0, 8)) {
    decisions.push({ id: `dec:${d.id}`, kind: 'decision', title: d.title, why: d.rationale, band: priorityBand(d.priority), urgency: priorityUrgency(d.priority), source: 'Strategy', requiredApprovals: d.requiredApprovals?.length ?? 0, evidenceCount: d.evidence?.length ?? 0 });
  }
  for (const a of (approvals?.pending ?? []).slice(0, 8)) {
    decisions.push({ id: `app:${a.id}`, kind: 'approval', title: a.title, why: `Pending ${a.source} approval.`, band: asBand(a.band), urgency: bandUrgency(asBand(a.band)), source: a.source, requiredApprovals: a.requiredApprovals?.length ?? 1, evidenceCount: 0 });
  }
  for (const o of (strategy?.optimization?.opportunities ?? []).slice(0, 4)) {
    decisions.push({ id: `opt:${o.id}`, kind: 'optimization', title: o.title, why: o.recommendedAction, band: priorityBand(o.priority), urgency: priorityUrgency(o.priority) - 5, source: 'Strategy', requiredApprovals: o.requiredApproval?.governed ? 1 : 0, evidenceCount: o.evidence?.length ?? 0 });
  }
  const rawDecisionSignals = (decisionQueue?.count ?? 0) + (approvals?.pendingCount ?? 0) + (strategy?.optimization?.count ?? 0) + (report?.incidents?.open ?? 0);

  // ── Per-module executive summaries (compress N → one sentence) ──
  const connStats = safe(() => connectorService.stats());
  const connTotal = connStats?.total ?? 0;
  const connHealthy = connStats?.healthy ?? connStats?.connected ?? 0;
  const connAttention = (connStats?.degraded ?? 0) + (connStats?.down ?? 0);
  const listings = safe(() => marketplaceStore.list()) ?? [];
  const moduleSummaries: ModuleSummaryInput[] = [];
  if (twin) {
    moduleSummaries.push({ key: 'twin', label: 'Digital Twin', headline: `Digital Twin health is ${asBand(twin.summary.healthBand)} at ${round(twin.summary.overallHealth)}/100 across ${twin.summary.domainCount} domains.`, band: asBand(twin.summary.healthBand), compressedFrom: twin.summary.totalEntities, detail: `${twin.summary.totalEntities} entities · ${twin.summary.openDecisions} open decisions.`, expandTo: 'twin-center' });
  }
  if (knowledge) {
    moduleSummaries.push({ key: 'knowledge', label: 'Knowledge Fabric', headline: `${knowledge.summary.totalEntities.toLocaleString()} knowledge entities, ${round(knowledge.summary.evidenceCoverage)}% evidence-backed.`, band: asBand(knowledge.summary.healthBand), compressedFrom: knowledge.summary.totalEntities, detail: `${knowledge.summary.relationships} relationships · ${knowledge.summary.explanations} explanations.`, expandTo: 'knowledge-center' });
  }
  if (ops) {
    const opsOpen = ops.summary.openIncidents + ops.summary.pendingApprovals;
    moduleSummaries.push({ key: 'operations', label: 'Operations', headline: opsOpen > 0 ? `${ops.summary.openIncidents} incident(s) and ${ops.summary.pendingApprovals} approval(s) need attention.` : 'Operations are healthy — nothing needs you.', band: asBand(ops.summary.healthBand), compressedFrom: ops.summary.operationalPlans + ops.summary.openIncidents, detail: `${ops.summary.operationalPlans} plans · ${ops.summary.optimizationOpportunities} optimizations.`, expandTo: 'auto-ops-center' });
  }
  moduleSummaries.push({ key: 'workforce', label: 'AI Workforce', headline: `Your AI workforce completed ${round(successPct)}% of objectives${awaitingCount > 0 ? `; ${awaitingCount} need approval` : ''}.`, band: wfBand, compressedFrom: totalWorkers, detail: `${totalWorkers} workers · ${workforce.activeWorkers} active.`, expandTo: 'organization' });
  if (connStats) {
    moduleSummaries.push({ key: 'connectors', label: 'Connectors', headline: `${connHealthy} of ${connTotal} connectors healthy${connAttention > 0 ? `; ${connAttention} need attention` : ''}.`, band: connAttention === 0 ? 'healthy' : (connStats.down ?? 0) > 0 ? 'at-risk' : 'watch', compressedFrom: connTotal, detail: `${connStats.connected} connected · ${connAttention} need attention.`, expandTo: 'control-plane' });
  }
  moduleSummaries.push({ key: 'marketplace', label: 'Marketplace', headline: `${listings.length} apps available — showing the best ${Math.min(5, listings.length)} for your intent.`, band: 'healthy', compressedFrom: listings.length, detail: 'Recommended over browsing — five best matches, not thousands.', expandTo: 'store' });

  const compressedSignals = moduleSummaries.reduce((n, m) => n + m.compressedFrom, 0) + rawDecisionSignals;

  return {
    greeting,
    generatedAt: nowIso,
    health,
    mission,
    revenue,
    workforce,
    oneDecision,
    oneRisk,
    oneApproval,
    kpiPool,
    decisions,
    rawDecisionSignals,
    moduleSummaries,
    compressedSignals,
  };
}

export function initExperience(deps: ExperienceDeps): ExperienceSubsystem {
  const service = new ExperienceService({ scope: activeTenantScope, readState: () => buildState(deps) });

  // Invalidate the memoized snapshot when a backing store changes; the injected report/strategy/ops/twin/
  // knowledge/commercial accessors refresh via the service TTL. Renderer liveness reuses `ecosystem:event`.
  const invalidate = (): void => service.invalidate();
  jobStore.on('changed', invalidate);
  connectorService.on('event', invalidate);

  const rawHandlers: SecureHandlerDef[] = [
    { channel: IpcChannel.ExperienceHome, schema: EmptyRequest, handler: () => service.home() },
    { channel: IpcChannel.ExperienceDecisions, schema: EmptyRequest, handler: () => service.decisions() },
    { channel: IpcChannel.ExperienceSummaries, schema: EmptyRequest, handler: () => service.summaries() },
    { channel: IpcChannel.ExperienceIntents, schema: EmptyRequest, handler: () => service.intents() },
    { channel: IpcChannel.ExperienceGovernance, schema: EmptyRequest, handler: () => service.governance() },
  ];
  const handlers = withExperienceAuthz(rawHandlers);

  const dispose = (): void => {
    jobStore.off('changed', invalidate);
    connectorService.off('event', invalidate);
  };

  log.info('Decision-first experience ready', { compressed: safe(() => service.home().compressedSignals) ?? 0 });
  return { handlers, service, dispose };
}
