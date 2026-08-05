/**
 * Phase 6 Stage 7 — inventory classification honesty: declared confidence +
 * signals, per-source isolation, empty classes → gaps (never fabricated),
 * enhancement #1 (criticality reasons, retention from the registry, review
 * owner through the real org chart, provenance only from real records),
 * lifecycle derivation (null = no marker), freshness, supersession, and the
 * reference index.
 */
import { describe, expect, it } from 'vitest';
import type { ExecutiveDecision, MemoryItem, UnifiedEntity } from '@neuropause/shared';
import {
  buildInventory,
  buildReferenceIndex,
  freshnessFor,
  topicOverlap,
  topicTokens,
  type InventoryInput,
  type OrgLite,
} from './assetInventory';

const NOW = Date.parse('2026-07-31T12:00:00.000Z');

function decisionFix(over: Partial<ExecutiveDecision> = {}): ExecutiveDecision {
  return {
    id: 'dec:1',
    title: 'Adopt service mesh architecture',
    category: 'engineering',
    description: 'Adopt a mesh for service-to-service traffic',
    reasoning: 'Latency and reliability',
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
    fromRecommendationId: 'reco:9',
    history: [
      { at: '2026-07-01T10:00:00.000Z', actor: 'system', kind: 'created', newState: 'suggested', reason: 'from reco' },
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
    url: 'https://notion.so/doc-1',
    parentId: null,
    containerId: null,
    body: 'How we deploy to production.',
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
    title: 'Architecture note',
    content: 'We chose the mesh for engineering reliability.',
    connectorId: null,
    source: 'manual',
    entityRefs: ['doc-1'],
    tags: ['architecture'],
    occurredAt: null,
    createdAt: '2026-07-10T10:00:00.000Z',
    updatedAt: '2026-07-10T10:00:00.000Z',
    evidence: { kind: 'document', id: 'doc-1' },
    metadata: { owner: 'Ben Ortiz' },
    ...over,
  };
}

const ORG: OrgLite = {
  org: { id: 'org-1', name: 'Neuropause' },
  units: [{ id: 'u-eng', name: 'Engineering', leadUserId: 'user-lead' }],
  users: [
    { id: 'user-ava', name: 'Ava Chen', unitId: 'u-eng' },
    { id: 'user-lead', name: 'Dana Lead', unitId: 'u-eng' },
  ],
};

function input(over: Partial<InventoryInput> = {}): InventoryInput {
  return {
    nowMs: NOW,
    decisions: [decisionFix()],
    chains: [
      {
        id: 'chain-1',
        orgId: 'org-1',
        name: 'Spend approval',
        description: 'Two-step spend approval',
        appliesTo: 'spend',
        steps: [{ id: 'st1', name: 'Manager', roleId: 'role-1', order: 1 }],
        enabled: true,
        createdAt: '2026-05-01T10:00:00.000Z',
        updatedAt: '2026-07-01T10:00:00.000Z',
      },
    ],
    rules: [
      {
        id: 'rule-1',
        orgId: 'org-1',
        name: 'Audit trail present',
        description: 'Audit must exist',
        category: 'audit',
        severity: 'critical',
        check: 'audit_trail_present',
        enabled: true,
        createdAt: '2026-05-01T10:00:00.000Z',
        updatedAt: '2026-07-01T10:00:00.000Z',
      },
    ],
    prompts: [{ id: 'system.base', version: 2, label: 'System Prompt' }],
    documents: [docFix()],
    memories: [memFix()],
    connectors: [
      {
        id: 'notion',
        name: 'Notion',
        provider: 'Notion',
        description: 'Docs and wikis',
        docsUrl: 'https://docs.example/notion',
        version: '1.2.0',
        configured: true,
        accounts: [{ id: 'a1' }],
        lastSyncAt: '2026-07-30T10:00:00.000Z',
      },
    ],
    org: ORG,
    jobs: [
      { id: 'job-1', skillId: 'weekly-report', status: 'completed', requestedBy: 'Ava Chen', createdAt: '2026-07-20T10:00:00.000Z', finishedAt: '2026-07-20T10:05:00.000Z', correlationId: 'wfrun-1' },
      { id: 'job-2', skillId: 'weekly-report', status: 'completed', requestedBy: 'Ava Chen', createdAt: '2026-07-27T10:00:00.000Z', finishedAt: '2026-07-27T10:04:00.000Z', correlationId: 'wfrun-2' },
    ],
    derived: [{ id: 'insight-report', title: 'Enterprise intelligence report (computed)', generatedAt: '2026-07-31T11:59:00.000Z', note: 'stage 6' }],
    references: buildReferenceIndex({
      decisions: [decisionFix()],
      memories: [memFix()],
      referenceEdges: null,
    }),
    failures: {},
    ...over,
  };
}

describe('classification honesty', () => {
  it('classifies every populated class with declared confidence + real signals', () => {
    const inv = buildInventory(input());
    expect(inv.totals.assets).toBeGreaterThanOrEqual(9);
    for (const a of inv.assets) {
      expect(a.classificationConfidence).toBeGreaterThan(0);
      expect(a.classificationConfidence).toBeLessThanOrEqual(1);
      expect(a.classificationSignals.length).toBeGreaterThan(0);
      expect(a.recordId.length).toBeGreaterThan(0);
      expect(a.id).toBe(`ka:${a.classId}:${a.recordId}`);
    }
    const doc = inv.assets.find((a) => a.classId === 'governed-document');
    expect(doc?.subkind).toBe('policy');
    expect(doc?.classificationConfidence).toBeLessThan(1); // marker-based, declared
    expect(doc?.classificationSignals.join(' ')).toMatch(/title contains/);
  });

  it('documents with NO governed-doc markers are not classified (no fabricated assets)', () => {
    const inv = buildInventory(input({ documents: [docFix({ title: 'Lunch menu', labels: [], body: 'Pizza on Friday' })] }));
    expect(inv.assets.filter((a) => a.classId === 'governed-document')).toHaveLength(0);
    expect(inv.gaps.map((g) => g.classId)).toContain('governed-document');
  });

  it('per-source isolation: a failing source becomes unavailable + a gap; others classify', () => {
    const inv = buildInventory(input({ decisions: null, failures: { decisions: 'store exploded' } }));
    expect(inv.unavailable).toContainEqual({ system: 'decisions', reason: 'store exploded' });
    const gap = inv.gaps.find((g) => g.classId === 'executive-decision');
    expect(gap?.reason).toContain('store exploded');
    expect(inv.assets.filter((a) => a.classId === 'governance-policy')).toHaveLength(1);
  });

  it('the capability-standard boundary is a declared gap, never a fabricated asset', () => {
    const inv = buildInventory(input());
    expect(inv.assets.filter((a) => a.classId === 'capability-standard')).toHaveLength(0);
    const gap = inv.gaps.find((g) => g.classId === 'capability-standard');
    expect(gap?.reason).toMatch(/boundary/);
  });
});

describe('enhancement #1 — ownership, review owner, criticality, retention, provenance', () => {
  it('resolves the review owner through the real org chart (unit lead)', () => {
    const inv = buildInventory(input());
    const dec = inv.assets.find((a) => a.classId === 'executive-decision');
    expect(dec?.owner).toBe('Ava Chen');
    expect(dec?.reviewOwner).toBe('Dana Lead');
    expect(dec?.ownerResolution).toMatch(/unit lead of Engineering/);
  });

  it('unowned stays unowned — a finding path, never a guessed name', () => {
    const inv = buildInventory(input({ documents: [docFix({ author: null })] }));
    const doc = inv.assets.find((a) => a.classId === 'governed-document');
    expect(doc?.owner).toBeNull();
    expect(doc?.reviewOwner).toBeNull();
    expect(doc?.ownerResolution).toMatch(/no author recorded/);
  });

  it('criticality is deterministic with recorded reasons (reference + governance bumps)', () => {
    const inv = buildInventory(input());
    const chain = inv.assets.find((a) => a.classId === 'governance-policy');
    // critical base + approved/org-defined bump stays critical (capped) with reasons recorded.
    expect(chain?.criticality).toBe('critical');
    expect(chain?.criticalityReasons.join(' ')).toMatch(/class base: critical/);
    expect(chain?.criticalityReasons.join(' ')).toMatch(/approved lifecycle/);
    const doc = inv.assets.find((a) => a.classId === 'governed-document');
    expect(doc?.criticalityReasons[0]).toBe('class base: medium');
  });

  it('retention describes the actual backing store', () => {
    const inv = buildInventory(input());
    expect(inv.assets.find((a) => a.classId === 'executive-decision')?.retention.kind).toBe('store-capped');
    expect(inv.assets.find((a) => a.classId === 'ai-prompt')?.retention.kind).toBe('version-permanent');
    expect(inv.assets.find((a) => a.classId === 'governed-document')?.retention.kind).toBe('provider-managed');
  });

  it('provenance stages are backed by real records: created/reviewed/approved from history, referenced from the index', () => {
    const inv = buildInventory(input());
    const dec = inv.assets.find((a) => a.classId === 'executive-decision');
    const stages = dec?.provenance.map((p) => p.stage);
    expect(stages).toContain('created');
    expect(stages).toContain('reviewed');
    expect(stages).toContain('approved');
    const approved = dec?.provenance.find((p) => p.stage === 'approved');
    expect(approved?.evidence[0]).toContain('history:accepted');
    // doc-1 is referenced by dec:1 (evidence) and mem-1 (entityRefs + evidence)
    const doc = inv.assets.find((a) => a.classId === 'governed-document');
    expect(doc?.referencedBy).toBe(2);
    const ref = doc?.provenance.find((p) => p.stage === 'referenced');
    expect(ref?.evidence).toContain('dec:1');
    expect(ref?.evidence).toContain('mem-1');
  });

  it('provider approval markers carry at:null with an honest note (no invented timestamp)', () => {
    const inv = buildInventory(input());
    const doc = inv.assets.find((a) => a.classId === 'governed-document');
    const approved = doc?.provenance.find((p) => p.stage === 'approved');
    expect(approved?.at).toBeNull();
    expect(approved?.note).toMatch(/does not record when/);
  });
});

describe('lifecycle derivation (7.4 — read-only)', () => {
  it('maps decision statuses onto the six states', () => {
    const inv = buildInventory(
      input({ decisions: [decisionFix(), decisionFix({ id: 'dec:2', status: 'rejected', title: 'Retire old queue' })] }),
    );
    expect(inv.assets.find((a) => a.recordId === 'dec:1')?.lifecycle).toBe('approved');
    expect(inv.assets.find((a) => a.recordId === 'dec:2')?.lifecycle).toBe('deprecated');
  });

  it('an unmarked record derives lifecycle null with its basis (honest, not guessed)', () => {
    const inv = buildInventory(input({ documents: [docFix({ labels: ['policy'], title: 'Security Policy' })] }));
    const doc = inv.assets.find((a) => a.classId === 'governed-document');
    expect(doc?.lifecycle).toBeNull();
    expect(doc?.lifecycleBasis).toMatch(/no lifecycle marker/);
  });

  it('an approved document is rank-refined to approved-document (rank 4); unmarked stays provider-document (rank 6)', () => {
    const inv = buildInventory(
      input({
        documents: [
          docFix(),
          docFix({ id: 'doc-2', title: 'Incident SOP', labels: ['sop'], body: 'Steps.' }),
        ],
      }),
    );
    expect(inv.assets.find((a) => a.recordId === 'doc-1')?.authorityRank).toBe(4);
    expect(inv.assets.find((a) => a.recordId === 'doc-2')?.authorityRank).toBe(6);
  });

  it('supersession derives ONLY from a newer same-subkind asset with real topic overlap', () => {
    const inv = buildInventory(
      input({
        documents: [
          docFix({ id: 'doc-old', title: 'Deployment Policy', updatedAt: '2026-05-01T10:00:00.000Z', labels: ['policy', 'approved'] }),
          docFix({ id: 'doc-new', title: 'Deployment Policy v2', updatedAt: '2026-07-28T10:00:00.000Z', labels: ['policy', 'approved'] }),
        ],
      }),
    );
    const old = inv.assets.find((a) => a.recordId === 'doc-old');
    expect(old?.lifecycle).toBe('superseded');
    expect(old?.lifecycleEvidence).toContain('doc-new');
    expect(old?.provenance.some((p) => p.stage === 'superseded' && p.evidence.includes('doc-new'))).toBe(true);
    expect(inv.assets.find((a) => a.recordId === 'doc-new')?.lifecycle).toBe('approved');
  });
});

describe('freshness + helpers', () => {
  it('freshnessFor follows the class staleness window (and null window = always fresh)', () => {
    expect(freshnessFor('2026-07-30T10:00:00.000Z', 180, NOW)).toBe('fresh');
    expect(freshnessFor('2026-03-01T10:00:00.000Z', 180, NOW)).toBe('aging');
    expect(freshnessFor('2025-06-01T10:00:00.000Z', 180, NOW)).toBe('stale');
    expect(freshnessFor(null, 180, NOW)).toBe('unknown');
    expect(freshnessFor(null, null, NOW)).toBe('fresh');
  });

  it('topic tokens + overlap are deterministic', () => {
    const a = topicTokens('Adopt service mesh architecture');
    expect(a).toContain('mesh');
    expect(topicOverlap(a, topicTokens('service mesh adoption architecture'))).toBeGreaterThan(0.4);
    expect(topicOverlap(a, [])).toBe(0);
  });

  it('workflow assets derive from real runs and stay honestly lifecycle-null', () => {
    const inv = buildInventory(input());
    const wf = inv.assets.find((a) => a.classId === 'workflow-definition');
    expect(wf?.recordId).toBe('wf:weekly-report');
    expect(wf?.version).toBe('2 observed run(s)');
    expect(wf?.lifecycle).toBeNull();
    expect(wf?.lifecycleBasis).toMatch(/honest gap/);
    expect(wf?.evidence).toContain('job-1');
  });
});
