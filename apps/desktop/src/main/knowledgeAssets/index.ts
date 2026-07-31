/**
 * Phase 6 Stage 7 — the Enterprise Knowledge & Decision Platform composition
 * root.
 *
 * ONE new subsystem that CLASSIFIES and COMPOSES what already exists — it owns
 * no store, no graph, no search engine, no lifecycle executor, and no event
 * vocabulary of its own:
 *
 *   - builds the Knowledge Asset Inventory (7.1/7.2 + enhancement #1) from the
 *     existing decision/governance/prompt/document/memory/connector/org/job
 *     stores, per-source isolated,
 *   - computes the Knowledge Relationship Matrix + Impact Analysis
 *     (enhancement #3) from existing edges — runtime only, persisted nowhere,
 *   - composes Decision Lineage (7.3), Quality (7.5), Standards (7.6 via the
 *     enhancement-#4 authority precedence), and the Coverage Map
 *     (enhancement #2),
 *   - exposes SIX read-only `kb:*` IPC channels (RBAC `knowledge:read`, the
 *     P16 fabric precedent) with a 3 s TTL cache — nothing accepts an action,
 *   - registers ONE delivery-engine source (`knowledge-hygiene`, daily) that
 *     produces governed recommendation ITEMS through the existing gates,
 *   - answers the ten knowledge questions for the assistant (in-process port;
 *     D-8: the answers ride the existing 'intelligence' structured-report kind).
 *
 * Electron-free by construction: every read is an injected port; a failing
 * port becomes an explicit unavailable entry, never a fabricated value.
 */
import {
  EmptyRequest,
  IpcChannel,
  KbInventoryRequest,
  KbLineageRequest,
  KbMatrixRequest,
  type ApprovalChain,
  type AssistantStructuredReport,
  type ComplianceRule,
  type DecisionLineage,
  type ExecutiveDecision,
  type IntelligenceItem,
  type IntelligenceSource,
  type KnowledgeAssetDashboard,
  type KnowledgeInventory,
  type KnowledgeQualityReport,
  type KnowledgeRecommendation,
  type KnowledgeSearchHit,
  type MemoryItem,
  type StandardsReport,
  type UnifiedEntity,
  type KbInventoryRequest as TKbInventoryRequest,
  type KbLineageRequest as TKbLineageRequest,
  type KbMatrixRequest as TKbMatrixRequest,
} from '@neuropause/shared';
import { createLogger } from '../logger';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import {
  buildInventory,
  buildReferenceIndex,
  type ConnectorLite,
  type JobLite,
  type OrgLite,
  type PromptRef,
} from './assetInventory';
import {
  analyzeImpact,
  buildMatrix,
  type GraphEdgeFeed,
  type InsightRecoFeed,
  type MatrixBuild,
} from './relationshipMatrix';
import { composeDecisionLineage } from './decisionLineage';
import { buildQualityReport } from './quality';
import { composeStandards } from './standards';
import { buildCoverageMap } from './coverageMap';
import {
  answerKnowledgeQuestion,
  composeKnowledgeDashboard,
  composeKnowledgeRecommendations,
  knowledgeSearchLens,
  resolveKnowledgeQuestion,
  type KnowledgeQuestionContext,
} from './knowledgeModel';

const log = createLogger('knowledge-assets');

const BUILD_TTL_MS = 3_000;
const TIMELINE_READ_LIMIT = 5_000;
const TIMELINE_WINDOW_MS = 7 * 86_400_000;
const LINEAGE_DASHBOARD_CAP = 100;

/* ── deps (every read injected; sync reads only) ──────────────────────────── */

