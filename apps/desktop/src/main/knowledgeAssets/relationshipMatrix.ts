/**
 * Phase 6 Stage 7 — the Knowledge Relationship Matrix (foundational artifact #2)
 * + enhancement #3 (Knowledge Impact Analysis).
 *
 * COMPUTED AT RUNTIME, PERSISTED NOWHERE. Every relation comes from an edge
 * mechanism that already exists:
 *   - graph edges (references / approved_by / discussed_in / belongs_to /
 *     depends_on / generated_by) between nodes whose sourceIds back assets,
 *   - decision evidence[] → record ids,
 *   - memory entityRefs / evidence → record ids,
 *   - timeline `approval.granted` ↔ workflow-run correlation joins,
 *   - insight recommendation evidence → record ids,
 *   - connector provenance (asset.sourceSystem === connector id),
 *   - org ownership (asset.owner resolves to an org user).
 * Each matrix cell names the mechanism it came from; absent feeds surface in
 * `unavailable`. The module adds NO traversal engine — graph queries stay in
 * the existing GraphStore. Pure; all reads injected.
 */
import type {
  KnowledgeAsset,
  KnowledgeImpactAnalysis,
  KnowledgeImpactEntry,
  KnowledgeImpactKind,
  KnowledgeMatrixCell,
  KnowledgeRelationshipMatrix,
  KnowledgeUnavailable,
} from '@neuropause/shared';

/* ── injected feed shapes (narrow) ────────────────────────────────────────── */

export interface GraphEdgeFeed {
  type: string;
  fromSourceId: string | null;
  toSourceId: string | null;
  fromLabel: string;
  toLabel: string;
  at: string | null;
  /** The UDM record justifying the edge, when recorded. */
  evidenceId: string | null;
}

export interface ApprovalEventFeed {
  id: string;
  correlationId: string | null;
  at: string;
}

export interface InsightRecoFeed {
  id: string;
  title: string;
  evidence: string[];
}

export interface MatrixInput {
  assets: KnowledgeAsset[];
  graphEdges: GraphEdgeFeed[] | null;
  approvalEvents: ApprovalEventFeed[] | null;
  /** Jobs with correlation ids (workflow-run joins). */
  jobs: { id: string; skillId: string; correlationId: string | null }[] | null;
  insightRecommendations: InsightRecoFeed[] | null;
  /** Which org user names exist (ownership joins). */
  orgUserNames: string[] | null;
  failures: Record<string, string>;
}

/** One concrete relation (internal; aggregated into cells, reused by impact). */
export interface KnowledgeRelation {
  fromAssetId: string;
  toAssetId: string;
  edgeSource: string;
  evidence: string[];
}

const RELATION_CAP = 20_000;

export interface MatrixBuild {
  matrix: KnowledgeRelationshipMatrix;
  relations: KnowledgeRelation[];
  /** recordId → asset (the join index impact analysis reuses). */
  byRecordId: Map<string, KnowledgeAsset>;
}

