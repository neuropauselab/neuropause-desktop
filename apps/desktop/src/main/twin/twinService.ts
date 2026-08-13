/**
 * P15 — Enterprise Digital Twin service.
 *
 * Orchestrates the pure twin model over a memoized snapshot composed from the EXISTING platform via a
 * single injected `readState` reader. It caches BOTH the snapshot AND each projection, so repeated
 * reads are O(1) cache hits; a short TTL (matching the upstream Enterprise Intelligence 3s TTL) plus
 * backing-store events keep it fresh. The service holds no state of record, executes nothing, and adds
 * no store, graph, timeline, or simulation engine.
 */
import type {
  EnterpriseTwinOverview,
  TwinCommandCenter,
  TwinDomains,
  TwinHealthMap,
  TwinImpact,
  TwinReplay,
  TwinScenarioCenter,
  TwinTopology,
} from '@neuropause/shared';
import {
  buildEnterpriseTwinOverview,
  buildTwinCommandCenter,
  buildTwinDomains,
  buildTwinHealthMap,
  buildTwinImpact,
  buildTwinReplay,
  buildTwinScenarioCenter,
  buildTwinTopology,
  type TwinState,
} from './twinModel';
import type { TenantScope } from '@neuropause/shared';
import { TenantMemo } from '../tenancy/tenantMemo';

export interface TwinServiceDeps {
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
  /** Compose the twin snapshot from the existing platform signals (injected → testable). */
  readState: () => TwinState;
  /**
   * Snapshot freshness window (ms). The injected Enterprise Intelligence report (3s pull-TTL), Cloud
   * Control Plane, Strategy service, and timeline change WITHOUT emitting a hooked event, so a TTL
   * guarantees the snapshot recomposes and the Refresh control reflects fresh upstream data.
   */
  ttlMs?: number;
  /** Injectable clock (tests). */
  now?: () => number;
}


export class TwinService {
  /**
   * One tenant-keyed cell holding the snapshot AND its projections.
   *
   * The projections are inside the cell rather than beside it because they
   * are derived from that snapshot: keeping the snapshot keyed while leaving
   * the derived values in a separate object would leak exactly the composed,
   * human-readable half — which is the half worth stealing.
   */
  private readonly cache: TenantMemo<TwinState>;

  constructor(private readonly deps: TwinServiceDeps) {
    this.cache = new TenantMemo<TwinState>('twin-projections', {
      ttlMs: deps.ttlMs ?? 3000,
      ...(deps.now ? { now: deps.now } : {}),
    }).bindScope(deps.scope);
  }

  /** Drop the memoized snapshot AND projections; the next read recomposes from the sources. */
  invalidate(): void {
    this.cache.invalidate();
  }

  private state(): TwinState {
    return this.cache.state(() => this.deps.readState());
  }

  // The projection name is the memo key, and it lives INSIDE the tenant-keyed cell
  // established by `state()`. Resolving `state()` on its own line first is what puts
  // the right cell in place; it also removes the `??=` base-object footgun this
  // comment used to warn about, because there is no longer an object to capture.
  overview(): EnterpriseTwinOverview {
    const s = this.state();
    return this.cache.projection('overview', () => buildEnterpriseTwinOverview(s));
  }

  domains(): TwinDomains {
    const s = this.state();
    return this.cache.projection('domains', () => buildTwinDomains(s));
  }

  topology(): TwinTopology {
    const s = this.state();
    return this.cache.projection('topology', () => buildTwinTopology(s));
  }

  health(): TwinHealthMap {
    const s = this.state();
    return this.cache.projection('health', () => buildTwinHealthMap(s));
  }

  replay(): TwinReplay {
    const s = this.state();
    return this.cache.projection('replay', () => buildTwinReplay(s));
  }

  scenario(): TwinScenarioCenter {
    const s = this.state();
    return this.cache.projection('scenario', () => buildTwinScenarioCenter(s));
  }

  impact(): TwinImpact {
    const s = this.state();
    return this.cache.projection('impact', () => buildTwinImpact(s));
  }

  executive(): TwinCommandCenter {
    const s = this.state();
    return this.cache.projection('executive', () => buildTwinCommandCenter(s));
  }
}
