/**
 * Module 10 — Enterprise Search v2. Extends Wave 2 search: instead of flat hits, each
 * result carries evidence, relationships, timeline, and confidence. It searches the
 * knowledge graph (real, tenant-scoped) and — optionally — enterprise memory. Live SaaS
 * results compose through the same interface once connectors sync (infra-pending).
 */
import { computeConfidence, type EvidenceRef, type TimelineEvent } from './types';
import type { KnowledgeGraph } from './graph';
import type { EnterpriseTimeline } from './timeline';
import type { EnterpriseMemory } from './memory';
import type { MemoryKind } from './constants';

export interface SearchV2Hit {
  source: string;
  type: string;
  id: string;
  title: string;
  evidence: EvidenceRef[];
  relationships: string[];
  timeline: TimelineEvent[];
  confidence: number;
}

export interface SearchV2Result {
  query: string;
  total: number;
  bySource: Record<string, number>;
  hits: SearchV2Hit[];
}

export class EnterpriseSearchV2 {
  constructor(
    private readonly graph: KnowledgeGraph,
    private readonly timeline: EnterpriseTimeline,
    private readonly memory?: EnterpriseMemory,
  ) {}

  async search(tenantId: string, query: string, opts: { limit?: number; memoryKinds?: MemoryKind[] } = {}): Promise<SearchV2Result> {
    const q = query.toLowerCase();
    const limit = opts.limit ?? 10;

    const graphHits: SearchV2Hit[] = this.graph
      .list(tenantId)
      .filter((e) => e.label.toLowerCase().includes(q))
      .slice(0, limit)
      .map((e) => ({
        source: 'graph',
        type: e.type,
        id: e.id,
        title: e.label,
        evidence: e.evidence,
        relationships: this.graph.neighbors(e.id).map((n) => `${n.type}:${n.label}`).slice(0, 5),
        timeline: this.timeline.forEntity(tenantId, e.id).slice(-3),
        confidence: computeConfidence(e.evidence).score,
      }));

    const memHits: SearchV2Hit[] = [];
    if (this.memory && opts.memoryKinds) {
      for (const kind of opts.memoryKinds) {
        const records = await this.memory.list(tenantId, kind, 'default').catch(() => []);
        for (const r of records) {
          if (r.key.toLowerCase().includes(q) || JSON.stringify(r.value).toLowerCase().includes(q)) {
            memHits.push({ source: 'memory', type: kind, id: r.id, title: r.key, evidence: [{ kind: `memory.${kind}`, id: r.id, source: 'memory' }], relationships: [], timeline: [], confidence: 0.6 });
          }
        }
      }
    }

    const hits = [...graphHits, ...memHits];
    const bySource: Record<string, number> = {};
    for (const h of hits) bySource[h.source] = (bySource[h.source] ?? 0) + 1;
    return { query, total: hits.length, bySource, hits };
  }
}
