/**
 * S86 — Governed Reorder DECISION-READINESS Intelligence: the PURE model.
 *
 * This extends the S85 reorder RECOMMENDATION into a decision-readiness view WITHOUT executing
 * anything and WITHOUT inventing any business policy. Every field is either canonical-executable,
 * canonical-informational, policy-derivable from EXISTING machinery, or honestly marked
 * missing/undefined (see DECISION-MEMO-S86). It NEVER drafts a PR/PO and NEVER calls
 * `runReorderCheck` (not imported).
 *
 * Reuse (source-wins):
 *   • S85 `deriveReorderRecommendations` — attention + suggestedQuantity + position (assessReorder).
 *   • `applicableSteps(DEFAULT_SPEND_POLICY, amount)` — the EXISTING spend-policy engine derives the
 *     required approval steps for an estimated order value. No new approval engine.
 *   • `product.purchaseCost` — the canonical purchase cost (the only pricing on the product master).
 *
 * Honest boundaries (NOT invented):
 *   • The product master has NO preferred-supplier / lead-time / MOQ / order-multiple fields, so
 *     supplier selection, lead-time demand, MOQ and order multiples are UNAVAILABLE — surfaced as
 *     blockers, never guessed.
 *   • Automatic execution (auto-PR authority) is policy-undefined → `executionReadiness` is
 *     fail-closed `BLOCKED_UNDEFINED_POLICY` on every row.
 *
 * Electron-free and store-free: every input is a plain array, so it unit-tests directly.
 */
import type { Product, Shipping, EnterpriseEntity } from '@neuropause/shared';
import { deriveReorderRecommendations } from './demandReorderModel';
import { applicableSteps, DEFAULT_SPEND_POLICY } from '../../../erp/approvalEngine';

/** Source-driven readiness vocabulary (no invented statuses). */
export type ReorderReadinessStatus =
  | 'REORDER_NOT_REQUIRED'
  | 'READY_FOR_OPERATOR_REVIEW'
  | 'SUPPLIER_DATA_MISSING';

/** Execution is policy-undefined; this is fail-closed on every row (S86 never executes). */
export const EXECUTION_READINESS = 'BLOCKED_UNDEFINED_POLICY' as const;

export interface ReorderDecisionRow {
  sku: string;
  availableStock: number;
  openSupply: number;
  position: number;
  reorderLevel: number;
  targetLevel: number;
  suggestedQuantity: number;
  demandDirection: string;
  demandSufficient: boolean;
  /** Canonical purchase cost from the product master (0 when unset). */
  unitCost: number;
  /** suggestedQuantity × unitCost when reorder is triggered and cost > 0; else null (undeterminable). */
  estimatedOrderValue: number | null;
  /** Required approval step labels for the estimated value, from the EXISTING DEFAULT_SPEND_POLICY. */
  requiredApprovalSteps: string[];
  readinessStatus: ReorderReadinessStatus;
  /** Automatic execution is policy-undefined — fail-closed on every row. */
  executionReadiness: typeof EXECUTION_READINESS;
  blockers: string[];
  reason: string;
}

export interface ReorderDecisionSnapshot {
  asOfDate: string;
  skuCount: number;
  reorderRequiredCount: number;
  readyForReviewCount: number;
  supplierDataMissingCount: number;
  notRequiredCount: number;
  /** True always — no automatic execution path is authorized (fail-closed). */
  executionBlocked: boolean;
  rows: ReorderDecisionRow[];
}

interface DecisionInputs {
  products: Product[];
  purchaseRequests: EnterpriseEntity[];
  purchaseOrders: EnterpriseEntity[];
  shipments: Shipping[];
}

const BLOCKER_NO_SUPPLIER =
  'No preferred supplier on the product master — supplier selection is an operator decision (unavailable canonical field).';
const BLOCKER_EXECUTION =
  'Automatic execution (auto-PR) is policy-undefined — a governed execution command requires operator-defined authority (DECISION-MEMO-S86).';

