/**
 * The adapter between the ERP document engines and the module registry.
 *
 * Everything here already existed and worked; none of it was reachable. The
 * line store, the totals derivation, the approval policy engine and its four
 * segregation-of-duties rules were registered against 8 live modules and had
 * zero callers outside their own tests. This file is the missing joint — it
 * translates the engines' internal types into the shared view types the
 * registry and renderer speak, and it supplies the two things the engines
 * always needed from outside and never had:
 *
 *  1. **Persistence for approval decisions.** `applyDecision` is pure; it hands
 *     back a new list and expects the caller to keep it. Nobody did, so every
 *     evaluation started from an empty history and no document could ever
 *     reach `approved`.
 *  2. **An identity for the approver.** Role eligibility and SoD both need to
 *     know who is acting. The integration was constructed with
 *     `actor: () => null`, which disqualifies everyone.
 *
 * No business rule lives here. Amounts, eligibility, SoD and state all come
 * from `approvalEngine`; totals come from `documentLines`. This file only
 * carries values across the boundary.
 */
import type {
  DocumentApprovalResult,
  DocumentApprovalView,
  DocumentLineView,
  DocumentLinesResult,
  DocumentLinesView,
  EnterpriseEntity,
} from '@neuropause/shared';
import type {
  DocumentBridge,
  DocumentLineInputLike,
} from '../enterprise/framework/enterpriseModule';
import type { ApprovalStep, Approver } from './approvalEngine';
import { canApprove } from './approvalEngine';
import type { DocumentIntegration } from './documentAdapter';
import type { DocumentLine } from './documentLines';
import { computeLineTotals } from './documentLines';
import type { ApprovalStore } from './approvalStore';

const UNSUPPORTED: DocumentLinesView = {
  supported: false,
  documentType: null,
  editPermission: null,
  lines: [],
  totals: null,
};

const NOT_REQUIRED: DocumentApprovalView = {
  required: false,
  state: 'not_required',
  amount: 0,
  requiredSteps: [],
  satisfiedStepIds: [],
  nextStep: null,
  reasons: [],
  decisions: [],
  canDecide: false,
  blockedReason: null,
  gatedStatuses: [],
};

function toLineView(line: DocumentLine): DocumentLineView {
  // Per-line money is DERIVED, never stored — the same rule the document
  // totals follow. Recomputing here (rather than persisting) is what keeps a
  // line's arithmetic from drifting out of step with the document's.
  const money = computeLineTotals(line);
  return {
    id: line.id,
    lineNo: line.lineNo,
    description: line.description,
    quantity: line.quantity,
    unit: line.unit,
    unitPrice: line.unitPrice,
    discountPercent: line.discountPercent,
    discountAmount: line.discountAmount,
    taxRatePercent: line.taxRatePercent,
    currency: line.currency,
    gross: money.gross,
    discount: money.discount,
    taxable: money.taxable,
    tax: money.tax,
    total: money.total,
    productId: line.productId,
    accountId: line.accountId,
    warehouseId: line.warehouseId,
  };
}

function toStepView(step: ApprovalStep): DocumentApprovalView['requiredSteps'][number] {
  return {
    id: step.id,
    label: step.label,
    roles: [...step.roles],
    minAmount: step.minAmount ?? null,
  };
}

export interface DocumentBridgeDeps {
  integration: DocumentIntegration;
  approvals: ApprovalStore;
  /** The signed-in actor, as the approval engine needs to see them. */
  currentApprover: () => Approver | null;
}

