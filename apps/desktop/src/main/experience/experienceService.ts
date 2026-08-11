/**
 * Experience Program v1.0 — the experience service.
 *
 * Orchestrates the pure decision-first model over a memoized snapshot composed from the ENTIRE platform via
 * a single injected `readState` reader. It caches BOTH the snapshot AND each projection, so repeated reads
 * are O(1) cache hits; a short TTL plus backing-store events keep it fresh. The service holds no state of
 * record, executes nothing, and adds no store.
 */
import type {
  ExperienceDecisions,
  ExperienceGovernance,
  ExperienceHome,
  ExperienceIntents,
  ExperienceSummaries,
} from '@neuropause/shared';
import {
  buildExperienceDecisions,
  buildExperienceGovernance,
  buildExperienceHome,
  buildExperienceIntents,
  buildExperienceSummaries,
  type ExperienceState,
} from './experienceModel';
import type { TenantScope } from '@neuropause/shared';
import { TenantMemo } from '../tenancy/tenantMemo';

export interface ExperienceServiceDeps {
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
  /** Compose the experience snapshot from the existing platform signals (injected → testable). */
  readState: () => ExperienceState;
  ttlMs?: number;
  now?: () => number;
}


export class ExperienceService {
  /**
   * One tenant-keyed cell holding the snapshot AND its projections.
   *
   * The projections are inside the cell rather than beside it because they
   * are derived from that snapshot: keeping the snapshot keyed while leaving
   * the derived values in a separate object would leak exactly the composed,
   * human-readable half — which is the half worth stealing.
   */
  private readonly cache: TenantMemo<ExperienceState>;

  constructor(private readonly deps: ExperienceServiceDeps) {
    this.cache = new TenantMemo<ExperienceState>('experience-projections', {
      ttlMs: deps.ttlMs ?? 3000,
      ...(deps.now ? { now: deps.now } : {}),
    }).bindScope(deps.scope);
  }

  /** Drop the memoized snapshot AND projections; the next read recomposes from the sources. */
  invalidate(): void {
    this.cache.invalidate();
  }

  private state(): ExperienceState {
    return this.cache.state(() => this.deps.readState());
  }

  // The projection name is the memo key, and it lives INSIDE the tenant-keyed cell
  // established by `state()`. Resolving `state()` on its own line first is what puts
  // the right cell in place; it also removes the `??=` base-object footgun this
  // comment used to warn about, because there is no longer an object to capture.
  home(): ExperienceHome {
    const s = this.state();
    return this.cache.projection('home', () => buildExperienceHome(s));
  }

  decisions(): ExperienceDecisions {
    const s = this.state();
    return this.cache.projection('decisions', () => buildExperienceDecisions(s));
  }

  summaries(): ExperienceSummaries {
    const s = this.state();
    return this.cache.projection('summaries', () => buildExperienceSummaries(s));
  }

  // intents + governance are static catalogs, but memoized behind the same snapshot for a uniform surface.
  intents(): ExperienceIntents {
    const s = this.state();
    void s;
    return this.cache.projection('intents', () => buildExperienceIntents());
  }

  governance(): ExperienceGovernance {
    const s = this.state();
    void s;
    return this.cache.projection('governance', () => buildExperienceGovernance());
  }
}
