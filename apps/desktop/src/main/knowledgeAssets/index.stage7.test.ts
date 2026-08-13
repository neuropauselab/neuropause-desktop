/**
 * Phase 6 Stage 7 — the knowledge composition root, exercised Electron-free
 * through injected ports: the six read-only kb:* handlers (every one
 * requireAuth + knowledge:read — the completeness-lock justification), the 3 s
 * TTL cache, per-source unavailable isolation, the hygiene source producing
 * governed ITEMS only (no actions, deduped), the assistant question port, the
 * search-lens join on kb:inventory, impact analysis via kb:impact, and the
 * structural no-mutation guarantee.
 */
import { describe, expect, it } from 'vitest';
import type {
  DecisionLineage,
  ExecutiveDecision,
  IntelligenceItem,
  IntelligenceSource,
  KnowledgeAssetDashboard,
  KnowledgeImpactAnalysis,
  KnowledgeInventory,
  KnowledgeQualityReport,
  KnowledgeRelationshipMatrix,
  MemoryItem,
  StandardsReport,
  UnifiedEntity,
} from '@neuropause/shared';
import { IpcChannel } from '@neuropause/shared';
import { initKnowledgeAssets, type KnowledgeAssetsDeps } from './index';

/**
 * P13C ROUND 5 — the composed cache is tenant-keyed, so these suites name a
 * tenant. Every existing TTL and memoization assertion keeps its meaning:
 * repeated reads under ONE tenant must still be a single composition.
 */
const PLATFORM_SCOPE = { tenantId: 'org-test', workspaceId: 'ws-test' };
const scope = (): typeof PLATFORM_SCOPE => PLATFORM_SCOPE;

const T0 = Date.parse('2026-07-31T12:00:00.000Z');

function decisionFix(): ExecutiveDecision {
  return {
    id: 'dec:1',
    title: 'Adopt service mesh architecture',
    category: 'engineering',
    description: 'Adopt a mesh',
    reasoning: 'Latency',
    evidence: ['doc-1'],
    sourceSystems: ['github'],
    confidence: 0.8,
    businessImpact: 'High',
    expectedOutcome: 'Stability',
    owner: 'Ava Chen',
    priority: 'high',
    status: 'accepted',
    createdAt: '2026-07-01T10:00:00.000Z',
    updatedAt: '2026-07-20T10:00:00.000Z',
    fromRecommendationId: 'reco:9',
    history: [
      { at: '2026-07-01T10:00:00.000Z', actor: 'system', kind: 'created', newState: 'suggested' },
      { at: '2026-07-02T10:00:00.000Z', actor: 'ceo', kind: 'status_changed', previousState: 'suggested', newState: 'accepted' },
    ],
  };
}

function docFix(over: Partial<UnifiedEntity> = {}): UnifiedEntity {
  return {
    id: 'doc-1',
    kind: 'document',
    connectorId: 'notion',
    accountId: 'a1',
    sourceId: 's1',
    createdAt: '2026-06-01T10:00:00.000Z',
    updatedAt: '2024-01-01T10:00:00.000Z', // stale → hygiene material
    syncState: 'active',
    syncedAt: '2026-07-25T10:05:00.000Z',
    metadata: {},
    title: 'Deployment Policy',
    url: null,
    parentId: null,
    containerId: null,
    body: 'How we deploy.',
    status: null,
    author: 'Ava Chen',
    timestamp: null,
    endTimestamp: null,
    labels: ['approved'],
    ...over,
  };
}

function memFix(): MemoryItem {
  return {
    id: 'mem-1',
    kind: 'note',
    origin: 'explicit',
    title: 'Mesh rationale',
    content: 'Why mesh.',
    connectorId: null,
    source: 'manual',
    entityRefs: ['doc-1'],
    tags: [],
    occurredAt: null,
    createdAt: '2026-07-10T10:00:00.000Z',
    updatedAt: '2026-07-10T10:00:00.000Z',
    evidence: { kind: 'document', id: 'doc-1' },
    metadata: {},
  };
}

interface Harness {
  deps: KnowledgeAssetsDeps;
  registered: IntelligenceSource[];
  state: { nowMs: number; decisionsThrow: boolean; entityReads: number };
}

