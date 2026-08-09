/**
 * The Opportunity Center subsystem — discovery, decisions, and governed action.
 *
 * Three handlers, and the whole design is in the shape of the third.
 *
 * `list` recomputes every finding from live purchase orders and merges in what
 * the user previously decided. Nothing is cached and nothing is stored, so a
 * finding cannot outlive its evidence.
 *
 * `setStatus` records an opinion. It changes no business record.
 *
 * `execute` is the interesting one. Between the moment NeuroPause says "you are
 * paying two prices for this" and the moment someone clicks the button, the
 * orders can change: one gets cancelled, a price is corrected, the dear
 * supplier is renegotiated. An action justified by evidence must therefore
 * RE-DERIVE that evidence at the instant of acting, and refuse if it no longer
 * holds. Acting on a finding computed thirty seconds ago is acting on a
 * memory, and a memory is exactly what a governance system is not allowed to
 * mistake for a fact.
 *
 * So `execute` runs the full pipeline again before it does anything, and every
 * way it can decline is a durable HOLD with a named resolution rather than an
 * error that disappears:
 *
 *   re-derive → still holds?      no  → insufficient_evidence
 *   permission?                   no  → insufficient_permission
 *   target module registered?     no  → unresolved_dependency
 *   already an open RFQ?          yes → plain refusal (nothing to resolve)
 *   create → read it back         no  → verification_unavailable
 *
 * Every one of those paths writes a Decision Record, because "why is there no
 * RFQ?" deserves an answer months later.
 *
 * Electron-free: every capability is injected, so the tests drive the real
 * handlers over real files.
 */
import {
  IpcChannel,
  OpportunityExecuteRequest,
  OpportunityListRequest,
  OpportunitySetStatusRequest,
  canTransitionOpportunity,
  discoverPriceVarianceOpportunities,
  insufficiencyMessage,
  insufficientEvidenceHold,
  permissionMissingHold,
  unresolvedDependencyHold,
  verificationUnavailableHold,
} from '@neuropause/shared';
import type {
  Opportunity,
  OpportunityCenterView,
  OpportunityDecision,
  OpportunityExecuteResult,
  OpportunityRecordRef,
  OpportunityStatus,
  PurchaseOrderObservation,
} from '@neuropause/shared';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import type { HoldRaiser } from '../decisions/raiseHold';
import type { DecisionRecordStore } from '../decisions/decisionService';
import type { OpportunityDecisionStore } from './opportunityDecisionStore';

/** The scope required to act on a finding, checked inside the handler. */
const EXECUTE_PERMISSION = 'procurement:manage';

/** Statuses that mean "the user does not want to see this". */
const DISMISSED: ReadonlySet<OpportunityStatus> = new Set<OpportunityStatus>(['rejected']);

export interface CreatedRecord {
  recordId: string;
  label: string;
}

export interface OpportunitySubsystemDeps {
  /** Live purchase orders, mapped from the real module store by the caller. */
  orders: () => readonly PurchaseOrderObservation[];
  /**
   * The caller's read ceiling. Passed to the engine so a truncated read is
   * declared in the data review instead of being presented as everything.
   */
  readCeiling: number;
  decisions: OpportunityDecisionStore;
  /** Program 3's shared raiser — hold + paired Decision Record + audit, once. */
  raiseHold: HoldRaiser;
  /** For the non-hold paths: acting is also a decision worth reconstructing. */
  decisionRecords: DecisionRecordStore;
  /**
   * Non-throwing permission predicate.
   *
   * A predicate rather than the throwing `authorize`, because asking "may I?"
   * must not itself produce an audit entry or a spurious hold — the hold this
   * subsystem raises names the OPPORTUNITY, which is far more use than a
   * generic channel refusal.
   */
  canExecute: () => boolean;
  /** Scopes the actor does hold, so the hold can say what is missing from what. */
  heldPermissions: () => readonly string[];
  actorLabel: () => string;
  actor: () => string | null;
  /**
   * Whether the RFQ module is registered and writable. Null means the target
   * of the action does not exist in this runtime — a dependency, not a bug.
   */
  rfqModuleAvailable: () => boolean;
  /** An open RFQ already covering this product, if there is one. */
  openRfqFor: (product: string) => CreatedRecord | null;
  /** Create the RFQ through the existing registry (RBAC + audit + lifecycle). */
  createRfq: (input: {
    product: string;
    quantity: number;
    warehouse: string | null;
    notes: string;
  }) => Promise<CreatedRecord>;
  /** Read it back out of the store. The verification step — never skipped. */
  readRfq: (recordId: string) => CreatedRecord | null;
  audit: (action: string, target: string, summary: string) => void;
  now: () => string;
}

