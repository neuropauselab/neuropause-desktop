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
import type { TenantScope } from '@neuropause/shared';
import { TenantMemo } from '../tenancy/tenantMemo';

export interface KnowledgeFabricServiceDeps {
  /**
   * P13C ROUND 4 — F4. THE TENANT BOUNDARY, AND IT IS REQUIRED.
   *
   * This service has the exact shape Round 3 fixed in eleven siblings and was
   * not in the list of eleven — so it kept a keyless snapshot behind a 3s TTL,
   * protected only by `onWorkspaceSwitch`.
   *
   * That protection fails on the one path this program has already documented as
   * defeating it: the delivery engine's `forEachTenant` runs a knowledge-assets
   * pass once per tenant, back to back, under each tenant's own principal,
   * announcing no switch. Tenant A's pass composes the snapshot — memory-corpus
   * tag strings verbatim, plus the federation summary — and tenant B's pass,
   * microseconds later inside the TTL, is served it.
   *
   * The lesson is about the SWEEP, not the code: Round 3 fixed the eleven
   * services a review named and did not go looking for a twelfth with the same
   * shape. A list of instances is not a definition of a class.
   */
  scope: () => TenantScope | null;
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


export class KnowledgeFabricService {
  /** One tenant-keyed cell holding the snapshot AND its projections. */
  private readonly cache: TenantMemo<FabricState>;

  constructor(private readonly deps: KnowledgeFabricServiceDeps) {
    this.cache = new TenantMemo<FabricState>('knowledge-fabric-projections', {
      ttlMs: deps.ttlMs ?? 3000,
      ...(deps.now ? { now: deps.now } : {}),
    }).bindScope(deps.scope);
  }

  /** Drop the memoized snapshot AND projections; the next read recomposes from the sources. */
  invalidate(): void {
    this.cache.invalidate();
  }

  private state(): FabricState {
    return this.cache.state(() => this.deps.readState());
  }

  // NOTE: `this.state()` MUST be resolved on its own line before the `??=` — `state()` may reset the
  // memo, and `a.b ??= f()` captures the base object BEFORE evaluating `f()`.
  overview(): FabricOverview {
    const s = this.state();
    return this.cache.projection('overview', () => buildFabricOverview(s));
  }

  sources(): FabricSourceCatalog {
    const s = this.state();
    return this.cache.projection('sources', () => buildFabricSources(s));
  }

  relationships(): FabricRelationshipMap {
    const s = this.state();
    return this.cache.projection('relationships', () => buildFabricRelationships(s));
  }

  classification(): FabricClassification {
    const s = this.state();
    return this.cache.projection('classification', () => buildFabricClassification(s));
  }

  lineage(): FabricLineage {
    const s = this.state();
    return this.cache.projection('lineage', () => buildFabricLineage(s));
  }

  evidence(): FabricEvidenceReport {
    const s = this.state();
    return this.cache.projection('evidence', () => buildFabricEvidence(s));
  }

  governance(): FabricGovernance {
    const s = this.state();
    return this.cache.projection('governance', () => buildFabricGovernance(s));
  }

  analytics(): FabricAnalytics {
    const s = this.state();
    return this.cache.projection('analytics', () => buildFabricAnalytics(s));
  }
}