function mkHarness(): Harness {
  const registered: IntelligenceSource[] = [];
  const state: Harness['state'] = { nowMs: T0, decisionsThrow: false, entityReads: 0 };
  const deps: KnowledgeAssetsDeps = {
  scope,
    decisions: () => {
      if (state.decisionsThrow) throw new Error('decision store exploded');
      return [decisionFix()];
    },
    chains: () => [
      {
        id: 'chain-1',
        orgId: 'org-1',
        name: 'Side-effect approval',
        description: 'chain',
        appliesTo: 'workforce_side_effect',
        steps: [{ id: 's1', name: 'Manager', roleId: 'r1', order: 1 }],
        enabled: true,
        createdAt: '2026-05-01T10:00:00.000Z',
        updatedAt: '2026-07-01T10:00:00.000Z',
      },
    ],
    rules: () => [],
    prompts: () => [{ id: 'system.base', version: 1, label: 'System Prompt' }],
    entities: () => {
      state.entityReads += 1;
      return [docFix()];
    },
    // three real referrers to doc-1 (dec:1 evidence + two memories) → the
    // criticality reference-bump makes the stale policy a HIGH outdated finding,
    // which is exactly what the hygiene source is expected to deliver.
    memories: () => [memFix(), { ...memFix(), id: 'mem-2', title: 'Deploy window note' }],
    connectors: () => [
      {
        id: 'notion',
        name: 'Notion',
        provider: 'Notion',
        description: 'Docs',
        docsUrl: '',
        version: '1.0.0',
        configured: true,
        accounts: [{ id: 'a1' }],
        lastSyncAt: null,
      },
    ],
    org: () => ({
      org: { id: 'org-1', name: 'Neuropause' },
      units: [{ id: 'u1', name: 'Engineering', leadUserId: 'user-ava' }],
      users: [{ id: 'user-ava', name: 'Ava Chen', unitId: 'u1' }],
    }),
    jobs: () => [
      { id: 'job-1', skillId: 'weekly-report', status: 'completed', requestedBy: 'Ava Chen', createdAt: '2026-07-20T10:00:00.000Z', finishedAt: null, correlationId: 'wfrun-1' },
    ],
    conversations: () => [{ id: 'conv-1', title: 'Mesh rollout planning', updatedAt: '2026-07-05T10:00:00.000Z' }],
    executions: () => [],
    getEvents: () => [
      { id: 'evt-1', type: 'approval.granted', timestamp: '2026-07-02T10:00:30.000Z', correlationId: 'wfrun-1' },
    ],
    graphEdgesFor: () => [],
    graphDiscussedIn: () => [],
    graphHistoryFor: () => [],
    insightRecommendations: () => [{ id: 'reco:9', title: 'Fix sync', evidence: ['doc-1'] }],
    fabricGeneratedAt: () => '2026-07-31T11:00:00.000Z',
    search: (text) => [
      { source: 'entity', id: 'doc-1', kind: 'document', title: `Deployment Policy (${text})`, snippet: null, score: 0.9 },
    ],
    registerSource: (s) => registered.push(s),
    now: () => state.nowMs,
  };
  return { deps, registered, state };
}

function handlerFor(sub: ReturnType<typeof initKnowledgeAssets>, channel: string) {
  const def = sub.handlers.find((h) => h.channel === channel);
  if (!def) throw new Error(`missing handler ${channel}`);
  return def;
}

