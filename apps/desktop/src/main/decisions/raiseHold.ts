/**
 * One way to raise a HOLD.
 *
 * The first three producers each wrote their own open-hold-then-record-decision
 * sequence at their trigger site. Three is where that stops being fine: the
 * pairing between a hold and its Decision Record is the thing that makes
 * "why did we stop?" answerable months later, and a pairing re-implemented per
 * caller is a pairing that will eventually be forgotten at one of them.
 *
 * So the sequence lives here, once:
 *
 *   HoldStore.open  →  DecisionRecordStore.record (carrying the hold id)  →  audit
 *
 * Deduplication comes free and is deterministic: `HoldStore.open` returns the
 * existing OPEN hold for a subject rather than a second one, so a user who
 * retries a refused action five times gets one item and one decision record,
 * not five. That property is load-bearing — a governance surface that fills
 * with duplicates is a governance surface nobody reads.
 *
 * Electron-free; the stores are injected, so a test drives the real thing.
 */
import type { DecisionRisk, HoldRecord, HoldView } from '@neuropause/shared';
import type { DecisionRecordStore } from './decisionService';
import type { HoldStore } from './holdStore';

export interface RaiseHoldDeps {
  holds: HoldStore;
  decisions: DecisionRecordStore;
  actor: () => string | null;
  audit: (action: string, target: string, summary: string) => void;
}

export interface RaiseHoldInput extends HoldView {
  /** Plain-words title, e.g. 'Approve PO-4471 to move it to "approved"'. */
  title: string;
  /**
   * Stable identity of what is held. THE dedupe key — two attempts at the same
   * thing must produce the same subject, or the list grows without bound.
   */
  subject: string;
  /** What the user was trying to do, for the Decision Record. */
  requestedAction: string;
  /** What actually happened. Almost always "nothing" — that is the point. */
  executed?: string;
  /**
   * How the assessment reads in the record. Defaults from the hold reason:
   * a missing permission or absent evidence is not a RISK judgement, it is an
   * absence, and recording it as `high_risk` would overstate what is known.
   */
  risk?: DecisionRisk;
}

/** Reasons that describe an ABSENCE rather than a hazard. */
const ABSENCE_REASONS = new Set([
  'insufficient_evidence',
  'insufficient_permission',
  'verification_unavailable',
  'external_unavailable',
  'ambiguous_identity',
  'ambiguous_request',
]);

export type HoldRaiser = (input: RaiseHoldInput) => HoldRecord;

export function createHoldRaiser(deps: RaiseHoldDeps): HoldRaiser {
  return (input) => {
    const actor = deps.actor();
    const hold = deps.holds.open({
      reason: input.reason,
      why: input.why,
      known: input.known,
      unknown: input.unknown,
      resolution: input.resolution,
      ifProceeding: input.ifProceeding,
      title: input.title,
      subject: input.subject,
      actor,
    });

    // `open` is idempotent per subject. If it handed back a hold that already
    // has a decision record, writing a second one would double-count the same
    // event in the trail — so the record follows the hold's identity, not the
    // call.
    const already = deps.decisions
      .forSubject(input.subject)
      .some((r) => r.holdId === hold.id);
    if (!already) {
      deps.decisions.record({
        actor,
        requestedAction: input.requestedAction,
        subject: input.subject,
        assessment: {
          risk: input.risk ?? (ABSENCE_REASONS.has(input.reason) ? 'insufficient_evidence' : 'questionable'),
          recommendation: input.resolution,
          evidence: input.known.map((detail) => ({
            label: 'Evidence at hold time',
            detail,
            count: null,
          })),
          alternative: null,
        },
        outcome: 'cancelled',
        executed: input.executed ?? 'Nothing — the action was held.',
        holdId: hold.id,
      });
      deps.audit('hold.raised', input.subject, `${input.title} (${input.reason})`);
    }
    return hold;
  };
}