export function buildMatrix(input: MatrixInput, nowIso: string): MatrixBuild {
  const relations: KnowledgeRelation[] = [];
  const unavailable: KnowledgeUnavailable[] = Object.entries(input.failures).map(([system, reason]) => ({
    system,
    reason,
  }));
  const edgeSources = new Set<string>();

  const byRecordId = new Map<string, KnowledgeAsset>();
  const byAssetId = new Map<string, KnowledgeAsset>();
  for (const a of input.assets) {
    byRecordId.set(a.recordId, a);
    byAssetId.set(a.id, a);
  }

  const relate = (from: KnowledgeAsset | undefined, to: KnowledgeAsset | undefined, edgeSource: string, evidence: string[]): void => {
    if (!from || !to || from.id === to.id) return;
    if (relations.length >= RELATION_CAP) return;
    edgeSources.add(edgeSource);
    relations.push({ fromAssetId: from.id, toAssetId: to.id, edgeSource, evidence });
  };

  /* 1 — decision evidence[] → any asset-backed record id */
  for (const a of input.assets) {
    if (a.classId !== 'executive-decision') continue;
    for (const ev of a.evidence) {
      if (ev === a.recordId) continue;
      relate(a, byRecordId.get(ev), 'decision evidence[] reference', [a.recordId, ev]);
    }
  }

  /* 2 — memory entityRefs / evidence → asset-backed record ids */
  for (const a of input.assets) {
    if (a.classId !== 'explicit-memory') continue;
    for (const ref of [...a.entityRefs, ...a.evidence]) {
      if (ref === a.recordId) continue;
      relate(a, byRecordId.get(ref), 'memory entityRef/evidence reference', [a.recordId, ref]);
    }
  }

  /* 3 — graph edges between asset-backed nodes (the EXISTING projector's edges) */
  if (input.graphEdges) {
    for (const e of input.graphEdges) {
      if (!e.fromSourceId || !e.toSourceId) continue;
      const from = byRecordId.get(e.fromSourceId);
      const to = byRecordId.get(e.toSourceId);
      if (!from || !to) continue;
      relate(from, to, `graph '${e.type}' edge`, [
        ...(e.evidenceId ? [e.evidenceId] : []),
        `${e.fromSourceId}|${e.type}|${e.toSourceId}`,
      ]);
    }
  } else if (!('graph' in input.failures)) {
    unavailable.push({ system: 'graph', reason: 'graph edge feed not provided' });
  }

  /* 4 — workflow-run ↔ approval correlation joins (timeline approval.granted) */
  if (input.approvalEvents && input.jobs) {
    const eventsByCorrelation = new Map<string, ApprovalEventFeed[]>();
    for (const ev of input.approvalEvents) {
      if (!ev.correlationId) continue;
      const list = eventsByCorrelation.get(ev.correlationId) ?? [];
      list.push(ev);
      eventsByCorrelation.set(ev.correlationId, list);
    }
    const firstChain = input.assets.find((a) => a.classId === 'governance-policy');
    for (const j of input.jobs) {
      if (!j.correlationId) continue;
      const evts = eventsByCorrelation.get(j.correlationId);
      if (!evts || evts.length === 0) continue;
      const wf = byRecordId.get(`wf:${j.skillId}`);
      // one governance join per run is evidence enough for the cell
      relate(wf, firstChain, 'approval.granted correlation join', [j.id, ...evts.slice(0, 3).map((e) => e.id)]);
    }
  }

  /* 5 — insight recommendation evidence → asset-backed record ids */
  if (input.insightRecommendations) {
    for (const r of input.insightRecommendations) {
      for (const ev of r.evidence) {
        const target = byRecordId.get(ev);
        if (!target) continue;
        const derived = byRecordId.get('insight-report');
        relate(derived, target, 'insight recommendation evidence', [r.id, ev]);
      }
    }
  }

  /* 6 — connector provenance: assets synced through a connector-doc asset */
  for (const a of input.assets) {
    if (a.classId === 'connector-doc') continue;
    const conn = byRecordId.get(a.sourceSystem);
    if (conn && conn.classId === 'connector-doc') {
      relate(a, conn, 'connector sync provenance', [a.recordId, conn.recordId]);
    }
  }

  /* 7 — ownership joins: owner name resolves to an org user → org-structure */
  if (input.orgUserNames && input.orgUserNames.length > 0) {
    const names = new Set(input.orgUserNames.map((n) => n.trim().toLowerCase()));
    const orgAsset = input.assets.find((a) => a.classId === 'org-structure');
    for (const a of input.assets) {
      if (!a.owner || a.classId === 'org-structure') continue;
      if (names.has(a.owner.trim().toLowerCase())) {
        relate(a, orgAsset, 'owner resolves to an org-chart member', [a.recordId, ...(orgAsset ? [orgAsset.recordId] : [])]);
      }
    }
  }

  /* aggregate cells */
  const cellMap = new Map<string, KnowledgeMatrixCell>();
  for (const r of relations) {
    const from = byAssetId.get(r.fromAssetId);
    const to = byAssetId.get(r.toAssetId);
    if (!from || !to) continue;
    const key = `${from.classId}|${to.classId}|${r.edgeSource}`;
    const cell = cellMap.get(key);
    if (cell) cell.count += 1;
    else cellMap.set(key, { from: from.classId, to: to.classId, edgeSource: r.edgeSource, count: 1 });
  }

  return {
    matrix: {
      generatedAt: nowIso,
      cells: [...cellMap.values()].sort((a, b) => b.count - a.count),
      totalRelations: relations.length,
      edgeSources: [...edgeSources].sort(),
      computedOnly: true,
      unavailable,
    },
    relations,
    byRecordId,
  };
}