export interface OpportunitySubsystem {
  handlers: SecureHandlerDef[];
}

export function initOpportunities(deps: OpportunitySubsystemDeps): OpportunitySubsystem {
  /**
   * Merge a freshly derived finding with what the user decided about it.
   *
   * The finding wins on everything it computes; the decision wins on status and
   * governance links. Neither is allowed to overwrite the other's territory —
   * that is what keeps "what is true" and "what you said" from blurring.
   */
  function applyDecision(opportunity: Opportunity, decision: OpportunityDecision | undefined): Opportunity {
    if (!decision) return opportunity;
    return {
      ...opportunity,
      status: decision.status,
      decisionId: decision.decisionRecordId,
      holdId: decision.holdId,
      executionRef: decision.executionRef,
      statusChangedAt: decision.at,
      statusChangedBy: decision.actor,
      statusNote: decision.note || null,
      impactAtDecision: decision.impactAtDecision,
    };
  }

  /**
   * One discovery pass, decisions merged.
   *
   * Nothing memoizes this, and the omission is deliberate. A 2-second TTL was
   * here briefly and a UI test caught what it cost: pressing Refresh inside the
   * window returned the previous pass, so the button did nothing and the screen
   * kept showing a figure the records no longer supported. A cache on a surface
   * whose entire promise is "this reflects your records right now" has to be
   * worth more than that, and this one is not — discovery is O(orders)
   * arithmetic over a bounded read (5,000 rows), performed on mount and on
   * explicit user action, never per render.
   */
  function derive(lookbackDays?: number): OpportunityCenterView {
    const now = deps.now();
    const result = discoverPriceVarianceOpportunities(deps.orders(), {
      now,
      readCeiling: deps.readCeiling,
      ...(lookbackDays === undefined ? {} : { lookbackDays }),
    });
    const byId = deps.decisions.byId();
    const merged = result.opportunities.map((o) => applyDecision(o, byId.get(o.id)));
    const live = merged.filter((o) => !DISMISSED.has(o.status));
    const dismissed = merged.filter((o) => DISMISSED.has(o.status));
    return {
      opportunities: live,
      dismissed,
      review: result.review,
      // The insufficiency sentence describes the ANALYSIS, not the user's
      // filtering: a list emptied by dismissals is not a list with no evidence,
      // and saying so would be false.
      insufficient: merged.length === 0 ? insufficiencyMessage(result.review) : null,
      derivedAt: now,
    };
  }

  function findLive(id: string): Opportunity | null {
    const fresh = derive();
    return (
      fresh.opportunities.find((o) => o.id === id) ??
      fresh.dismissed.find((o) => o.id === id) ??
      null
    );
  }

  /**
   * Persist a status change and hand back the refreshed finding.
   *
   * The transition table is enforced HERE rather than only in `setStatus`,
   * because the execute path also moves status and was the one that could
   * drive illegal edges (`rejected → in_progress`, or out of the terminal
   * `completed`). A lifecycle policed only on the path that cannot damage
   * anything is not a policy.
   *
   * `impactAtDecision` is preserved when the status has not moved: it records
   * what the figure was WHEN the person decided, and overwriting it with
   * today's would destroy the only thing that lets the product say "you set
   * this aside at 550; it is 10,550 now".
   */
  function commit(
    opportunity: Opportunity,
    status: OpportunityStatus,
    note: string,
    links: { decisionRecordId?: string | null; holdId?: string | null; executionRef?: OpportunityRecordRef | null } = {},
  ): Opportunity {
    if (status !== opportunity.status && !canTransitionOpportunity(opportunity.status, status)) {
      return opportunity;
    }
    const unchanged = status === opportunity.status;
    const previous = deps.decisions.get(opportunity.id);
    const decision = deps.decisions.set({
      id: opportunity.id,
      status,
      actor: deps.actor(),
      note,
      impactAtDecision:
        unchanged && previous ? previous.impactAtDecision : (opportunity.impact?.amount ?? null),
      ...links,
    });
    return applyDecision({ ...opportunity, status }, decision);
  }

  /** Attach a hold to the finding it was raised for, without moving its status. */
  function linkHold(opportunity: Opportunity, holdId: string, note: string): void {
    commit(opportunity, opportunity.status, note, { holdId });
  }

  const handlers: SecureHandlerDef[] = [
    {
      channel: IpcChannel.OpportunityList,
      schema: OpportunityListRequest,
      handler: (p): OpportunityCenterView => derive((p as OpportunityListRequest).lookbackDays),
    },

    {
      channel: IpcChannel.OpportunitySetStatus,
      schema: OpportunitySetStatusRequest,
      audit: true,
      handler: (p): Opportunity | null => {
        const req = p as OpportunitySetStatusRequest;
        const opportunity = findLive(req.id);
        if (!opportunity) return null;
        // An illegal transition is a programming error in the caller, not a
        // governance event: the UI only offers legal ones. Refuse quietly by
        // returning the unchanged finding rather than corrupting the lifecycle.
        if (
          opportunity.status !== req.status &&
          !canTransitionOpportunity(opportunity.status, req.status)
        ) {
          return opportunity;
        }
        const note = req.note?.trim() || `Marked ${req.status.replace(/_/g, ' ')}.`;
        deps.audit('opportunity.status', opportunity.id, `${opportunity.title}: ${req.status}`);
        return commit(opportunity, req.status, note);
      },
    },

    {
      channel: IpcChannel.OpportunityExecute,
      schema: OpportunityExecuteRequest,
      audit: true,
      handler: async (p): Promise<OpportunityExecuteResult> => {
        const req = p as OpportunityExecuteRequest;

        /* 0 — May this person act AT ALL? --------------------------------
         *
         * First, before anything is read or written. This ordering is
         * load-bearing, not tidiness: raising a hold WRITES a HoldRecord, a
         * Decision Record and an audit entry, all keyed by a caller-supplied
         * id. With the permission check second, an account holding only
         * `procurement:read` could POST 2,000 invented ids and — because the
         * hold store evicts oldest-first at its cap — flush every real hold
         * out of the governance queue. The refusal below is generic for
         * exactly the same reason: naming the opportunity would confirm
         * whether an arbitrary id corresponds to a real finding.
         */
        if (!deps.canExecute()) {
          const hold = deps.raiseHold({
            ...permissionMissingHold({
              action: 'acting on an opportunity',
              permission: EXECUTE_PERMISSION,
              heldPermissions: deps.heldPermissions(),
              actorLabel: deps.actorLabel(),
            }),
            title: 'Cannot act on opportunities',
            // Fixed subject → one hold per actor, however many ids are tried.
            subject: `opportunity-action/${EXECUTE_PERMISSION}`,
            requestedAction: 'Run an opportunity action plan',
          });
          return {
            ok: false,
            message: `You do not hold ${EXECUTE_PERMISSION}, so NeuroPause did not act.`,
            hold,
            created: null,
            opportunity: null,
          };
        }

        const before = deps.decisions.get(req.id);
        const opportunity = findLive(req.id);

        /* 1 — Does the finding still hold? ------------------------------- */
        if (!opportunity) {
          // The most important refusal in the subsystem. The button existed
          // because a finding existed; the finding is gone, so the
          // justification is gone with it. Proceeding here would create an RFQ
          // whose stated reason is no longer true.
          const hold = deps.raiseHold({
            ...insufficientEvidenceHold({
              objective: 'act on this opportunity',
              available: before
                ? [`You marked it "${before.status}" on ${before.at}.`]
                : ['The opportunity was on screen when the action was requested.'],
              missing: [
                'Re-running the analysis against the current purchase orders no longer produces this finding. The orders behind it have changed, been cancelled, or been corrected since the page was loaded.',
              ],
              resolution:
                'Reload Opportunities to see the current findings. If the price gap is real it will reappear with its evidence.',
            }),
            title: 'The evidence for this opportunity no longer holds',
            subject: `opportunity/${req.id}`,
            requestedAction: 'Run the action plan for an opportunity',
          });
          // There is no finding object to attach to, but there IS a stored
          // decision — link the hold to it so the trail survives.
          if (before) {
            deps.decisions.set({ ...before, holdId: hold.id });
          }
          return {
            ok: false,
            message:
              'This opportunity is no longer supported by the current purchase orders, so NeuroPause did not act on it.',
            hold,
            created: null,
            opportunity: null,
          };
        }

        const subject = `opportunity/${opportunity.id} (${opportunity.title})`;
        const requestedAction = `Create an RFQ for ${opportunity.plan.executable?.product ?? 'this product'}`;

        /* 2 — Has this finding been accepted? -----------------------------
         *
         * The UI only shows the button on an accepted finding, but the UI is
         * not the boundary. Without this, executing a REJECTED id would create
         * a real RFQ and silently un-dismiss a finding the user had explicitly
         * set aside — the system overruling a decision it asked for.
         */
        if (opportunity.status !== 'accepted' && opportunity.status !== 'in_progress') {
          return {
            ok: false,
            message:
              opportunity.status === 'rejected'
                ? 'You set this opportunity aside. Bring it back and accept it before running the plan.'
                : 'Accept this opportunity before running its plan.',
            hold: null,
            created: null,
            opportunity,
          };
        }

        const executable = opportunity.plan.executable;
        if (!executable) {
          return {
            ok: false,
            message: 'This opportunity has no action NeuroPause can perform for you.',
            hold: null,
            created: null,
            opportunity,
          };
        }

        /* 3 — Does the thing we would write into still exist? ------------ */
        if (!deps.rfqModuleAvailable()) {
          const hold = deps.raiseHold({
            ...unresolvedDependencyHold({
              action: 'Creating a request for quotation',
              dependencies: [
                `The ${executable.targetModuleId} module is not available in this session, so there is nowhere to put the RFQ.`,
              ],
              resolution:
                'Restart NeuroPause so the procurement modules load, then run the plan again.',
            }),
            title: `Cannot act on "${opportunity.title}"`,
            subject,
            requestedAction,
          });
          linkHold(opportunity, hold.id, 'Held: the RFQ module was not available.');
          return {
            ok: false,
            message: 'The procurement RFQ module is not available, so NeuroPause did not act.',
            hold,
            created: null,
            opportunity,
          };
        }

        /* 4 — Has someone already done this? -----------------------------
         *
         * Not a hold: a hold says "something must be resolved before this can
         * proceed", and nothing must. But equally NOT an execution. The match
         * is on product alone, so the open RFQ may have been raised years ago
         * for an unrelated reason by someone else — claiming it as this
         * finding's `executionRef`, or returning it as `created`, would be
         * NeuroPause taking credit for work it did not do and cannot vouch
         * for. It is reported as a fact about the world and nothing is
         * persisted.
         */
        const existing = deps.openRfqFor(executable.product);
        if (existing) {
          return {
            ok: false,
            message: `${existing.label} is already open for ${executable.product}, so NeuroPause did not create a second one. If that RFQ is not about this price gap, close or award it first.`,
            hold: null,
            created: null,
            opportunity,
          };
        }

        /* 5 — Act. ------------------------------------------------------- */
        let created: CreatedRecord;
        try {
          created = await deps.createRfq({
            product: executable.product,
            quantity: executable.quantity,
            warehouse: executable.warehouse,
            notes: `Raised from an Opportunity: ${opportunity.finding}`,
          });
        } catch (error) {
          // The registry's own RBAC is the second gate; if it refuses here, it
          // has already raised its own permission hold via `onPermissionRefused`.
          const hold = deps.raiseHold({
            ...unresolvedDependencyHold({
              action: 'Creating a request for quotation',
              dependencies: [`The procurement module refused the write: ${String(error)}`],
              resolution: 'Resolve the refusal above, then run the plan again.',
            }),
            title: `Could not create the RFQ for "${opportunity.title}"`,
            subject,
            requestedAction,
          });
          linkHold(opportunity, hold.id, 'Held: the procurement module refused the write.');
          return {
            ok: false,
            message: 'NeuroPause could not create the RFQ. Nothing was changed.',
            hold,
            created: null,
            opportunity,
          };
        }

        /* 6 — Verify by reading it back. --------------------------------- */
        const readBack = deps.readRfq(created.recordId);
        if (!readBack) {
          // The write reported success and the record is not there. Saying
          // "done" here is the exact failure this hold exists to prevent: the
          // user would go looking for an RFQ that does not exist, and would
          // trust the next claim less for it.
          const hold = deps.raiseHold({
            ...verificationUnavailableHold({
              action: `The RFQ for ${executable.product}`,
              expected: `a readable ${executable.targetModuleId} record with id ${created.recordId}`,
              because: 'the record could not be read back from the store after it was written',
            }),
            title: `Could not confirm the RFQ for "${opportunity.title}"`,
            subject,
            requestedAction,
            executed: 'A create was issued; whether it persisted could not be confirmed.',
          });
          linkHold(opportunity, hold.id, 'Held: the RFQ could not be read back after writing.');
          return {
            ok: false,
            message:
              'NeuroPause issued the create but could not read the RFQ back, so it will not claim the record exists. Check Procurement → RFQs.',
            hold,
            created: null,
            opportunity,
          };
        }

        const ref: OpportunityRecordRef = { moduleId: executable.targetModuleId, ...readBack };
        const record = deps.decisionRecords.record({
          actor: deps.actor(),
          requestedAction,
          subject,
          assessment: {
            // `supported` — the evidence was re-derived from live records
            // moments before the write, which is the strongest thing this
            // vocabulary can say and exactly what happened.
            risk: 'supported',
            recommendation: opportunity.recommendation,
            evidence: opportunity.evidence.map((e) => ({
              label: e.label,
              detail: e.detail,
              count: e.records.length,
            })),
            alternative: null,
          },
          outcome: 'proceeded',
          executed: `Created ${readBack.label} in ${executable.targetModuleId} for ${executable.product}, and read it back to confirm it exists.`,
          holdId: null,
        });
        deps.audit(
          'opportunity.executed',
          opportunity.id,
          `${opportunity.title}: created ${readBack.label}`,
        );

        // `in_progress`, not `completed`. NeuroPause performed step 2 of a
        // four-step plan; the quotes and the award are the user's. Marking this
        // done would claim an outcome nobody has yet.
        const updated = commit(
          opportunity,
          'in_progress',
          `Created ${readBack.label} for ${executable.product}.`,
          { decisionRecordId: record.id, executionRef: ref },
        );

        return {
          ok: true,
          message: `Created ${readBack.label} for ${executable.product}. Add quotes from both suppliers to compare them properly.`,
          hold: null,
          created: ref,
          opportunity: updated,
        };
      },
    },
  ];

  return { handlers };
}
