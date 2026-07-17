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

export interface ExperienceServiceDeps {
  /** Compose the experience snapshot from the existing platform signals (injected → testable). */
  readState: () => ExperienceState;
  ttlMs?: number;
  now?: () => number;
}

interface ProjectionMemo {
  home?: ExperienceHome;
  decisions?: ExperienceDecisions;
  summaries?: ExperienceSummaries;
  intents?: ExperienceIntents;
  governance?: ExperienceGovernance;
}

export class ExperienceService {
  private snapshot: ExperienceState | null = null;
  private snapshotAt = 0;
  private memo: ProjectionMemo = {};
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(private readonly deps: ExperienceServiceDeps) {
    this.ttlMs = deps.ttlMs ?? 3000;
    this.now = deps.now ?? Date.now;
  }

  /** Drop the memoized snapshot AND projections; the next read recomposes from the sources. */
  invalidate(): void {
    this.snapshot = null;
    this.memo = {};
  }

  private state(): ExperienceState {
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
  home(): ExperienceHome {
    const s = this.state();
    return (this.memo.home ??= buildExperienceHome(s));
  }

  decisions(): ExperienceDecisions {
    const s = this.state();
    return (this.memo.decisions ??= buildExperienceDecisions(s));
  }

  summaries(): ExperienceSummaries {
    const s = this.state();
    return (this.memo.summaries ??= buildExperienceSummaries(s));
  }

  // intents + governance are static catalogs, but memoized behind the same snapshot for a uniform surface.
  intents(): ExperienceIntents {
    const s = this.state();
    void s;
    return (this.memo.intents ??= buildExperienceIntents());
  }

  governance(): ExperienceGovernance {
    const s = this.state();
    void s;
    return (this.memo.governance ??= buildExperienceGovernance());
  }
}