/* ── enhancement #3 — impact analysis over the SAME relations + assets ────── */

const IMPACT_KIND_BY_CLASS: Record<string, KnowledgeImpactKind> = {
  'executive-decision': 'decision',
  'workflow-definition': 'workflow',
  'governance-policy': 'policy',
  'compliance-rule': 'policy',
  'connector-doc': 'connector',
  'derived-intelligence': 'intelligence',
  'governed-document': 'document',
  'explicit-memory': 'memory',
  'ai-prompt': 'document',
  'org-structure': 'policy',
};

/**
 * What does this asset touch? Computed from the matrix relations (both
 * directions) + insight-recommendation evidence — decisions, workflows,
 * policies, connectors, and intelligence findings, exactly as approved.
 */
export function analyzeImpact(
  assetRef: string,
  build: MatrixBuild,
  insightRecommendations: InsightRecoFeed[] | null,
): KnowledgeImpactAnalysis {
  const asset =
    build.byRecordId.get(assetRef) ??
    [...build.byRecordId.values()].find((a) => a.id === assetRef) ??
    null;
  if (!asset) {
    return {
      assetId: assetRef,
      found: false,
      title: null,
      entries: [],
      byKind: [],
      note: 'no knowledge asset backs this reference — nothing is invented for it',
    };
  }

  const entries: KnowledgeImpactEntry[] = [];
  const seen = new Set<string>();
  const byAssetId = new Map<string, KnowledgeAsset>();
  for (const a of build.byRecordId.values()) byAssetId.set(a.id, a);

  const push = (other: KnowledgeAsset | undefined, via: string, evidence: string[]): void => {
    if (!other || other.id === asset.id || seen.has(other.id)) return;
    seen.add(other.id);
    entries.push({
      kind: IMPACT_KIND_BY_CLASS[other.classId] ?? 'document',
      id: other.id,
      title: other.title,
      via,
      evidence,
    });
  };

  for (const r of build.relations) {
    if (r.fromAssetId === asset.id) push(byAssetId.get(r.toAssetId), r.edgeSource, r.evidence);
    else if (r.toAssetId === asset.id) push(byAssetId.get(r.fromAssetId), r.edgeSource, r.evidence);
  }

  /* intelligence findings citing this record directly */
  if (insightRecommendations) {
    for (const rec of insightRecommendations) {
      if (!rec.evidence.includes(asset.recordId)) continue;
      const key = `intel:${rec.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({
        kind: 'intelligence',
        id: rec.id,
        title: rec.title,
        via: 'insight recommendation evidence',
        evidence: [rec.id, asset.recordId],
      });
    }
  }

  const kindCounts = new Map<KnowledgeImpactKind, number>();
  for (const e of entries) kindCounts.set(e.kind, (kindCounts.get(e.kind) ?? 0) + 1);

  return {
    assetId: asset.id,
    found: true,
    title: asset.title,
    entries: entries.slice(0, 100),
    byKind: [...kindCounts.entries()].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count),
    note:
      entries.length === 0
        ? 'no recorded relationships touch this asset (computed from real edges only)'
        : `computed from ${build.matrix.edgeSources.length} existing edge mechanism(s); nothing persisted`,
  };
}
