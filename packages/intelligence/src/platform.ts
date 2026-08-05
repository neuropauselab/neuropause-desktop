/**
 * Module 12 — Runtime APIs / composition root. `createIntelligencePlatform(runtime, …)`
 * assembles the Wave 3 intelligence layer on the EXISTING platform: it reuses the
 * ai-runtime (InferencePipeline + governance + provider registry, backed by our persisted
 * enterprise memory as its LongTermMemory), the one audit chain + event bus, NEMS, and
 * connectivity. It registers a deterministic, evidence-grounded provider by default (live
 * LLMs plug into the same registry when keys exist). Per-tenant intelligence (graph +
 * everything derived from it) is built on demand and cached. Exposes the runtime API the
 * program named: ai / copilots / memory / graph / reasoning / timeline / briefings /
 * workspace / intelligence / models.
 */
import { systemClock, sha256Hex, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import type { SqlDriver } from '@neuropause/persistence';
import type { NemsPlatform } from '@neuropause/nems';
import type { ConnectivityPlatform } from '@neuropause/connectivity';
import { createAiRuntime, type AiRuntime, type AiProvider } from '@neuropause/ai-runtime';
import { INTELLIGENCE_VERSION } from './constants';
import { INTELLIGENCE_MATRIX, intelligenceReadiness, type CapabilityEvidence, type IntelligenceReadiness } from './evidence';
import { EnterpriseMemory } from './memory';
import { IntelligenceGovernance } from './governance';
import { DeterministicAiProvider, ModelRouter } from './ai';
import { AnswerEngine } from './engine';
import { buildKnowledgeGraph, type KnowledgeGraph } from './graph';
import { EnterpriseTimeline } from './timeline';
import { ReasoningEngine } from './reasoning';
import { IntelligenceServices } from './intelligence';
import { EnterpriseSearchV2 } from './searchv2';
import { CopilotSuite } from './copilots';
import { AiWorkspace } from './workspace';
import { BriefingEngine } from './briefings';
import { ExecutiveDashboards } from './dashboards';

export interface TenantIntelligence {
  graph: KnowledgeGraph;
  timeline: EnterpriseTimeline;
  reasoning: ReasoningEngine;
  intelligence: IntelligenceServices;
  search: EnterpriseSearchV2;
  copilots: CopilotSuite;
  workspace: AiWorkspace;
  briefings: BriefingEngine;
  dashboards: ExecutiveDashboards;
}

export interface IntelligencePlatformOptions {
  driver: SqlDriver;
  nems: NemsPlatform;
  connectivity?: ConnectivityPlatform;
  clock?: Clock;
  aiRuntime?: AiRuntime;
  provider?: AiProvider;
}

export interface IntelligencePlatform {
  version: string;
  ai(): ModelRouter;
  models(): ModelRouter;
  memory(): EnterpriseMemory;
  governance(): IntelligenceGovernance;
  aiRuntime(): AiRuntime;
  matrix(): CapabilityEvidence[];
  readiness(): IntelligenceReadiness;
  forTenant(tenantId: string): Promise<TenantIntelligence>;
  refresh(tenantId: string): Promise<TenantIntelligence>;
  graph(tenantId: string): Promise<KnowledgeGraph>;
  timeline(tenantId: string): Promise<EnterpriseTimeline>;
  reasoning(tenantId: string): Promise<ReasoningEngine>;
  intelligence(tenantId: string): Promise<IntelligenceServices>;
  search(tenantId: string): Promise<EnterpriseSearchV2>;
  copilots(tenantId: string): Promise<CopilotSuite>;
  workspace(tenantId: string): Promise<AiWorkspace>;
  briefings(tenantId: string): Promise<BriefingEngine>;
  dashboards(tenantId: string): Promise<ExecutiveDashboards>;
}

export async function createIntelligencePlatform(runtime: EnterpriseRuntime, options: IntelligencePlatformOptions): Promise<IntelligencePlatform> {
  const clock = options.clock ?? systemClock;
  const governance = new IntelligenceGovernance(runtime, clock);

  // Persisted enterprise memory — also audited (via the one audit chain).
  const memory = new EnterpriseMemory(options.driver, clock, (rec, op) => {
    runtime.audit().append({ actor: rec.tenantId, action: `intelligence.memory.${op}`, target: `${rec.tenantId}:${rec.kind}`, deviceId: 'intelligence', at: rec.createdAt, dataHash: sha256Hex(`${rec.id}:${rec.version}`) });
  });
  await memory.init();

  // Reuse the ai-runtime; back its long-term memory with our persisted store.
  const aiRuntime = options.aiRuntime ?? createAiRuntime(runtime, { longTermMemory: memory });
  const provider = options.provider ?? new DeterministicAiProvider();
  if (!aiRuntime.providers().get(provider.id)) aiRuntime.providers().register(provider);
  const router = new ModelRouter(aiRuntime.providers(), { fallbackProviderId: 'deterministic' });
  const answerEngine = new AnswerEngine(aiRuntime.ai(), governance);

  const cache = new Map<string, TenantIntelligence>();
  async function ensure(tenantId: string): Promise<TenantIntelligence> {
    const hit = cache.get(tenantId);
    if (hit) return hit;
    const graph = await buildKnowledgeGraph(tenantId, { nems: options.nems, ...(options.connectivity ? { connectivity: options.connectivity } : {}), runtime }, clock);
    const timeline = new EnterpriseTimeline(graph);
    const reasoning = new ReasoningEngine(graph, timeline);
    const intelligence = new IntelligenceServices(graph, timeline, reasoning);
    const search = new EnterpriseSearchV2(graph, timeline, memory);
    const deps = { graph, timeline, reasoning, intelligence, answerEngine };
    const copilots = new CopilotSuite(deps);
    const workspace = new AiWorkspace({ graph, search, answerEngine });
    const briefings = new BriefingEngine({ graph, timeline, reasoning, intelligence, answerEngine, clock });
    const dashboards = new ExecutiveDashboards({ graph, intelligence, copilots });
    const ti: TenantIntelligence = { graph, timeline, reasoning, intelligence, search, copilots, workspace, briefings, dashboards };
    cache.set(tenantId, ti);
    return ti;
  }

  return {
    version: INTELLIGENCE_VERSION,
    ai: () => router,
    models: () => router,
    memory: () => memory,
    governance: () => governance,
    aiRuntime: () => aiRuntime,
    matrix: () => INTELLIGENCE_MATRIX,
    readiness: () => intelligenceReadiness(),
    forTenant: ensure,
    refresh: async (t) => {
      cache.delete(t);
      return ensure(t);
    },
    graph: async (t) => (await ensure(t)).graph,
    timeline: async (t) => (await ensure(t)).timeline,
    reasoning: async (t) => (await ensure(t)).reasoning,
    intelligence: async (t) => (await ensure(t)).intelligence,
    search: async (t) => (await ensure(t)).search,
    copilots: async (t) => (await ensure(t)).copilots,
    workspace: async (t) => (await ensure(t)).workspace,
    briefings: async (t) => (await ensure(t)).briefings,
    dashboards: async (t) => (await ensure(t)).dashboards,
  };
}
