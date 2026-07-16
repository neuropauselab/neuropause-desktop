/**
 * P18 — Enterprise Intelligence Network composition root.
 *
 * The governed intelligence-EXCHANGE projection LAYER. It composes a READ-ONLY, ALREADY-SANITIZED
 * snapshot from the EXISTING signals — the P7 report (health/KPIs, injected), the P16 Knowledge Fabric
 * evidence/classification/analytics/governance (injected — evidence already identity-redacted), the P13
 * Industry benchmark reference (injected), the P15 Twin + P17 Orchestration aggregate metrics (injected),
 * and the EXISTING federation exchange substrate (exchange artifacts, ecosystem packs, marketplace
 * enterprise-templates) + federation trust/consent/policy (imported singletons, read-only) — into
 * intelligence-exchange projections behind RBAC-gated IPC (`network:read`).
 *
 * THE CARDINAL INVARIANT: no raw enterprise record leaves the tenant. `buildState` reduces every source
 * to authored text + aggregate numbers + own-org provenance BEFORE it enters the model — recommendation
 * evidence is reduced to ref KINDS (never entity ids), the exchange carriers are catalog descriptors
 * (no payload by construction), and restricted-sensitivity knowledge is counted but never projected. It
 * imports NO exchange/publish/share mutator — structurally unable to transmit anything; it projects what
 * IS shareable under governance. It creates no new store/runtime, reuses the existing `ecosystem:event`
 * broadcast for renderer liveness, and wraps every read defensively so one failing source degrades rather
 * than crashes the projection.
 */
import {
  EmptyRequest,
  IpcChannel,
  type EnterpriseIntelligenceReport,
  type EnterpriseTwinOverview,
  type ExecutiveKpi,
  type FabricAnalytics,
  type FabricClassification,
  type FabricEvidenceReport,
  type FabricGovernance,
  type IndustryReadinessReport,
  type OrchestrationOverview,
  type StrategyOverview,
} from '@neuropause/shared';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { createLogger } from '../logger';
import { exchangeStore } from '../federation/exchange/exchangeInstance';
import { packsStore } from '../ecosystem/exchange/packsInstance';
import { marketplaceStore } from '../ecosystem/marketplace/marketplaceInstance';
import { fedStore } from '../federation/runtime/fedInstance';
import { globalGovStore } from '../federation/governance/globalGovInstance';
import { EnterpriseIntelligenceNetworkService } from './networkService';
import type { IntelNetworkState, NetworkMetric, RegistryEntryInput, SharedRecommendationInput } from './networkModel';
import { bandFor } from './networkModel';
import { withNetworkAuthz } from './networkAuthz';

const log = createLogger('intelligence-network');

export interface EnterpriseIntelligenceNetworkDeps {
  enterpriseReport: () => EnterpriseIntelligenceReport;
  strategyOverview: () => StrategyOverview;
  twinOverview: () => EnterpriseTwinOverview;
  orchestrationOverview: () => OrchestrationOverview;
  /** P16 Knowledge Fabric — the ALREADY-SANITIZED intelligence spine (injected accessors). */
  knowledgeEvidence: () => FabricEvidenceReport;
  knowledgeClassification: () => FabricClassification;
  knowledgeAnalytics: () => FabricAnalytics;
  knowledgeGovernance: () => FabricGovernance;
  /** P13 Industry — the benchmark reference (injected accessors). */
  industryKpis: () => ExecutiveKpi[];
  industryReadiness: () => IndustryReadinessReport;
}

export interface EnterpriseIntelligenceNetworkSubsystem {
  handlers: SecureHandlerDef[];
  service: EnterpriseIntelligenceNetworkService;
  dispose: () => void;
}

function safe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

/** Map an industry KPI key to a benchmark dimension so org metrics can pair against it. */
function industryDimension(key: string): string {
  const k = key.toLowerCase();
  if (k.includes('coverage')) return 'coverage';
  if (k.includes('activation')) return 'activation';
  if (k.includes('ready')) return 'readiness';
  if (k.includes('connect')) return 'connectors';
  return key;
}

