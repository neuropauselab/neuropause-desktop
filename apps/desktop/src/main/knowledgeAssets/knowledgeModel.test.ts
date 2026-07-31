/**
 * Phase 6 Stage 7 — knowledge model tests (7.7/7.8/7.10/7.11): the ten
 * question matchers (disjoint from the Stage 5/6 resolvers), evidence +
 * authority + uncertainty in every answer, honest "not documented" answers,
 * the 8-rule hygiene recommendations, the search lens join, and the dashboard
 * composition.
 */
import { describe, expect, it } from 'vitest';
import type { ExecutiveDecision, KnowledgeQuestionKey, MemoryItem, UnifiedEntity } from '@neuropause/shared';
import { resolveInsightQuestion } from '../insight/insightModel';
import { buildInventory, buildReferenceIndex, type InventoryInput } from './assetInventory';
import { buildMatrix, analyzeImpact } from './relationshipMatrix';
import { composeStandards } from './standards';
import { buildQualityReport } from './quality';
import { buildCoverageMap } from './coverageMap';
import { composeDecisionLineage } from './decisionLineage';
import {
  answerKnowledgeQuestion,
  composeKnowledgeDashboard,
  composeKnowledgeRecommendations,
  knowledgeSearchLens,
  resolveKnowledgeQuestion,
  type KnowledgeQuestionContext,
} from './knowledgeModel';

const NOW = Date.parse('2026-07-31T12:00:00.000Z');
const NOW_ISO = '2026-07-31T12:00:00.000Z';

function decisionFix(over: Partial<ExecutiveDecision> = {}): ExecutiveDecision {
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
    ...over,
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
    updatedAt: '2026-07-25T10:00:00.000Z',
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

function memFix(over: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id: 'mem-1',
    kind: 'note',
    origin: 'explicit',
    title: 'Service mesh architecture rationale',
    content: 'Mesh rationale.',
    connectorId: null,
    source: 'manual',
    entityRefs: ['doc-1', 'dec:1'],
    tags: ['architecture'],
    occurredAt: null,
    createdAt: '2026-07-10T10:00:00.000Z',
    updatedAt: '2026-07-10T10:00:00.000Z',
    evidence: { kind: 'document', id: 'doc-1' },
    metadata: {},
    ...over,
  };
}

function buildContext(over: Partial<InventoryInput> = {}): KnowledgeQuestionContext {
  const invInput: InventoryInput = {
    nowMs: NOW,
    decisions: [decisionFix()],
    chains: null,
    rules: null,
    prompts: [
      { id: 'system.base', version: 2, label: 'System Prompt' },
      { id: 'founder.answer', version: 1, label: 'Founder AI' },
    ],
    documents: [docFix(), docFix({ id: 'doc-sop', title: 'Incident Response SOP', labels: ['sop'], body: 'Steps for incidents.' })],
    memories: [memFix()],
    connectors: [
      {
        id: 'slack',
        name: 'Slack',
        provider: 'Slack',
        description: 'Team messaging and alerts',
        docsUrl: 'https://docs.example/slack',
        version: '2.0.0',
        configured: true,
        accounts: [{ id: 'a1' }],
        lastSyncAt: '2026-07-30T10:00:00.000Z',
      },
    ],
    org: {
      org: { id: 'org-1', name: 'Neuropause' },
      units: [{ id: 'u1', name: 'Engineering', leadUserId: null }],
      users: [{ id: 'user-ava', name: 'Ava Chen', unitId: 'u1' }],
    },
    jobs: [{ id: 'job-1', skillId: 'weekly-report', status: 'completed', requestedBy: 'Ava Chen', createdAt: '2026-07-20T10:00:00.000Z', finishedAt: null, correlationId: null }],
    derived: [{ id: 'insight-report', title: 'Insight report (computed)', generatedAt: NOW_ISO, note: '' }],
    references: buildReferenceIndex({ decisions: [decisionFix()], memories: [memFix()], referenceEdges: null }),
    failures: {},
    ...over,
  };
  const inventory = buildInventory(invInput);
  const matrixBuild = buildMatrix(
    {
      assets: inventory.assets,
      graphEdges: [],
      approvalEvents: [],
      jobs: [],
      insightRecommendations: [{ id: 'reco:9', title: 'Fix sync', evidence: ['doc-1'] }],
      orgUserNames: ['Ava Chen'],
      failures: {},
    },
    NOW_ISO,
  );
  const standards = composeStandards(inventory.assets, NOW_ISO);
  const quality = buildQualityReport({
    assets: inventory.assets,
    standards,
    knownIds: new Set(['doc-1', 'doc-sop', 'dec:1', 'mem-1', 'job-1', 'slack']),
    nowIso: NOW_ISO,
    unavailable: [],
  });
  return {
    inventory,
    standards,
    quality,
    matrixBuild,
    decisions: invInput.decisions ?? [],
    connectors: invInput.connectors ?? [],
    conversations: [{ id: 'conv-1', title: 'Service mesh rollout planning', updatedAt: '2026-07-05T10:00:00.000Z' }],
    graphHistory: [{ at: '2026-07-20T10:00:00.000Z', action: 'added', label: 'references: doc-1 → dec:1' }],
    lineageFor: (id) =>
      composeDecisionLineage(id, {
        decision: (invInput.decisions ?? []).find((d) => d.id === id) ?? null,
        conversations: [{ id: 'conv-1', title: 'Service mesh rollout planning', updatedAt: '2026-07-05T10:00:00.000Z' }],
        discussedIn: null,
        citingMemories: [{ id: 'mem-1', title: 'Rationale', updatedAt: '2026-07-10T10:00:00.000Z' }],
        approvalEvents: [],
        executions: [],
        verifiedEvents: [],
      }),
    impactFor: (ref) => analyzeImpact(ref, matrixBuild, [{ id: 'reco:9', title: 'Fix sync', evidence: ['doc-1'] }]),
    nowIso: NOW_ISO,
  };
}