export function createDocumentBridge(deps: DocumentBridgeDeps): DocumentBridge {
  const { integration, approvals } = deps;

  const linesView = (moduleId: string, documentId: string): DocumentLinesView => {
    const spec = integration.specFor(moduleId);
    if (!spec) return UNSUPPORTED;
    const totals = integration.totalsFor(moduleId, documentId);
    return {
      supported: true,
      documentType: spec.documentType,
      editPermission: spec.editPermission ?? null,
      lines: integration.linesFor(moduleId, documentId).map(toLineView),
      totals: totals
        ? {
            moduleId: totals.moduleId,
            documentId: totals.documentId,
            documentType: totals.documentType,
            lineCount: totals.lineCount,
            currency: totals.currency,
            currencyMismatch: totals.currencyMismatch,
            gross: totals.gross,
            discount: totals.discount,
            taxable: totals.taxable,
            tax: totals.tax,
            total: totals.total,
          }
        : null,
    };
  };

  const approvalView = (moduleId: string, record: EnterpriseEntity): DocumentApprovalView => {
    const spec = integration.specFor(moduleId);
    if (!spec?.approval) return NOT_REQUIRED;

    const decisions = approvals.forDocument(moduleId, record.id);
    const status = integration.approvalStatus(moduleId, record, decisions);
    if (!status) return NOT_REQUIRED;

    // Whether THIS person may decide the next step. Two distinct refusals, and
    // the UI needs to tell them apart: "nobody is signed in" is a different
    // problem from "you raised this, so you cannot approve it".
    const approver = deps.currentApprover();
    let canDecide = false;
    let blockedReason: string | null = null;
    if (!status.nextStep) {
      blockedReason = null;
    } else if (!approver) {
      blockedReason = 'Sign in to record an approval decision.';
    } else {
      // `canApprove` checks role eligibility AND segregation of duties in one
      // pass. Re-deriving either here would let the button's enabled state
      // drift from what the engine will actually permit — the worst kind of
      // governance bug, because it looks like it worked.
      const verdict = canApprove(
        spec.approval.policy,
        {
          documentType: spec.documentType,
          documentId: record.id,
          amount: integration.approvalAmountFor(moduleId, record),
          createdBy: String(record.metadata.createdBy ?? record.createdBy ?? ''),
          approvals: decisions,
        },
        status.nextStep,
        approver,
      );
      canDecide = verdict.allowed;
      // The engine's own words. Paraphrasing a governance refusal into
      // "not allowed" throws away the only part a person can act on.
      blockedReason = verdict.allowed
        ? null
        : (verdict.violations[0]?.message ??
          `This step requires one of: ${status.nextStep.roles.join(', ')}.`);
    }

    return {
      required: true,
      state: status.state,
      amount: integration.approvalAmountFor(moduleId, record),
      requiredSteps: status.requiredSteps.map(toStepView),
      satisfiedStepIds: [...status.satisfiedStepIds],
      nextStep: status.nextStep ? toStepView(status.nextStep) : null,
      reasons: [...status.reasons],
      decisions: decisions.map((d) => ({
        stepId: d.stepId,
        userId: d.userId,
        decision: d.decision,
        at: d.at,
        ...(d.note === undefined ? {} : { note: d.note }),
      })),
      canDecide,
      blockedReason,
      gatedStatuses: [...spec.approval.gatedStatuses],
    };
  };

  return {
    linesView,

    async setLines(moduleId, documentId, lines: readonly DocumentLineInputLike[]) {
      const result = await integration.setLines(moduleId, documentId, lines);
      return {
        ok: result.ok,
        errors: result.errors,
        view: result.ok ? linesView(moduleId, documentId) : null,
      } satisfies DocumentLinesResult;
    },

    approvalView,

    async decide(moduleId, record, stepId, decision, note) {
      const approver = deps.currentApprover();
      if (!approver) {
        return {
          ok: false,
          error: 'Sign in to record an approval decision.',
          approval: approvalView(moduleId, record),
        };
      }
      const existing = approvals.forDocument(moduleId, record.id);
      const outcome = integration.approve(
        moduleId,
        record,
        stepId,
        approver,
        decision,
        existing,
        note,
      );
      // Persist ONLY on success. A refused decision — wrong role, or SoD —
      // must leave no trace of having been accepted; the refusal is already
      // audited inside the engine.
      if (outcome.ok) approvals.replace(moduleId, record.id, outcome.approvals);
      return {
        ok: outcome.ok,
        error: outcome.error,
        approval: approvalView(moduleId, record),
      } satisfies DocumentApprovalResult;
    },
  };
}
