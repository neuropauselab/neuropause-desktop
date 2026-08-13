/**
 * Intent Experience Program v2.0 — the intent service.
 *
 * Orchestrates the pure intent model over a memoized snapshot composed from the REAL P14 strategy goals via
 * a single injected `readState` reader. It caches BOTH the snapshot AND each projection, so repeated reads
 * are O(1) cache hits; a short TTL plus backing-store events keep it fresh. The service holds no state of
 * record, executes nothing, and adds no store.
 */
import type { IntentBoard, IntentGovernance, IntentWorkspaces } from '@neuropause/shared';
import { buildIntentBoard, buildIntentGovernance, buildIntentWorkspaces, type IntentState } from './intentModel';
import type { TenantScope } from '@neuropause/shared';
import { TenantMemo } from '../tenancy/tenantMemo';

export interface IntentServiceDeps {
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
  /** Compose the intent snapshot from the existing P14 strategy signals (injected → testable). */
  readState: () => IntentState;
  ttlMs?: number;
  now?: () => number;
}


export class IntentService {
  /**
   * One tenant-keyed cell holding the snapshot AND its projections.
   *
   * The projections are inside the cell rather than beside it because they
   * are derived from that snapshot: keeping the snapshot keyed while leaving
   * the derived values in a separate object would leak exactly the composed,
   * human-readable half — which is the half worth stealing.
   */
  private readonly cache: TenantMemo<IntentState>;

  constructor(private readonly deps: IntentServiceDeps) {
    this.cache = new TenantMemo<IntentState>('intent-projections', {
      ttlMs: deps.ttlMs ?? 3000,
      ...(deps.now ? { now: deps.now } : {}),
    }).bindScope(deps.scope);
  }

  /** Drop the memoized snapshot AND projections; the next read recomposes from the sources. */
  invalidate(): void {
    this.cache.invalidate();
  }

  private state(): IntentState {
    return this.cache.state(() => this.deps.readState());
  }

  // The projection name is the memo key, and it lives INSIDE the tenant-keyed cell
  // established by `state()`. Resolving `state()` on its own line first is what puts
  // the right cell in place; it also removes the `??=` base-object footgun this
  // comment used to warn about, because there is no longer an object to capture.
  board(): IntentBoard {
    const s = this.state();
    return this.cache.projection('board', () => buildIntentBoard(s));
  }

  workspaces(): IntentWorkspaces {
    const s = this.state();
    return this.cache.projection('workspaces', () => buildIntentWorkspaces(s));
  }

  governance(): IntentGovernance {
    const s = this.state();
    void s;
    return this.cache.projection('governance', () => buildIntentGovernance());
  }
}