const MATCH_CASES: [string, KnowledgeQuestionKey][] = [
  ['Why was this architecture chosen?', 'why-architecture'],
  ['What is our deployment policy?', 'deployment-policy'],
  ['Which decision approved this workflow?', 'which-decision-approved'],
  ['Show every discussion related to this project', 'discussions-for-project'],
  ['What is the current company standard?', 'current-standard'],
  ['Which SOP applies to this process?', 'which-sop'],
  ['Why do we use this connector?', 'why-connector'],
  ['Which knowledge is outdated?', 'outdated-knowledge'],
  ['Which documents conflict?', 'conflicting-documents'],
  ['What changed in our engineering standards?', 'standards-changes'],
];

describe('the ten question matchers', () => {
  it('matches every spec question to its key', () => {
    for (const [text, key] of MATCH_CASES) expect(resolveKnowledgeQuestion(text)).toBe(key);
  });

  it('does not match unrelated text or empty input', () => {
    expect(resolveKnowledgeQuestion('summarize my day')).toBeNull();
    expect(resolveKnowledgeQuestion('')).toBeNull();
    expect(resolveKnowledgeQuestion('deploy the app')).toBeNull();
  });

  it('stays disjoint from the Stage 6 insight matchers (no double-claiming)', () => {
    for (const [text] of MATCH_CASES) expect(resolveInsightQuestion(text)).toBeNull();
    // and vice versa: insight questions do not trip knowledge matchers
    expect(resolveKnowledgeQuestion('what changed today')).toBeNull();
    expect(resolveKnowledgeQuestion('which workflows keep failing')).toBeNull();
  });
});

describe('the ten answers — evidence, authority, uncertainty', () => {
  it("every answer is an 'intelligence'-kind report (D-8) with an Answer section", () => {
    const ctx = buildContext();
    for (const [text, key] of MATCH_CASES) {
      const r = answerKnowledgeQuestion(key, text, ctx);
      expect(r.kind).toBe('intelligence');
      expect(r.grounded).toBe(true);
      expect(r.sections[0].title).toBe('Answer');
      expect(r.sections[0].lines.length).toBeGreaterThan(0);
    }
  });

  it('why-architecture cites assets, authority ranks, and declares classification uncertainty', () => {
    const ctx = buildContext();
    const r = answerKnowledgeQuestion('why-architecture', 'Why was this architecture chosen?', ctx);
    const titles = r.sections.map((s) => s.title);
    expect(titles).toContain('Evidence');
    expect(titles).toContain('Authority');
    const authority = r.sections.find((s) => s.title === 'Authority');
    expect(authority?.lines.join(' ')).toMatch(/precedence rank/);
  });

  it('deployment-policy resolves the standard with the precedence method cited', () => {
    const ctx = buildContext();
    const r = answerKnowledgeQuestion('deployment-policy', 'What is our deployment policy?', ctx);
    expect(r.sections[0].lines.join(' ')).toContain('Deployment Policy');
    const authority = r.sections.find((s) => s.title === 'Authority');
    expect(authority?.lines.join(' ')).toContain('authority-precedence → freshness → stable-id');
  });

  it('which-sop finds the SOP-classified document; absence is honestly "not documented"', () => {
    const ctx = buildContext();
    const withSop = answerKnowledgeQuestion('which-sop', 'Which SOP applies to incidents?', ctx);
    expect(withSop.sections[0].lines.join(' ')).toContain('Incident Response SOP');
    const bare = buildContext({ documents: [docFix()] });
    const noSop = answerKnowledgeQuestion('which-sop', 'Which SOP applies to incidents?', bare);
    expect(noSop.sections[0].lines[0]).toMatch(/documentation gap/);
  });

  it('why-connector explains the manifest + citing records, and admits an unrecorded rationale', () => {
    const ctx = buildContext();
    const r = answerKnowledgeQuestion('why-connector', 'Why do we use the Slack connector?', ctx);
    expect(r.title).toBe('Why do we use Slack?');
    expect(r.sections[0].lines.join(' ')).toContain('Team messaging');
    const uncertainty = r.sections.find((s) => s.title === 'Uncertainty');
    expect(uncertainty?.lines.join(' ')).toMatch(/not recorded/);
  });

  it('outdated/conflicting answers ride the quality findings with evidence', () => {
    const ctx = buildContext({
      documents: [
        // equal timestamps → no supersession, but the pair still conflicts (both current)
        docFix({ id: 'doc-a', title: 'Deployment Policy', updatedAt: '2026-07-20T10:00:00.000Z' }),
        docFix({ id: 'doc-b', title: 'Deployment Policy (mirror)', updatedAt: '2026-07-20T10:00:00.000Z' }),
        // a genuinely stale document on a different topic → the outdated finding
        docFix({ id: 'doc-stale', title: 'Legacy Backup SOP', labels: ['sop'], updatedAt: '2024-01-01T10:00:00.000Z' }),
      ],
    });
    const outdated = answerKnowledgeQuestion('outdated-knowledge', 'Which knowledge is outdated?', ctx);
    expect(outdated.sections[0].lines.join(' ')).toMatch(/Outdated|stale/i);
    const conflicts = answerKnowledgeQuestion('conflicting-documents', 'Which documents conflict?', ctx);
    expect(conflicts.sections.find((s) => s.title === 'Evidence')?.lines.length).toBeGreaterThan(0);
  });

  it('an empty corpus answers honestly everywhere instead of inventing', () => {
    const ctx = buildContext({
      decisions: [],
      documents: [],
      memories: [],
      connectors: [],
      jobs: [],
      prompts: [],
      derived: [],
      org: null,
    });
    const r = answerKnowledgeQuestion('why-architecture', 'Why was this architecture chosen?', ctx);
    expect(r.sections[0].lines[0]).toMatch(/Not documented/);
    const std = answerKnowledgeQuestion('current-standard', 'What is the current company standard?', ctx);
    expect(std.sections[0].lines.join(' ')).toMatch(/No standard is defined/);
  });
});

