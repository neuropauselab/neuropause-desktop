/**
 * AI subsystem composition root. Wires Engineering AI to the live subsystems: the
 * Context Builder over the UDM search backend + knowledge graph + AI memory + the
 * Mission Brief, the shared AI Engine, the deterministic engineering facts (from
 * the briefing), and the governance gate. Stateless per request; reads only
 * derived state. Mirrors the Founder AI / Daily Intelligence roots.
 */
import type {
  EngineeringAnalysis,
  EngineeringAiRequest as TEngineeringAiRequest,
  FounderResponse,
  FounderSuggestedQuestion,
  FounderAskV2Request as TFounderAskV2Request,
  FounderSuggestionsRequest as TFounderSuggestionsRequest,
} from '@neuropause/shared';
import {
  EngineeringAiRequest,
  FounderAskV2Request,
  FounderSuggestionsRequest,
  IpcChannel,
} from '@neuropause/shared';
import { createLogger } from '../logger';
import { randomUUID } from 'node:crypto';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { withAiAuthz } from './aiAuthzGate';
import { unifiedStore } from '../unified/storeInstance';
import { graphStore } from '../graph/graphInstance';
import { memoryStore } from '../memory/memoryInstance';
import { activeTenantScope } from '../enterprise';
import { memoryAuditLog } from '../memory/memoryAuditInstance';
import { getEnterpriseTimeline } from '../timeline';
import { generateBriefing } from '../intelligence/briefingGenerator';
import { createContextBuilder } from './contextBuilder';
import { aiEngine } from './engineInstance';
import { analyzeEngineering, engineeringFactsFromBriefing } from './engineeringAI';
import { answerFounder, founderFindingsFromBriefing } from './founderAI';
import { deriveFounderSuggestions } from './founderSuggestions';

const log = createLogger('engineering-ai');
const founderLog = createLogger('founder-ai-v2');

export interface AiSubsystem {
  handlers: SecureHandlerDef[];
  dispose: () => void;
}

export function initEngineeringAI(): AiSubsystem {
  const analyze = (req: TEngineeringAiRequest): Promise<EngineeringAnalysis> => {
    const now = req.now ?? new Date().toISOString();
    const entities = unifiedStore.query({ limit: 1_000_000, includeDeleted: false }).items;
    const tl = getEnterpriseTimeline();
    const events = tl ? tl.query({ limit: 2000, order: 'desc' }).entries : [];
    const brief = generateBriefing('morning', { entities, events, now });

    const contextBuilder = createContextBuilder({
      searchSources: {
        entity: unifiedStore.searchBackend,
        graph: graphStore,
        memory: memoryStore,
        // P13A — the authority the memory leg runs under. Same resolver as every
        // other scoped surface; null (cold start / signed out) yields no memory hits.
        memoryScope: activeTenantScope(),
      },
      getBriefing: () => brief,
    });

    return analyzeEngineering(
      {
        buildContext: (r) => contextBuilder.build(r),
        run: (r) => aiEngine.run(r),
        deterministicFacts: () => engineeringFactsFromBriefing(brief),
        now: () => now,
      },
      { subject: req.subject, now },
    );
  };

  const handlers: SecureHandlerDef[] = withAiAuthz([
    {
      channel: IpcChannel.EngineeringAnalyze,
      schema: EngineeringAiRequest,
      handler: (p) => analyze(p as TEngineeringAiRequest),
    },
  ]);

  log.info('Engineering AI initialized', {
    provider: process.env.NEUROPAUSE_LLM_PROVIDER ?? 'claude',
  });
  return { handlers, dispose: () => undefined };
}

export function initFounderAIv2(): AiSubsystem & {
  ask: (req: TFounderAskV2Request) => Promise<FounderResponse>;
} {
  const ask = (req: TFounderAskV2Request): Promise<FounderResponse> => {
    const now = req.now ?? new Date().toISOString();
    const entities = unifiedStore.query({ limit: 1_000_000, includeDeleted: false }).items;
    const tl = getEnterpriseTimeline();
    const events = tl ? tl.query({ limit: 2000, order: 'desc' }).entries : [];
    const brief = generateBriefing('morning', { entities, events, now });

    const contextBuilder = createContextBuilder({
      searchSources: {
        entity: unifiedStore.searchBackend,
        graph: graphStore,
        memory: memoryStore,
        // P13A — the authority the memory leg runs under. Same resolver as every
        // other scoped surface; null (cold start / signed out) yields no memory hits.
        memoryScope: activeTenantScope(),
      },
      getBriefing: () => brief,
    });

    return answerFounder(
      {
        buildContext: (r) => contextBuilder.build(r),
        run: (r) => aiEngine.run(r),
        deterministicFindings: (intent) => founderFindingsFromBriefing(brief, intent),
        memory: {
          remember: (i, n) => memoryStore.remember(i, n),
          recall: (q) => memoryStore.recall(q),
          get: (id) => memoryStore.get(id),
          forget: (ids) => memoryStore.forget(ids),
          audit: (e) => memoryAuditLog.record(e),
          now: () => now,
        },
        now: () => now,
      },
      { text: req.text, now, conversationId: randomUUID() },
    );
  };

  const suggest = (req: TFounderSuggestionsRequest): FounderSuggestedQuestion[] => {
    const now = req.now ?? new Date().toISOString();
    const entities = unifiedStore.query({ limit: 1_000_000, includeDeleted: false }).items;
    const tl = getEnterpriseTimeline();
    const events = tl ? tl.query({ limit: 2000, order: 'desc' }).entries : [];
    const brief = generateBriefing('morning', { entities, events, now });
    return deriveFounderSuggestions({ briefing: brief });
  };

  /**
   * P13C ROUND 9 — the sweep sibling. `founder:ask-v2` was registered as an "AI
   * analysis read" and left public, but `answerFounder` runs
   * `captureFounderMemory` on every path, which calls `memoryStore.remember`. A
   * public channel that writes the tenant memory store, beside a v1 sibling
   * (`founder:ask`) that requires `intelligence:read` to answer the same question.
   * See `AI_CHANNEL_AUTHORITY` for the resource/scope/authority derivation.
   */
  const handlers: SecureHandlerDef[] = withAiAuthz([
    {
      channel: IpcChannel.FounderAskV2,
      schema: FounderAskV2Request,
      handler: (p) => ask(p as TFounderAskV2Request),
    },
    {
      channel: IpcChannel.FounderSuggestions,
      schema: FounderSuggestionsRequest,
      handler: (p) => suggest(p as TFounderSuggestionsRequest),
    },
  ]);

  founderLog.info('Founder AI v2 initialized', {
    provider: process.env.NEUROPAUSE_LLM_PROVIDER ?? 'claude',
  });
  return { handlers, dispose: () => undefined, ask };
}
