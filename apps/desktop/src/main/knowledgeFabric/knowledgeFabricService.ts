/**
 * P16 — Enterprise Knowledge Fabric service.
 *
 * Orchestrates the pure fabric model over a memoized snapshot composed from the EXISTING platform via a
 * single injected `readState` reader. It caches BOTH the snapshot AND each projection, so repeated reads
 * are O(1) cache hits; a short TTL (matching the upstream Enterprise Intelligence / relationship 3s TTLs)
 * plus backing-store events keep it fresh. The service holds no state of record, executes nothing, and
 * adds no store, graph, memory, timeline, or search.
 */
import type {
  FabricAnalytics,
  FabricClassification,
  FabricEvidenceReport,
  FabricGovernance,
  FabricLineage,
  FabricOverview,
  FabricRelationshipMap,
  FabricSourceCatalog,
} from '@neuropause/shared';
import {
  buildFabricAnalytics,
  buildFabricClassification,
  buildFabricEvidence,
  buildFabricGovernance,
  buildFabricLineage,
  buildFabricOverview,
  buildFabricRelationships,
  buildFabricSources,
  type FabricState,
} from './knowledgeFabricModel';

export interface KnowledgeFabricServiceDeps {
  /** Compose the fabric snapshot from the existing platform signals (injected → testable). */
  readState: () => FabricState;
  /**
   * Snapshot freshness window (ms). The injected Enterprise Intelligence report (3s pull-TTL), the
   * Relationship provider (2.5s cache), the Strategy service, the Twin, and the timeline change WITHOUT
   * emitting a hooked event, so a TTL guarantees the snapshot recomposes and Refresh reflects fresh data.
   */
  ttlMs?: number;
  /** Injectable clock (tests). */
  now?: () => number;
}

interface ProjectionMemo {
  overview?: FabricOverview;
  sources?: FabricSourceCatalog;
  relationships?: FabricRelationshipMap;
  classification?: FabricClassification;
  lineage?: FabricLineage;
  evidence?: FabricEvidenceReport;
  governance?: FabricGovernance;
  analytics?: FabricAnalytics;
}

export class KnowledgeFabricService {
  private snapshot: FabricState | null = null;
  private snapshotAt = 0;
  private memo: ProjectionMemo = {};
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(private readonly deps: KnowledgeFabricServiceDeps) {
    this.ttlMs = deps.ttlMs ?? 3000;
    this.now = deps.now ?? Date.now;
  }

  /** Drop the memoized snapshot AND projections; the next read recomposes from the sources. */
  invalidate(): void {
    this.snapshot = null;
    this.memo = {};
  }

  private state(): FabricState {
    const t = this.now();
    if (!this.snapshot || t - this.snapshotAt >= this.ttlMs) {
      this.snapshot = this.deps.readState();
      this.snapshotAt = t;
      this.memo = {};
    }
    return this.snapshot;
  }

  // NOTE: `this.state()` MUST be resolved on its own line before the `??=` — `state()` may reset the
  // memo, and `a.b ??= f()` captures the base object BEFORE evaluating `f()`.
  overview(): FabricOverview {
    const s = this.state();
    return (this.memo.overview ??= buildFabricOverview(s));
  }

  sources(): FabricSourceCatalog {
    const s = this.state();
    return (this.memo.sources ??= buildFabricSources(s));
  }

  relationships(): FabricRelationshipMap {
    const s = this.state();
    return (this.memo.relationships ??= buildFabricRelationships(s));
  }

  classification(): FabricClassification {
    const s = this.state();
    return (this.memo.classification ??= buildFabricClassification(s));
  }

  lineage(): FabricLineage {
    const s = this.state();
    return (this.memo.lineage ??= buildFabricLineage(s));
  }

  evidence(): FabricEvidenceReport {
    const s = this.state();
    return (this.memo.evidence ??= buildFabricEvidence(s));
  }

  governance(): FabricGovernance {
    const s = this.state();
    return (this.memo.governance ??= buildFabricGovernance(s));
  }

  analytics(): FabricAnalytics {
    const s = this.state();
    return (this.memo.analytics ??= buildFabricAnalytics(s));
  }
}
