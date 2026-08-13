/**
 * P17 — Global AI Orchestration Platform service.
 *
 * Orchestrates the pure orchestration model over a memoized snapshot composed from the EXISTING platform
 * via a single injected `readState` reader. It caches BOTH the snapshot AND each projection, so repeated
 * reads are O(1) cache hits; a short TTL (matching the upstream 3s pull-TTLs) plus backing-store events
 * keep it fresh. The service holds no state of record, executes nothing, and adds no store, runtime,
 * engine, or scheduler.
 */
import type {
  OrchestrationCloud,
  OrchestrationCoordination,
  OrchestrationFlowReport,
  OrchestrationGoalRouting,
  OrchestrationGovernance,
  OrchestrationKnowledge,
  OrchestrationOverview,
  OrchestrationWorkforce,
} from '@neuropause/shared';
import {
  buildOrchestrationCloud,
  buildOrchestrationCoordination,
  buildOrchestrationFlowReport,
  buildOrchestrationGoals,
  buildOrchestrationGovernance,
  buildOrchestrationKnowledge,
  buildOrchestrationOverview,
  buildOrchestrationWorkforce,
  type OrchestrationState,
} from './orchestrationModel';
import type { TenantScope } from '@neuropause/shared';
import { TenantMemo } from '../tenancy/tenantMemo';

export interface GlobalOrchestrationServiceDeps {
  /**
   * P13C ROUND 3 — H-2. THE TENANT BOUNDARY, AND IT IS REQUIRED.
   *
   * This service memoises a composed snapshot of tenant-derived data. The memo
   * had no key, so a snapshot built while one organization was active was served
   * to the next caller — including the next tenant's pass of a fanned-out
   * background job, which announces no switch and therefore defeated the switch
   * listener the sibling platforms rely on.
   *
   * Required rather than optional so a composition root that forgets it fails to
   * COMPILE. That is a stronger gate than failing at startup, and strictly
   * stronger than being caught by a later audit.
   */
  scope: () => TenantScope | null;
  /** Compose the orchestration snapshot from the existing platform signals (injected → testable). */
  readState: () => OrchestrationState;
  /**
   * Snapshot freshness window (ms). The injected report/strategy/twin/knowledge/cloud accessors change
   * WITHOUT emitting a hooked event, so a TTL guarantees the snapshot recomposes and Refresh reflects
   * fresh upstream data.
   */
  ttlMs?: number;
  /** Injectable clock (tests). */
  now?: () => number;
}


export class GlobalOrchestrationService {
  /**
   * One tenant-keyed cell holding the snapshot AND its projections.
   *
   * The projections are inside the cell rather than beside it because they
   * are derived from that snapshot: keeping the snapshot keyed while leaving
   * the derived values in a separate object would leak exactly the composed,
   * human-readable half — which is the half worth stealing.
   */
  private readonly cache: TenantMemo<OrchestrationState>;

  constructor(private readonly deps: GlobalOrchestrationServiceDeps) {
    this.cache = new TenantMemo<OrchestrationState>('orchestration-projections', {
      ttlMs: deps.ttlMs ?? 3000,
      ...(deps.now ? { now: deps.now } : {}),
    }).bindScope(deps.scope);
  }

  /** Drop the memoized snapshot AND projections; the next read recomposes from the sources. */
  invalidate(): void {
    this.cache.invalidate();
  }

  private state(): OrchestrationState {
    return this.cache.state(() => this.deps.readState());
  }

  // The projection name is the memo key, and it lives INSIDE the tenant-keyed cell
  // established by `state()`. Resolving `state()` on its own line first is what puts
  // the right cell in place; it also removes the `??=` base-object footgun this
  // comment used to warn about, because there is no longer an object to capture.
  overview(): OrchestrationOverview {
    const s = this.state();
    return this.cache.projection('overview', () => buildOrchestrationOverview(s));
  }

  goals(): OrchestrationGoalRouting {
    const s = this.state();
    return this.cache.projection('goals', () => buildOrchestrationGoals(s));
  }

  workforce(): OrchestrationWorkforce {
    const s = this.state();
    return this.cache.projection('workforce', () => buildOrchestrationWorkforce(s));
  }

  cloud(): OrchestrationCloud {
    const s = this.state();
    return this.cache.projection('cloud', () => buildOrchestrationCloud(s));
  }

  knowledge(): OrchestrationKnowledge {
    const s = this.state();
    return this.cache.projection('knowledge', () => buildOrchestrationKnowledge(s));
  }

  flows(): OrchestrationFlowReport {
    const s = this.state();
    return this.cache.projection('flows', () => buildOrchestrationFlowReport(s));
  }

  coordination(): OrchestrationCoordination {
    const s = this.state();
    return this.cache.projection('coordination', () => buildOrchestrationCoordination(s));
  }

  governance(): OrchestrationGovernance {
    const s = this.state();
    return this.cache.projection('governance', () => buildOrchestrationGovernance(s));
  }
}
