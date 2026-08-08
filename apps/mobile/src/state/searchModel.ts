/**
 * Search view-model (Mobile M1-11) — PURE grouping for enterprise-search hits,
 * split from the screen so it unit-tests in plain Node. The desktop's enterprise
 * search covers connectors/UDM/graph/memory/timeline — NOT raw ERP record
 * bodies; the screen states that boundary in-UI.
 */
import type { CompanionSearchHit } from '@neuropause/shared';

export interface SearchGroup {
  source: string;
  hits: CompanionSearchHit[];
}

/** Group hits by source, preserving first-seen order of sources and hits. */
export function groupBySource(hits: CompanionSearchHit[]): SearchGroup[] {
  const order: string[] = [];
  const byKey = new Map<string, SearchGroup>();
  for (const h of hits) {
    let group = byKey.get(h.source);
    if (!group) {
      group = { source: h.source, hits: [] };
      byKey.set(h.source, group);
      order.push(h.source);
    }
    group.hits.push(h);
  }
  return order.map((s) => byKey.get(s) as SearchGroup);
}