/** Compose the sanitized network snapshot from the EXISTING platform signals (no new store/runtime). */
function buildState(deps: EnterpriseIntelligenceNetworkDeps): IntelNetworkState {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  const report = safe(() => deps.enterpriseReport());
  const evidence = safe(() => deps.knowledgeEvidence());
  const classification = safe(() => deps.knowledgeClassification());
  const analytics = safe(() => deps.knowledgeAnalytics());
  const knowledgeGov = safe(() => deps.knowledgeGovernance());
  const industryKpis = safe(() => deps.industryKpis()) ?? [];
  const readiness = safe(() => deps.industryReadiness());
  const strategy = safe(() => deps.strategyOverview());
  const twin = safe(() => deps.twinOverview());
  const orchestration = safe(() => deps.orchestrationOverview());

  // Health — assume-worst when the intelligence report is unavailable (never falsely healthy).
  const health = report ? { overall: report.health.overall, band: report.health.band } : { overall: 0, band: 'critical' as const };
  const kpis = report?.kpis ?? strategy?.kpis ?? [];

  // Sanitized recommendations — from the P16 Fabric explanations; evidence reduced to ref KINDS only.
  const ADVISORY = new Set(['recommendation', 'reasoning', 'optimization']);
  const recommendations: SharedRecommendationInput[] = (evidence?.explanations ?? [])
    .filter((x) => ADVISORY.has(x.kind))
    .map((x) => ({
      id: x.id,
      category: x.kind,
      title: x.subject,
      detail: x.reasoning,
      confidence: x.confidence,
      sources: x.sources,
      evidenceKinds: [...new Set(x.evidence.map((e) => e.kind))].sort(), // KINDS only — no entity ids/keys
      shareable: x.confidenceBand !== 'critical', // governed: low-confidence intelligence is not exchanged
    }));

  // Aggregate patterns — from the P16 classification (counts only).
  const patterns = [
    ...(classification?.byKind ?? []).map((c) => ({ key: `kind:${c.key}`, label: c.label, count: c.count, dimension: 'kind' as const })),
    ...(classification?.byDomain ?? []).map((c) => ({ key: `domain:${c.key}`, label: c.label, count: c.count, dimension: 'domain' as const })),
    ...(classification?.topTags ?? []).map((t) => ({ key: `tag:${t.tag}`, label: t.tag, count: t.count, dimension: 'tag' as const })),
  ];
  const restrictedCount = (classification?.sensitivity ?? []).find((x) => x.key === 'restricted')?.count ?? 0;

  // Org aggregate metrics (0..100) for benchmarking.
  const metric = (key: string, label: string, value: number, dimension: string): NetworkMetric => ({ key, label, value, band: bandFor(value), dimension });
  const orgMetrics: NetworkMetric[] = [
    metric('coverage', 'Knowledge coverage', analytics?.knowledgeCoverage ?? 0, 'coverage'),
    metric('explanation', 'Explanation coverage', analytics?.explanationCoverage ?? 0, 'explanation'),
    metric('readiness', 'Enterprise readiness', twin?.summary.overallHealth ?? health.overall, 'readiness'),
    metric('network', 'Network health', orchestration?.summary.overallHealth ?? health.overall, 'network'),
  ];

  // Industry reference (0..100), from P13 KPIs (value!==null) + the readiness average activation.
  const industryRef: NetworkMetric[] = industryKpis
    .filter((k) => k.value != null)
    .map((k) => ({ key: k.key, label: k.label, value: k.value as number, band: k.band ?? bandFor(k.value as number), dimension: industryDimension(k.key) }));
  if (readiness && !industryRef.some((r) => r.dimension === 'activation')) {
    const act = Math.round(readiness.averageActivation * 100);
    industryRef.push({ key: 'industry.readiness.activation', label: 'Industry activation', value: act, band: bandFor(act), dimension: 'activation' });
  }

  // Insight registry — the EXISTING exchange substrate, as catalog descriptors only.
  const homeOrgId = safe(() => fedStore.homeOrg())?.id ?? null;
  const artifacts = safe(() => exchangeStore.listArtifacts()) ?? [];
  const packs = safe(() => packsStore.list()) ?? [];
  const listings = safe(() => marketplaceStore.list()) ?? [];
  const registry: RegistryEntryInput[] = [
    ...artifacts.map((a) => ({ id: `artifact:${a.id}`, kind: a.kind, name: a.name, summary: a.summary, scope: a.scope, source: 'exchange' as const, verification: a.verification, local: homeOrgId != null && a.publisherOrg === homeOrgId, installs: a.installs })),
    ...packs.map((p) => ({ id: `pack:${p.id}`, kind: p.kind, name: p.name, summary: p.summary, scope: 'pack', source: 'pack' as const, verification: p.installed ? 'imported' : 'local', local: p.isLocal, installs: p.installs })),
    ...listings.filter((l) => l.kind === 'enterprise_template').map((l) => ({ id: `listing:${l.id}`, kind: l.kind, name: l.name, summary: l.summary, scope: l.status, source: 'marketplace' as const, verification: l.certified ? 'certified' : 'unverified', local: true, installs: l.installs })),
  ];
  const exSummary = safe(() => exchangeStore.summary());
  const exchangeSummary = { artifacts: exSummary?.artifacts ?? artifacts.length, published: exSummary?.published ?? 0, verified: exSummary?.verified ?? 0, installs: exSummary?.installs ?? 0 };

  // Trust / consent / policy — the who-may-exchange gate.
  const trust = (safe(() => fedStore.listTrust()) ?? []).map((t) => ({ peer: t.peerOrgName, trustLevel: t.trustLevel, canShareData: t.canShareData, canShareWorkers: t.canShareWorkers, delegatedApproval: t.delegatedApproval }));
  const fedSum = safe(() => fedStore.summary());
  const fedSummary = { orgs: fedSum?.orgs ?? 0, peers: fedSum?.peers ?? 0, activePeers: fedSum?.activePeers ?? 0, trustedPeers: fedSum?.trustedPeers ?? 0, sharedOut: fedSum?.sharedOut ?? 0, sharedIn: fedSum?.sharedIn ?? 0 };
  const policies = (safe(() => globalGovStore.listPolicies()) ?? []).map((p) => ({ name: p.name, scope: p.scope, effect: p.effect, action: p.action, enabled: p.enabled }));
  const openApprovals = (safe(() => globalGovStore.listApprovals()) ?? []).filter((a) => a.status === 'pending').length;

  const redactions = knowledgeGov?.redactions ?? [];

  return { generatedAt: report ? report.generatedAt : nowIso, health, recommendations, patterns, restrictedCount, orgMetrics, industryRef, registry, exchangeSummary, trust, fedSummary, policies, openApprovals, redactions, kpis };
}