export interface TimelineEventLite {
  id: string;
  type: string;
  timestamp: string;
  correlationId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface KnowledgeAssetsDeps {
  decisions: () => ExecutiveDecision[];
  chains: () => ApprovalChain[];
  rules: () => ComplianceRule[];
  prompts: () => PromptRef[];
  entities: () => UnifiedEntity[];
  memories: () => MemoryItem[];
  connectors: () => ConnectorLite[];
  org: () => OrgLite | null;
  jobs: () => JobLite[];
  /** Late-bound (assistant initializes after this subsystem); null until wired. */
  conversations: () => { id: string; title: string; updatedAt: string }[] | null;
  executions: () => { label: string; state: string; startedAt: string }[];
  /** Timeline read (the same port shape the insight layer uses). */
  getEvents: (sinceIso: string, limit: number) => TimelineEventLite[];
  /** Graph edges among the given record ids (the EXISTING GraphStore neighbors — no new traversal). */
  graphEdgesFor: (recordIds: string[]) => GraphEdgeFeed[];
  /** Graph 'discussed_in' neighbors of one record's node. */
  graphDiscussedIn: (recordId: string) => { id: string; label: string; at: string | null }[];
  /** Relationship-history entries for the given records (existing GraphStore.historyFor). */
  graphHistoryFor: (recordIds: string[]) => { at: string; action: string; label: string }[];
  /** The Stage 6 insight recommendations (evidence-cited), for impact + derived assets. */
  insightRecommendations: () => InsightRecoFeed[] | null;
  /** The P16 fabric overview timestamp (derived-intelligence asset), or null. */
  fabricGeneratedAt: () => string | null;
  /** The EXISTING federated search (7.7 lens joins over its result; no engine here). */
  search: (text: string) => { source: string; id: string; kind: string; title: string; snippet: string | null; score: number }[];
  /** Register a delivery-engine source (the EXISTING engine; idempotent by key). */
  registerSource: (source: IntelligenceSource) => void;
  now?: () => number;
}

export interface KnowledgeAssetsSubsystem {
  handlers: SecureHandlerDef[];
  inventory: () => KnowledgeInventory;
  dashboard: () => KnowledgeAssetDashboard;
  lineage: (decisionId: string) => DecisionLineage;
  /** Assistant port: answer one of the ten knowledge questions, or null if unmatched. */
  answerQuestion: (text: string, nowIso: string) => AssistantStructuredReport | null;
  dispose: () => void;
}

interface BuildArtifacts {
  at: number;
  nowIso: string;
  inventory: KnowledgeInventory;
  matrixBuild: MatrixBuild;
  standards: StandardsReport;
  quality: KnowledgeQualityReport;
  recommendations: KnowledgeRecommendation[];
  dashboard: KnowledgeAssetDashboard;
  decisions: ExecutiveDecision[];
  connectors: ConnectorLite[];
  conversations: { id: string; title: string; updatedAt: string }[] | null;
  approvalEvents: { id: string; correlationId: string | null; at: string }[];
  verifiedEvents: { id: string; recommendationId: string | null; at: string }[];
  insightRecos: InsightRecoFeed[] | null;
}

function safeRead<T>(system: string, fn: () => T, failures: Record<string, string>): T | null {
  try {
    return fn();
  } catch (err) {
    failures[system] = err instanceof Error ? err.message : String(err);
    return null;
  }
}

export function initKnowledgeAssets(deps: KnowledgeAssetsDeps): KnowledgeAssetsSubsystem {
  const now = deps.now ?? ((): number => Date.now());
  let cache: BuildArtifacts | null = null;

  const build = (): BuildArtifacts => {
    const nowMs = now();
    if (cache && nowMs - cache.at < BUILD_TTL_MS) return cache;
    const nowIso = new Date(nowMs).toISOString();
    const failures: Record<string, string> = {};

    /* ── 1. isolated raw reads ──────────────────────────────────────────── */
    const decisions = safeRead('decisions', deps.decisions, failures);
    const chains = safeRead('governance', deps.chains, failures);
    const rules = safeRead('governance', deps.rules, failures);
    const prompts = safeRead('prompts', deps.prompts, failures);
    const entities = safeRead('documents', deps.entities, failures);
    const memories = safeRead('memories', deps.memories, failures);
    const connectors = safeRead('connectors', deps.connectors, failures);
    const org = safeRead('organization', deps.org, failures);
    const jobs = safeRead('workflows', deps.jobs, failures);
    const conversations = safeRead('conversations', deps.conversations, failures);
    const executionsRead = safeRead('executions', deps.executions, failures);
    const insightRecos = safeRead('insight', deps.insightRecommendations, failures);
    const fabricAt = safeRead('fabric', deps.fabricGeneratedAt, failures);
    const events =
      safeRead(
        'timeline',
        () => deps.getEvents(new Date(nowMs - TIMELINE_WINDOW_MS).toISOString(), TIMELINE_READ_LIMIT),
        failures,
      ) ?? [];

    const documents = entities ? entities.filter((e) => e.kind === 'document' || e.kind === 'file') : null;
    const explicitMemories = memories ? memories.filter((m) => m.origin === 'explicit') : null;

    /* derived-intelligence assets — only for reports that actually computed */
    const derived: { id: string; title: string; generatedAt: string | null; note: string }[] = [];
    if (insightRecos !== null) {
      derived.push({ id: 'insight-report', title: 'Enterprise intelligence report (computed)', generatedAt: nowIso, note: 'stage 6 insight layer' });
    }
    if (fabricAt !== null) {
      derived.push({ id: 'fabric-overview', title: 'Knowledge fabric overview (computed)', generatedAt: fabricAt, note: 'P16 knowledge fabric' });
    }

    /* ── 2. the reference index (real referrers only) ───────────────────── */
    const referenceEdgeFeed = safeRead(
      'graph',
      () => {
        const ids: string[] = [];
        for (const d of documents ?? []) ids.push(d.id);
        for (const d of decisions ?? []) ids.push(d.id);
        return deps.graphEdgesFor(ids);
      },
      failures,
    );
    const references = buildReferenceIndex({
      decisions,
      memories: explicitMemories,
      referenceEdges:
        referenceEdgeFeed
          ?.filter((e) => e.type === 'references')
          .map((e) => ({ fromSourceId: e.fromSourceId, toSourceId: e.toSourceId, at: e.at })) ?? null,
    });

    /* ── 3. the inventory (enhancement #1 envelopes) ────────────────────── */
    const inventory = buildInventory({
      nowMs,
      decisions,
      chains,
      rules,
      prompts,
      documents,
      memories: explicitMemories,
      connectors,
      org,
      jobs,
      derived,
      references,
      failures,
    });

    /* ── 4. the matrix (+ impact substrate, enhancement #3) ─────────────── */
    const approvalEvents = events
      .filter((e) => e.type === 'approval.granted')
      .map((e) => ({ id: e.id, correlationId: e.correlationId ?? null, at: e.timestamp }));
    const verifiedEvents = events
      .filter((e) => e.type === 'insight.outcome_verified')
      .map((e) => ({
        id: e.id,
        recommendationId:
          e.metadata && typeof e.metadata['recommendationId'] === 'string'
            ? (e.metadata['recommendationId'] as string)
            : null,
        at: e.timestamp,
      }));
    const matrixBuild = buildMatrix(
      {
        assets: inventory.assets,
        graphEdges: referenceEdgeFeed,
        approvalEvents,
        jobs: jobs ? jobs.map((j) => ({ id: j.id, skillId: j.skillId, correlationId: j.correlationId })) : null,
        insightRecommendations: insightRecos,
        orgUserNames: org ? org.users.map((u) => u.name) : null,
        failures,
      },
      nowIso,
    );

    /* ── 5. standards (enhancement #4 resolution) → quality → coverage ──── */
    const standards = composeStandards(inventory.assets, nowIso);

    const knownIds = new Set<string>();
    for (const e of entities ?? []) knownIds.add(e.id);
    for (const m of memories ?? []) knownIds.add(m.id);
    for (const d of decisions ?? []) knownIds.add(d.id);
    for (const j of jobs ?? []) knownIds.add(j.id);
    for (const c of connectors ?? []) knownIds.add(c.id);
    for (const a of inventory.assets) knownIds.add(a.recordId);
    const quality = buildQualityReport({
      assets: inventory.assets,
      standards,
      knownIds: entities || memories || decisions ? knownIds : null,
      nowIso,
      unavailable: inventory.unavailable,
    });

    const coverage = buildCoverageMap(inventory.assets, standards, org, nowIso);
    const recommendations = composeKnowledgeRecommendations(quality);

    /* ── 6. lineage-ready count (bounded) + the dashboard ───────────────── */
    const lineageFor = (id: string): DecisionLineage =>
      composeDecisionLineage(id, {
        decision: (decisions ?? []).find((d) => d.id === id) ?? null,
        conversations,
        discussedIn: safeRead('graph', () => deps.graphDiscussedIn(id), {}) ?? null,
        citingMemories:
          explicitMemories
            ?.filter((m) => m.entityRefs.includes(id) || m.evidence?.id === id)
            .map((m) => ({ id: m.id, title: m.title, updatedAt: m.updatedAt })) ?? null,
        approvalEvents,
        executions: executionsRead,
        verifiedEvents,
      });
    let lineageReady = 0;
    for (const d of (decisions ?? []).slice(0, LINEAGE_DASHBOARD_CAP)) {
      const l = lineageFor(d.id);
      if (l.stages.filter((s) => s.present).length >= 3) lineageReady += 1;
    }

    const dashboard = composeKnowledgeDashboard({
      inventory,
      quality,
      standards,
      coverage,
      matrixCells: matrixBuild.matrix.cells.length,
      matrixRelations: matrixBuild.matrix.totalRelations,
      lineageReady,
      recommendations,
      nowIso,
    });

    cache = {
      at: nowMs,
      nowIso,
      inventory,
      matrixBuild,
      standards,
      quality,
      recommendations,
      dashboard,
      decisions: decisions ?? [],
      connectors: connectors ?? [],
      conversations,
      approvalEvents,
      verifiedEvents,
      insightRecos,
    };
    return cache;
  };

  const lineage = (decisionId: string): DecisionLineage => {
    const b = build();
    return composeDecisionLineage(decisionId, {
      decision: b.decisions.find((d) => d.id === decisionId) ?? null,
      conversations: b.conversations,
      discussedIn: safeRead('graph', () => deps.graphDiscussedIn(decisionId), {}) ?? null,
      citingMemories: null, // covered by the matrix; per-call recall stays cheap
      approvalEvents: b.approvalEvents,
      executions: safeRead('executions', deps.executions, {}) ?? null,
      verifiedEvents: b.verifiedEvents,
    });
  };

  /* ── the ten questions (assistant port; D-8: 'intelligence' report kind) ── */
  const answerQuestion = (text: string, nowIso: string): AssistantStructuredReport | null => {
    const key = resolveKnowledgeQuestion(text);
    if (!key) return null;
    const b = build();
    const ctx: KnowledgeQuestionContext = {
      inventory: b.inventory,
      standards: b.standards,
      quality: b.quality,
      matrixBuild: b.matrixBuild,
      decisions: b.decisions,
      connectors: b.connectors,
      conversations: b.conversations,
      graphHistory:
        safeRead(
          'graph',
          () =>
            deps.graphHistoryFor(
              b.inventory.assets.filter((a) => a.domains.length > 0).slice(0, 20).map((a) => a.recordId),
            ),
          {},
        ) ?? null,
      lineageFor: lineage,
      impactFor: (ref) => analyzeImpact(ref, b.matrixBuild, b.insightRecos),
      nowIso,
    };
    return answerKnowledgeQuestion(key, text, ctx);
  };

  /* ── monitoring: ONE governed hygiene source (items only, never actions) ── */
  const deliveredHygiene = new Set<string>();
  const hygieneSource: IntelligenceSource = {
    key: 'knowledge-hygiene',
    label: 'Knowledge Hygiene',
    cadence: { kind: 'daily', atMinutes: 9 * 60 },
    produce: (): IntelligenceItem[] => {
      const b = build();
      const items: IntelligenceItem[] = [];
      for (const r of b.recommendations) {
        if (r.priority !== 'critical' && r.priority !== 'high') continue;
        if (deliveredHygiene.has(r.id)) continue;
        deliveredHygiene.add(r.id);
        items.push({
          id: `kb:${r.id}`,
          title: r.title,
          body: `${r.detail} Suggested: ${r.suggestedAction}`,
          priority: r.priority === 'critical' ? 'critical' : 'high',
          impact: { business: 0.5, urgency: r.priority === 'critical' ? 0.8 : 0.6, confidence: r.confidence },
          deepLink: 'knowledge',
          producedAt: new Date(now()).toISOString(),
          governance: {
            evidence: r.evidence.slice(0, 8),
            sourceSystems: ['knowledge-assets'],
            confidence: r.confidence,
            reasoning: r.detail,
            recommendedAction: r.suggestedAction,
          },
        });
      }
      return items;
    },
  };
  deps.registerSource(hygieneSource);

  /* ── the six read-only IPC channels (D-9; knowledge:read, the P16 precedent) ── */
  const handlers: SecureHandlerDef[] = [
    {
      channel: IpcChannel.KbInventory,
      schema: KbInventoryRequest,
      requireAuth: true,
      permission: 'knowledge:read',
      handler: (p) => {
        const req = p as TKbInventoryRequest;
        const b = build();
        let hits: KnowledgeSearchHit[] | null = null;
        if (req.text && req.text.trim().length > 0) {
          const raw = safeRead('search', () => deps.search(req.text as string), {});
          hits = raw
            ? knowledgeSearchLens(raw, b.inventory, {
                classId: req.classId,
                lifecycle: req.lifecycle,
              })
            : null;
        }
        const assets = b.inventory.assets.filter(
          (a) =>
            (!req.classId || a.classId === req.classId) &&
            (!req.authority || a.authorityRankKey === req.authority) &&
            (!req.lifecycle || (a.lifecycle ?? 'unclassified') === req.lifecycle),
        );
        return { ...b.inventory, assets, hits };
      },
    },
    {
      channel: IpcChannel.KbMatrix,
      schema: KbMatrixRequest,
      requireAuth: true,
      permission: 'knowledge:read',
      handler: (p) => {
        const req = p as TKbMatrixRequest;
        const b = build();
        if (req.assetId) return analyzeImpact(req.assetId, b.matrixBuild, b.insightRecos);
        return b.matrixBuild.matrix;
      },
    },
    {
      channel: IpcChannel.KbLineage,
      schema: KbLineageRequest,
      requireAuth: true,
      permission: 'knowledge:read',
      handler: (p) => {
        const req = p as TKbLineageRequest;
        const b = build();
        if (req.decisionId) return { lineages: [lineage(req.decisionId)] };
        return { lineages: b.decisions.slice(0, 8).map((d) => lineage(d.id)) };
      },
    },
    {
      channel: IpcChannel.KbQuality,
      schema: EmptyRequest,
      requireAuth: true,
      permission: 'knowledge:read',
      handler: () => build().quality,
    },
    {
      channel: IpcChannel.KbStandards,
      schema: EmptyRequest,
      requireAuth: true,
      permission: 'knowledge:read',
      handler: () => build().standards,
    },
    {
      channel: IpcChannel.KbDashboard,
      schema: EmptyRequest,
      requireAuth: true,
      permission: 'knowledge:read',
      handler: () => build().dashboard,
    },
  ];

  log.info('Enterprise Knowledge Platform ready', { channels: handlers.length, sources: 1 });

  return {
    handlers,
    inventory: () => build().inventory,
    dashboard: () => build().dashboard,
    lineage,
    answerQuestion,
    dispose: () => {
      cache = null;
    },
  };
}