describe('the seven read-only kb:* handlers', () => {
  it('exposes exactly the seven approved channels, every one requireAuth + knowledge:read', () => {
    const sub = initKnowledgeAssets(mkHarness().deps);
    expect(sub.handlers.map((h) => h.channel).sort()).toEqual(
      [
        IpcChannel.KbDashboard,
        IpcChannel.KbImpact,
        IpcChannel.KbInventory,
        IpcChannel.KbLineage,
        IpcChannel.KbMatrix,
        IpcChannel.KbQuality,
        IpcChannel.KbStandards,
      ].sort(),
    );
    for (const h of sub.handlers) {
      expect(h.requireAuth).toBe(true);
      expect(h.permission).toBe('knowledge:read');
    }
  });

  it('kb:inventory returns the classified envelopes; the text filter joins the EXISTING search (lens)', () => {
    const sub = initKnowledgeAssets(mkHarness().deps);
    const bare = handlerFor(sub, IpcChannel.KbInventory).handler({}) as KnowledgeInventory & { hits: unknown };
    expect(bare.totals.assets).toBeGreaterThanOrEqual(7);
    expect(bare.hits).toBeNull();
    const filtered = handlerFor(sub, IpcChannel.KbInventory).handler({ classId: 'governed-document' }) as KnowledgeInventory;
    expect(filtered.assets.every((a) => a.classId === 'governed-document')).toBe(true);
    const searched = handlerFor(sub, IpcChannel.KbInventory).handler({ text: 'deployment' }) as KnowledgeInventory & {
      hits: { id: string; asset: { classId: string } | null }[];
    };
    expect(searched.hits).toHaveLength(1);
    expect(searched.hits[0].asset?.classId).toBe('governed-document');
  });

  it('kb:matrix returns the computed-only matrix; kb:impact returns the impact analysis (enhancement #3)', () => {
    const sub = initKnowledgeAssets(mkHarness().deps);
    const matrix = handlerFor(sub, IpcChannel.KbMatrix).handler({}) as KnowledgeRelationshipMatrix;
    expect(matrix.computedOnly).toBe(true);
    expect(matrix.totalRelations).toBeGreaterThan(0);
    const impact = handlerFor(sub, IpcChannel.KbImpact).handler({ assetId: 'doc-1' }) as KnowledgeImpactAnalysis;
    expect(impact.found).toBe(true);
    expect(impact.entries.some((e) => e.kind === 'decision')).toBe(true);
    expect(impact.entries.some((e) => e.kind === 'intelligence')).toBe(true);
  });

  it('kb:lineage composes the decision chain; kb:quality/kb:standards/kb:dashboard return the composed reports', () => {
    const sub = initKnowledgeAssets(mkHarness().deps);
    const lin = handlerFor(sub, IpcChannel.KbLineage).handler({ decisionId: 'dec:1' }) as { lineages: DecisionLineage[] };
    expect(lin.lineages).toHaveLength(1);
    expect(lin.lineages[0].found).toBe(true);
    expect(lin.lineages[0].stages.find((s) => s.stage === 'approval')?.present).toBe(true);
    const q = handlerFor(sub, IpcChannel.KbQuality).handler({}) as KnowledgeQualityReport;
    expect(q.dimensions).toHaveLength(9);
    const s = handlerFor(sub, IpcChannel.KbStandards).handler({}) as StandardsReport;
    expect(s.totalDomains).toBe(8);
    const d = handlerFor(sub, IpcChannel.KbDashboard).handler({}) as KnowledgeAssetDashboard;
    expect(d.inventory.total).toBeGreaterThan(0);
    expect(d.coverage.domains).toHaveLength(8);
  });

  it('caches for ~3 s and rebuilds after the TTL', () => {
    const h = mkHarness();
    const sub = initKnowledgeAssets(h.deps);
    sub.inventory();
    sub.inventory();
    expect(h.state.entityReads).toBe(1);
    h.state.nowMs = T0 + 3_100;
    sub.inventory();
    expect(h.state.entityReads).toBe(2);
  });

  it('per-source isolation: a throwing decision store surfaces as unavailable + gap; the rest still composes', () => {
    const h = mkHarness();
    h.state.decisionsThrow = true;
    const sub = initKnowledgeAssets(h.deps);
    const inv = sub.inventory();
    expect(inv.unavailable.some((u) => u.system === 'decisions' && u.reason.includes('exploded'))).toBe(true);
    expect(inv.gaps.some((g) => g.classId === 'executive-decision')).toBe(true);
    expect(inv.assets.some((a) => a.classId === 'governance-policy')).toBe(true);
  });
});

describe('the hygiene source (governed items only) + the assistant port', () => {
  it('registers exactly one daily source that produces governed recommendation ITEMS, deduped across runs', async () => {
    const h = mkHarness();
    initKnowledgeAssets(h.deps);
    expect(h.registered).toHaveLength(1);
    const src = h.registered[0];
    expect(src.key).toBe('knowledge-hygiene');
    expect(src.cadence).toEqual({ kind: 'daily', atMinutes: 9 * 60 });
    const items = (await src.produce()) as IntelligenceItem[];
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.deepLink).toBe('knowledge');
      expect(item.governance?.evidence.length).toBeGreaterThan(0);
      expect(item.governance?.recommendedAction.length).toBeGreaterThan(0);
      expect(item.governance?.confidence).toBeGreaterThan(0);
    }
    const again = (await src.produce()) as IntelligenceItem[];
    expect(again).toEqual([]); // deduped — no re-delivery of the same finding
  });

  it('the answerQuestion port resolves knowledge questions and returns null for everything else', () => {
    const sub = initKnowledgeAssets(mkHarness().deps);
    const r = sub.answerQuestion('What is our deployment policy?', '2026-07-31T12:00:00.000Z');
    expect(r?.kind).toBe('intelligence');
    expect(r?.sections[0].lines.join(' ')).toContain('Deployment Policy');
    expect(sub.answerQuestion('summarize my day', '2026-07-31T12:00:00.000Z')).toBeNull();
  });

  it('structural no-mutation: the subsystem exposes no setter/executor and its handlers accept no action fields', () => {
    const sub = initKnowledgeAssets(mkHarness().deps);
    for (const key of Object.keys(sub)) {
      expect(key).not.toMatch(/^(set|apply|transition|execute|update|write|delete)/i);
    }
  });
});