/**
 * Derive reorder decision-readiness for every active product. Deterministic; read-only; empty in →
 * empty out. Reuses the S85 recommendation and the existing spend-policy engine; invents nothing.
 */
export function deriveReorderDecisionReadiness(
  input: DecisionInputs,
  asOfDate: string,
): ReorderDecisionSnapshot {
  const s85 = deriveReorderRecommendations(input, asOfDate);
  const costBySku = new Map(input.products.map((p) => [p.sku, Number(p.purchaseCost) || 0]));

  const rows: ReorderDecisionRow[] = s85.rows.map((r) => {
    const triggered = r.attention === 'reorder';
    const unitCost = costBySku.get(r.sku) ?? 0;
    const demandSufficient = r.demandDirection !== 'insufficient-data';
    const blockers: string[] = [];

    let readinessStatus: ReorderReadinessStatus;
    let estimatedOrderValue: number | null = null;
    let requiredApprovalSteps: string[] = [];

    if (!triggered) {
      readinessStatus = 'REORDER_NOT_REQUIRED';
    } else if (unitCost <= 0) {
      // Cannot value the order → cannot derive the approval requirement. Fail-closed, not guessed.
      readinessStatus = 'SUPPLIER_DATA_MISSING';
      blockers.push('No purchase cost on the product — order value and approval requirement are undeterminable.');
      blockers.push(BLOCKER_NO_SUPPLIER);
    } else {
      estimatedOrderValue = Math.round(r.recommendedQuantity * unitCost);
      requiredApprovalSteps = applicableSteps(DEFAULT_SPEND_POLICY, estimatedOrderValue).map((s) => s.label);
      readinessStatus = 'READY_FOR_OPERATOR_REVIEW';
      blockers.push(BLOCKER_NO_SUPPLIER); // supplier still an operator choice, but review can proceed
    }
    if (triggered && !demandSufficient) {
      blockers.push('Demand history is insufficient for a demand-informed decision (informational).');
    }
    if (triggered) blockers.push(BLOCKER_EXECUTION);

    const reason =
      readinessStatus === 'REORDER_NOT_REQUIRED'
        ? r.reason
        : readinessStatus === 'SUPPLIER_DATA_MISSING'
          ? `Reorder required (${r.recommendedQuantity} units) but supplier/pricing data is missing to scope an order.`
          : `Reorder required: order ~${r.recommendedQuantity} units (est. value ${estimatedOrderValue}); ${requiredApprovalSteps.length} approval step(s) would apply under the default spend policy. Operator review required before any execution.`;

    return {
      sku: r.sku,
      availableStock: r.availableStock,
      openSupply: r.openSupply,
      position: r.position,
      reorderLevel: r.reorderLevel,
      targetLevel: r.targetLevel,
      suggestedQuantity: r.recommendedQuantity,
      demandDirection: r.demandDirection,
      demandSufficient,
      unitCost,
      estimatedOrderValue,
      requiredApprovalSteps,
      readinessStatus,
      executionReadiness: EXECUTION_READINESS,
      blockers,
      reason,
    };
  });

  const snap: ReorderDecisionSnapshot = {
    asOfDate,
    skuCount: rows.length,
    reorderRequiredCount: 0,
    readyForReviewCount: 0,
    supplierDataMissingCount: 0,
    notRequiredCount: 0,
    executionBlocked: true, // S86 authorizes NO automatic execution — fail-closed by construction
    rows,
  };
  for (const r of rows) {
    if (r.readinessStatus === 'REORDER_NOT_REQUIRED') snap.notRequiredCount += 1;
    else {
      snap.reorderRequiredCount += 1;
      if (r.readinessStatus === 'READY_FOR_OPERATOR_REVIEW') snap.readyForReviewCount += 1;
      else snap.supplierDataMissingCount += 1;
    }
  }
  return snap;
}
