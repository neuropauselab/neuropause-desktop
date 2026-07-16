/**
 * P10 — the Federation Search source singleton.
 *
 * Mirrors the Enterprise Timeline's `getEnterpriseTimeline()` seam: Enterprise Search stays
 * decoupled and pulls the federation source lazily (present only once the Federation Platform
 * has initialized), so there is no import cycle and no signature change to the search engine.
 */
import type { EnterpriseSearchHit } from '@neuropause/shared';

/** Structural surface Enterprise Search consumes (kept minimal — no class import). */
export interface FederationSearcher {
  search(text: string, limit: number): EnterpriseSearchHit[];
}

let searcher: FederationSearcher | null = null;

export function setFederationSearcher(s: FederationSearcher | null): void {
  searcher = s;
}

export function getFederationSearcher(): FederationSearcher | null {
  return searcher;
}