export function initEnterpriseIntelligenceNetwork(deps: EnterpriseIntelligenceNetworkDeps): EnterpriseIntelligenceNetworkSubsystem {
  const service = new EnterpriseIntelligenceNetworkService({ readState: () => buildState(deps) });

  // Invalidate the memoized snapshot when a backing store changes; the injected knowledge/industry/
  // twin/orchestration accessors refresh via the service TTL. Renderer liveness reuses `ecosystem:event`.
  const invalidate = (): void => service.invalidate();
  fedStore.on('changed', invalidate);
  marketplaceStore.on('changed', invalidate);

  const rawHandlers: SecureHandlerDef[] = [
    { channel: IpcChannel.NetworkOverview, schema: EmptyRequest, handler: () => service.overview() },
    { channel: IpcChannel.NetworkExchange, schema: EmptyRequest, handler: () => service.exchange() },
    { channel: IpcChannel.NetworkBenchmarks, schema: EmptyRequest, handler: () => service.benchmarks() },
    { channel: IpcChannel.NetworkInsights, schema: EmptyRequest, handler: () => service.insights() },
    { channel: IpcChannel.NetworkTrust, schema: EmptyRequest, handler: () => service.trust() },
    { channel: IpcChannel.NetworkOrganizations, schema: EmptyRequest, handler: () => service.organizations() },
    { channel: IpcChannel.NetworkCollective, schema: EmptyRequest, handler: () => service.collective() },
    { channel: IpcChannel.NetworkGovernance, schema: EmptyRequest, handler: () => service.governance() },
  ];
  const handlers = withNetworkAuthz(rawHandlers);

  const dispose = (): void => {
    fedStore.off('changed', invalidate);
    marketplaceStore.off('changed', invalidate);
  };

  log.info('Enterprise Intelligence Network ready', { modules: safe(() => service.overview().modules.length) ?? 0 });
  return { handlers, service, dispose };
}
