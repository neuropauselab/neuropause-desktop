/**
 * Phase 6 Stage 7 — matrix + impact tests: every cell cites its edge source,
 * the matrix is structurally computed-only, relations come only from real
 * feeds (absent feeds surface as unavailable), and the enhancement-#3 impact
 * analysis reaches decisions/workflows/policies/connectors/intelligence.
 */
import { describe, expect, it } from 'vitest';
import type { ExecutiveDecision, MemoryItem, UnifiedEntity } from '@neuropause/shared';
import { buildInventory, buildReferenceIndex, type InventoryInput } from './assetInventory';
import { analyzeImpact, buildMatrix, type MatrixInput } from './relationshipMatrix';

const NOW = Date.parse('2026-07-31T12:00:00.000Z');
const NOW_ISO = '2026-07-31T12:00:00.000Z';

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
    expectedOutcome: 'Stable deploys',
    owner: 'Ava Chen',
    priority: 'high',
    status: 'accepted',
    createdAt: '2026-07-01T10:00:00.000Z',
    updatedAt: '2026-07-20T10:00:00.000Z',
    history: [
      { at: '2026-07-01T10:00:00.000Z', actor: 'system', kind: 'created', newState: 'suggested' },
      { at: '2026-07-02T10:00:00.000Z', actor: 'ceo', kind: 'status_changed', previousState: 'suggested', newState: 'accepted' },
    ],
  };
}

function docFix(): UnifiedEntity {
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
  };
}

function memFix(): MemoryItem {
  return {
    id: 'mem-1',
    kind: 'note',
    origin: 'explicit',
    title: 'Architecture note',
    content: 'Mesh rationale.',
    connectorId: null,
    source: 'manual',
    entityRefs: ['doc-1'],
    tags: ['architecture'],
    occurredAt: null,
    createdAt: '2026-07-10T10:00:00.000Z',
    updatedAt: '2026-07-10T10:00:00.000Z',
    evidence: { kind: 'document', id: 'doc-1' },
    metadata: {},
  };
}

