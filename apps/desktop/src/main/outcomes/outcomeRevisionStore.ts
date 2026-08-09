/**
 * The audit trail for measurements.
 *
 * Outcomes themselves are DERIVED on every read, exactly like findings — so
 * nothing here can go stale, and there is no stored number for a later
 * recalculation to silently overwrite. What that design does not give you on
 * its own is history: if the baseline moves because someone corrected a
 * purchase order, today's honest figure quietly replaces yesterday's honest
 * figure and nobody can tell it happened.
 *
 * So the revisions are the record. Append-only, one entry each time a recorded
 * measurement is materially different from the last, carrying the reason it
 * changed. Nothing is ever edited or removed, which is the only version of
 * "do not erase a previously verified outcome" that actually holds.
 *
 * Deliberately NOT hosted in `OpportunityDecisionStore`: that store is an
 * upsert whose whole point is that a person changing their mind is one row
 * that moved, not two competing ones. Correct for an opinion, wrong for an
 * audit trail.
 */
import type { OutcomeRevision } from '@neuropause/shared';
import { AppendOnlyJsonStore } from '../decisions/appendOnlyStore';

/**
 * Revisions accumulate per measurement, not per view — a measurement that
 * never moves writes exactly one entry, forever.
 */
const MAX_REVISIONS = 500;

export interface AppendRevisionInput {
  outcomeKey: string;
  actor: string | null;
  executionRecordId: string | null;
  status: OutcomeRevision['status'];
  baseline: number | null;
  measurement: number | null;
  change: number | null;
  currency: string;
  reason: string;
}

export class OutcomeRevisionStore extends AppendOnlyJsonStore<OutcomeRevision> {
  /**
   * Distinguishes revisions written inside the same millisecond. The timestamp
   * alone is not unique, and the UI uses the id as a list key — duplicate keys
   * would silently drop one of the two entries the log exists to preserve.
   */
  private sequence = 0;

  constructor(filePath: string, now: () => string = () => new Date().toISOString()) {
    super(filePath, MAX_REVISIONS, now);
  }

  /** Every revision of one outcome, newest first. */
  forOutcome(outcomeKey: string): OutcomeRevision[] {
    return this.items.filter((r) => r.outcomeKey === outcomeKey).reverse();
  }

  /** The most recent recorded observation, or undefined if never recorded. */
  latest(outcomeKey: string): OutcomeRevision | undefined {
    return this.forOutcome(outcomeKey)[0];
  }

  append_(input: AppendRevisionInput): OutcomeRevision {
    const at = this.now();
    this.sequence += 1;
    const revision: OutcomeRevision = {
      id: `rev_${input.outcomeKey}_${at}_${this.sequence}`,
      outcomeKey: input.outcomeKey,
      at,
      actor: input.actor,
      executionRecordId: input.executionRecordId,
      status: input.status,
      baseline: input.baseline,
      measurement: input.measurement,
      change: input.change,
      currency: input.currency,
      reason: input.reason,
    };
    this.append(revision);
    return revision;
  }
}
