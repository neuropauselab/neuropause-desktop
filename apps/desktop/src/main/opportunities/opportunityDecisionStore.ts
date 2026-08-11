/**
 * What the user decided about a finding — the only part of an opportunity that
 * is allowed to persist.
 *
 * The findings themselves are recomputed on every read (see
 * `types/opportunity.ts`), because a stored finding is a finding that can go
 * stale while still looking current. But a DECISION is not derived from
 * anything; it is a fact about a person, it happened at a moment, and losing
 * it would mean a dismissed opportunity reappears every time the app restarts.
 *
 * So the split is: NeuroPause recomputes what it believes, and remembers what
 * you told it. The join between them is `id` — a stable hash of the finding's
 * identity (product + currency), not a row number — so the decision re-attaches
 * to the same finding on the next pass even though the finding object is new.
 *
 * `impactAtDecision` is kept alongside the status for one reason: a person who
 * dismissed a 400-rupee gap deserves to know when it has become a 40,000-rupee
 * gap. Storing only "dismissed" throws that away.
 *
 * Reuses `AppendOnlyJsonStore` (atomic, coalesced, capped, fail-quiet) rather
 * than opening a third way to write governance state to disk.
 */
import type { OpportunityDecision, OpportunityRecordRef, OpportunityStatus } from '@neuropause/shared';
import { AppendOnlyJsonStore } from '../decisions/appendOnlyStore';

/**
 * Decisions are one-per-finding, so the cap bounds how many DISTINCT findings
 * a user has ever ruled on — not how many times they changed their mind.
 */
const MAX_DECISIONS = 500;

export interface RecordDecisionInput {
  id: string;
  status: OpportunityStatus;
  actor: string | null;
  note: string;
  impactAtDecision: number | null;
  decisionRecordId?: string | null;
  holdId?: string | null;
  executionRef?: OpportunityRecordRef | null;
}

export class OpportunityDecisionStore extends AppendOnlyJsonStore<OpportunityDecision> {
  constructor(filePath: string, now: () => string = () => new Date().toISOString()) {
    super(filePath, MAX_DECISIONS, now, 'opportunity-decisions');
  }

  get(id: string): OpportunityDecision | null {
    return this.visible().find((d) => d.id === id) ?? null;
  }

  /** Every decision, keyed for the merge the subsystem does on each read. */
  byId(): Map<string, OpportunityDecision> {
    return new Map(this.visible().map((d) => [d.id, d]));
  }

  /**
   * Upsert. A person changing their mind is one decision that moved, not two
   * competing rows — the alternative is a store where "what is the current
   * status?" needs a tiebreak, and a tiebreak is a bug waiting for a clock
   * skew.
   *
   * Governance links accumulate rather than reset: an execution that produced a
   * hold, then later succeeded, should not lose the hold reference, because the
   * hold is how the pause is reconstructed afterwards.
   */
  set(input: RecordDecisionInput): OpportunityDecision {
    const existing = this.visible().find((d) => d.id === input.id) ?? null;
    if (existing !== null) {
      const updated: OpportunityDecision = {
        ...existing,
        status: input.status,
        at: this.now(),
        actor: input.actor,
        note: input.note,
        impactAtDecision: input.impactAtDecision,
        decisionRecordId: input.decisionRecordId ?? existing.decisionRecordId,
        holdId: input.holdId ?? existing.holdId,
        executionRef: input.executionRef ?? existing.executionRef,
      };
      // Re-append rather than update in place. The base class evicts from the
      // FRONT at the cap, and for an append-only log that is correct — oldest
      // event first. Here the entries are living state, not events: a decision
      // taken long ago but revisited yesterday must not be the next thing
      // discarded, because the failure that causes is a dismissal silently
      // vanishing and the finding reappearing as new — precisely what this
      // store exists to prevent.
      /**
       * `removeWhere`, not a splice of the read.
       *
       * P12 made `items` private and `visible()` returns a FILTERED COPY, so
       * `visible().splice(...)` mutated a throwaway array and the old row stayed
       * — the decision appeared not to move. Six tests caught it. `removeWhere`
       * is the scoped removal seam and ANDs the tenant predicate in, so this
       * cannot reach another tenant's row either.
       */
      this.removeWhere((d) => d.id === input.id);
      this.append(updated);
      return updated;
    }
    const created: OpportunityDecision = {
      id: input.id,
      status: input.status,
      at: this.now(),
      actor: input.actor,
      note: input.note,
      impactAtDecision: input.impactAtDecision,
      decisionRecordId: input.decisionRecordId ?? null,
      holdId: input.holdId ?? null,
      executionRef: input.executionRef ?? null,
    };
    this.append(created);
    return created;
  }
}