describe('recommendations (7.8), search lens (7.7), dashboard (7.10)', () => {
  it('maps quality findings 1:1 into governed recommendations with evidence/authority/confidence/action', () => {
    const ctx = buildContext();
    const recos = composeKnowledgeRecommendations(ctx.quality);
    expect(recos.length).toBe(ctx.quality.findings.length);
    for (const r of recos) {
      expect(r.evidence.length).toBeGreaterThan(0);
      expect(r.authority.length).toBeGreaterThan(0);
      expect(r.confidence).toBeGreaterThan(0);
      expect(r.suggestedAction.length).toBeGreaterThan(0);
    }
  });

  it('the search lens JOINS existing hits with asset classifications (no engine here)', () => {
    const ctx = buildContext();
    const hits = [
      { source: 'entity', id: 'doc-1', kind: 'document', title: 'Deployment Policy', snippet: null, score: 0.9 },
      { source: 'entity', id: 'not-an-asset', kind: 'task', title: 'Fix bug', snippet: null, score: 0.5 },
    ];
    const joined = knowledgeSearchLens(hits, ctx.inventory);
    expect(joined).toHaveLength(2);
    expect(joined[0].asset?.classId).toBe('governed-document');
    expect(joined[1].asset).toBeNull();
    const filtered = knowledgeSearchLens(hits, ctx.inventory, { classId: 'governed-document' });
    expect(filtered).toHaveLength(1);
    const rankFiltered = knowledgeSearchLens(hits, ctx.inventory, { maxAuthorityRank: 4 });
    expect(rankFiltered.every((h) => h.asset !== null && h.asset.authorityRank <= 4)).toBe(true);
  });

  it('the dashboard composes inventory/quality/standards/coverage/matrix/review-queue without inventing', () => {
    const ctx = buildContext();
    const coverage = buildCoverageMap(ctx.inventory.assets, ctx.standards, null, NOW_ISO);
    const d = composeKnowledgeDashboard({
      inventory: ctx.inventory,
      quality: ctx.quality,
      standards: ctx.standards,
      coverage,
      matrixCells: ctx.matrixBuild.matrix.cells.length,
      matrixRelations: ctx.matrixBuild.matrix.totalRelations,
      lineageReady: 1,
      recommendations: composeKnowledgeRecommendations(ctx.quality),
      nowIso: NOW_ISO,
    });
    expect(d.inventory.total).toBe(ctx.inventory.totals.assets);
    expect(d.quality.dimensions).toHaveLength(9);
    expect(d.standards.total).toBe(8);
    expect(d.matrix.totalRelations).toBe(ctx.matrixBuild.matrix.totalRelations);
    for (const row of d.reviewQueue) {
      expect(row.reason.length).toBeGreaterThan(0);
    }
  });
});