function inventoryInput(): InventoryInput {
  return {
    nowMs: NOW,
    decisions: [decisionFix()],
    chains: [
      {
        id: 'chain-1',
        orgId: 'org-1',
        name: 'Side-effect approval',
        description: 'approval chain',
        appliesTo: 'workforce_side_effect',
        steps: [{ id: 'st1', name: 'Manager', roleId: 'r1', order: 1 }],
        enabled: true,
        createdAt: '2026-05-01T10:00:00.000Z',
        updatedAt: '2026-07-01T10:00:00.000Z',
      },
    ],
    rules: null,
    prompts: null,
    documents: [docFix()],
    memories: [memFix()],
    connectors: [
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
    org: {
      org: { id: 'org-1', name: 'Neuropause' },
      units: [{ id: 'u1', name: 'Engineering', leadUserId: null }],
      users: [{ id: 'user-ava', name: 'Ava Chen', unitId: 'u1' }],
    },
    jobs: [
      { id: 'job-1', skillId: 'weekly-report', status: 'completed', requestedBy: 'Ava', createdAt: '2026-07-20T10:00:00.000Z', finishedAt: null, correlationId: 'job-corr-1' },
    ],
    derived: [{ id: 'insight-report', title: 'Insight report (computed)', generatedAt: NOW_ISO, note: '' }],
    references: buildReferenceIndex({ decisions: [decisionFix()], memories: [memFix()], referenceEdges: null }),
    failures: {},
  };
}

function matrixInput(over: Partial<MatrixInput> = {}): MatrixInput {
  const inv = buildInventory(inventoryInput());
  return {
    assets: inv.assets,
    graphEdges: [
      {
        type: 'references',
        fromSourceId: 'doc-1',
        toSourceId: 'dec:1',
        fromLabel: 'Deployment Policy',
        toLabel: 'Adopt service mesh architecture',
        at: '2026-07-21T10:00:00.000Z',
        evidenceId: 'doc-1',
      },
    ],
    approvalEvents: [{ id: 'evt-appr-1', correlationId: 'job-corr-1', at: '2026-07-20T10:01:00.000Z' }],
    jobs: [{ id: 'job-1', skillId: 'weekly-report', correlationId: 'job-corr-1' }],
    insightRecommendations: [{ id: 'reco:9', title: 'Fix connector sync', evidence: ['doc-1'] }],
    orgUserNames: ['Ava Chen'],
    failures: {},
    ...over,
  };
}

describe('the relationship matrix (computed, never persisted)', () => {
  it('every cell names its edge source and the matrix is structurally computed-only', () => {
    const { matrix } = buildMatrix(matrixInput(), NOW_ISO);
    expect(matrix.computedOnly).toBe(true);
    expect(matrix.cells.length).toBeGreaterThan(0);
    for (const cell of matrix.cells) {
      expect(cell.edgeSource.length).toBeGreaterThan(0);
      expect(cell.count).toBeGreaterThan(0);
    }
    expect(matrix.totalRelations).toBe(matrix.cells.reduce((s, c) => s + c.count, 0));
  });

  it('relations come from the real mechanisms: decision evidence, memory refs, graph edges, approval joins, insight evidence, provenance, ownership', () => {
    const { matrix } = buildMatrix(matrixInput(), NOW_ISO);
    const sources = matrix.edgeSources.join(' | ');
    expect(sources).toContain('decision evidence[] reference');
    expect(sources).toContain('memory entityRef/evidence reference');
    expect(sources).toContain("graph 'references' edge");
    expect(sources).toContain('approval.granted correlation join');
    expect(sources).toContain('insight recommendation evidence');
    expect(sources).toContain('connector sync provenance');
    expect(sources).toContain('owner resolves to an org-chart member');
  });

  it('an absent graph feed surfaces as unavailable — relations are never invented', () => {
    const { matrix } = buildMatrix(matrixInput({ graphEdges: null }), NOW_ISO);
    expect(matrix.unavailable.some((u) => u.system === 'graph')).toBe(true);
    expect(matrix.edgeSources.join(' ')).not.toContain('graph');
  });

  it('graph edges between records with no backing asset are dropped, not fabricated into cells', () => {
    const { matrix } = buildMatrix(
      matrixInput({
        graphEdges: [
          { type: 'references', fromSourceId: 'ghost-1', toSourceId: 'ghost-2', fromLabel: 'g1', toLabel: 'g2', at: null, evidenceId: null },
        ],
      }),
      NOW_ISO,
    );
    expect(matrix.edgeSources.join(' ')).not.toContain('graph');
  });
});

describe('enhancement #3 — impact analysis', () => {
  it('computes decision/document/memory/connector/intelligence/workflow/policy reach for one asset', () => {
    const build = buildMatrix(matrixInput(), NOW_ISO);
    const impact = analyzeImpact('doc-1', build, matrixInput().insightRecommendations);
    expect(impact.found).toBe(true);
    const kinds = impact.entries.map((e) => e.kind);
    expect(kinds).toContain('decision'); // via decision evidence + graph edge
    expect(kinds).toContain('memory'); // mem-1 references doc-1
    expect(kinds).toContain('connector'); // synced through notion
    expect(kinds).toContain('intelligence'); // reco:9 cites doc-1
    for (const e of impact.entries) {
      expect(e.via.length).toBeGreaterThan(0);
      expect(e.evidence.length).toBeGreaterThan(0);
    }
    expect(impact.byKind.reduce((s, k) => s + k.count, 0)).toBe(impact.entries.length);
  });

  it('workflow ↔ governance approval joins appear in impact from the correlation feed', () => {
    const build = buildMatrix(matrixInput(), NOW_ISO);
    const impact = analyzeImpact('wf:weekly-report', build, null);
    expect(impact.found).toBe(true);
    expect(impact.entries.some((e) => e.kind === 'policy' && e.via === 'approval.granted correlation join')).toBe(true);
  });

  it('an unknown reference is honest: found=false, nothing invented', () => {
    const build = buildMatrix(matrixInput(), NOW_ISO);
    const impact = analyzeImpact('nope:404', build, null);
    expect(impact.found).toBe(false);
    expect(impact.entries).toEqual([]);
    expect(impact.note).toMatch(/nothing is invented/);
  });
});
