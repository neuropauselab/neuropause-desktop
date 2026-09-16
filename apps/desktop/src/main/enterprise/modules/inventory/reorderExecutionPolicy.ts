/**
 * S88 — Reorder governance POLICY primitives (pure decision layer; creates NOTHING).
 *
 * S87 identified five operator-policy decisions before a governed reorder-execution command could be
 * built. S88 closes them by REUSING existing project decisions — no business value is invented:
 *
 *   D1 Recommendation identity / lineage  — a deterministic purchase-request number per
 *      (S86 report number, sku), mirroring the ERP Session-3 MRP seam `mrpPurchaseRequestNumber`.
 *      The number IS the identity; correlation lineage is the existing Session-1 spine.
 *   D2 Recommendation-scoped idempotency  — the SAME Session-3 guard: if the deterministic number
 *      already exists (in any non-deleted state), do not draft again ⇒ one recommendation drafts at
 *      most one PR. (The durable command journal adds command-level replay dedup; the auto-reorder
 *      open-supply position is the third, existing guard.)
 *   D3 Stale-recommendation policy        — deny-by-default: re-run the existing pure `assessReorder`
 *      against the LIVE position at execution; fail closed if it is no longer triggered or the
 *      recommended quantity changed. Regeneration is required before a stale row can execute.
 *   D4 Quantity override policy           — none. The quantity is the canonical `assessReorder`
 *      value, immutable (the MRP/auto-reorder seams never override it). A live change ⇒ stale ⇒
 *      fail closed. No MOQ/EOQ/order-multiple invented.
 *   D5 Supplier-at-reorder policy         — a PR draft carries NO supplier (the existing PR
 *      lifecycle: supplier is chosen at PO conversion). No product→supplier link is invented.
 *
 * This module is a PURE decision layer, exactly like `deriveMrpDraftRequests`: it DECIDES what a
 * future governed execution command WOULD draft, and creates nothing. It does not import the command
 * bus, does not draft a PR, moves no stock, posts no GL, and is not wired to any IPC channel. Turning
 * on execution is a SEPARATE, later gate (see DECISION-REGISTER-S88).
 */
import type { Product } from '@neuropause/shared';
import { assessReorder } from '@neuropause/shared';

/** D1 — the deterministic PR-number prefix that identifies a reorder-execution opportunity. */
export const REORDER_EXECUTION_PR_PREFIX = 'PR-REORDER';

/**
 * D1 identity — the deterministic purchase-request number for one S86 report row.
 * The same (reportNumber, sku) always maps to the same number, so it is BOTH the lineage key and the
 * idempotency guard (Session-3 pattern). Reused, not invented.
 */
export function reorderExecutionRequestNumber(reportNumber: string, sku: string): string {
  return `${REORDER_EXECUTION_PR_PREFIX}-${reportNumber}-${sku}`;
}

export type ReorderExecutability =
  | 'executable'
  | 'already-drafted'        // D2 — the deterministic number already exists
  | 'not-required'           // nothing to draft (the row did not recommend a reorder)
  | 'stale-not-triggered'    // D3 — the live position no longer warrants a reorder
  | 'stale-quantity-changed'; // D3/D4 — the recommended quantity changed since the report

export interface ReorderExecutionDecision {
  sku: string;
  /** D1 identity + D2 idempotency key. */
  requestNumber: string;
  /** D4 — the immutable recommended quantity carried by the S86 report row. */
  expectedQuantity: number;
  /** What `assessReorder` currently suggests (0 when not triggered). */
  currentQuantity: number;
  /** Fail-closed: true ONLY for `status === 'executable'`. */
  executable: boolean;
  status: ReorderExecutability;
  reason: string;
  /** D5 — a reorder PR draft never carries a supplier; supplier is a PO-stage decision. */
  supplierRequired: false;
}

/**
 * Pure decision: is this S86 report row executable RIGHT NOW, and under what deterministic PR number?
 * Fail-closed by construction — `executable` is true only when the recommendation is still live AND its
 * quantity is unchanged AND no PR already exists for it. Creates nothing; reuses `assessReorder` and the
 * Session-3 existing-number idempotency guard.
 */
export function deriveReorderExecutionDecision(input: {
  /** The immutable S86 decision report's number (the recommendation generation identity). */
  reportNumber: string;
  /** The LIVE product record (re-read at execution time — the stale check reads current state). */
  product: Product;
  /** The LIVE open supply for the product (open PRs + POs) at execution time. */
  openSupply: number;
  /** The quantity the S86 report row recommended (immutable — D4). */
  expectedQuantity: number;
  /** Every existing non-deleted PR number, for the D2 idempotency guard. */
  existingRequestNumbers: ReadonlySet<string>;
}): ReorderExecutionDecision {
  const { reportNumber, product, openSupply, expectedQuantity, existingRequestNumbers } = input;
  const requestNumber = reorderExecutionRequestNumber(reportNumber, product.sku);
  const a = assessReorder({ product, openSupply });
  const base = {
    sku: product.sku,
    requestNumber,
    expectedQuantity,
    currentQuantity: a.triggered ? a.suggestedQuantity : 0,
    supplierRequired: false as const,
  };

  // Nothing to draft: the report row did not recommend a reorder (deny-by-default).
  if (!(expectedQuantity > 0)) {
    return { ...base, executable: false, status: 'not-required', reason: 'This recommendation did not require a reorder — there is nothing to execute.' };
  }
  // D2 idempotency (Session-3 guard): the deterministic number already exists ⇒ at most one PR.
  if (existingRequestNumbers.has(requestNumber)) {
    return { ...base, executable: false, status: 'already-drafted', reason: `A purchase request (${requestNumber}) already exists for this recommendation — one recommendation drafts at most one purchase request.` };
  }
  // D3 stale (deny-by-default): re-assess the live position; fail closed if no longer triggered.
  if (!a.triggered) {
    return { ...base, executable: false, status: 'stale-not-triggered', reason: 'The inventory position no longer warrants a reorder — the recommendation is stale. Regenerate the recommendation before executing.' };
  }
  // D3/D4: the executed quantity must equal the recommendation's; a live change is stale, not an override.
  if (a.suggestedQuantity !== expectedQuantity) {
    return { ...base, executable: false, status: 'stale-quantity-changed', reason: `The recommended quantity changed (${expectedQuantity} → ${a.suggestedQuantity}) since the recommendation was generated — the recommendation is stale. Regenerate before executing.` };
  }
  return { ...base, executable: true, status: 'executable', reason: `Executable: draft ${requestNumber} for ${expectedQuantity} unit(s) of ${product.sku}. Supplier is chosen at PO conversion (no supplier on the draft).` };
}
