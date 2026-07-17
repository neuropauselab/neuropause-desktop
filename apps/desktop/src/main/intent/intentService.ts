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

export interface IntentServiceDeps {
  /** Compose the intent snapshot from the existing P14 strategy signals (injected → testable). */
  readState: () => IntentState;
  ttlMs?: number;
  now?: () => number;
}

interface ProjectionMemo {
  board?: IntentBoard;
  workspaces?: IntentWorkspaces;
  governance?: IntentGovernance;
}

export class IntentService {
  private snapshot: IntentState | null = null;
  private snapshotAt = 0;
  private memo: ProjectionMemo = {};
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(private readonly deps: IntentServiceDeps) {
    this.ttlMs = deps.ttlMs ?? 3000;
    this.now = deps.now ?? Date.now;
  }

  /** Drop the memoized snapshot AND projections; the next read recomposes from the sources. */
  invalidate(): void {
    this.snapshot = null;
    this.memo = {};
  }

  private state(): IntentState {
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
  board(): IntentBoard {
    const s = this.state();
    return (this.memo.board ??= buildIntentBoard(s));
  }

  workspaces(): IntentWorkspaces {
    const s = this.state();
    return (this.memo.workspaces ??= buildIntentWorkspaces(s));
  }

  governance(): IntentGovernance {
    const s = this.state();
    void s;
    return (this.memo.governance ??= buildIntentGovernance());
  }
}
