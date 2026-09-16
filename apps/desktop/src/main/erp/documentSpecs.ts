/**
 * Phase 6 — Which LIVE modules adopt document behaviour, and what they post.
 *
 * Each entry binds a real registered module id to its line semantics, its
 * accounting effect, and (where relevant) an approval policy. This is the whole
 * adoption surface: adding a module is a data change here, not new logic.
 *
 * Deliberately NOT included:
 *   - `finance-journal-entries` — the GL already has a real, balance-guarded
 *     line model (`GlJournalLine`). A second line model over the same documents
 *     would create a divergent accounting truth.
 *   - Register/snapshot modules (aging, ratios, valuation, forecasts) — they are
 *     derived reports, not documents.
 *   - Master-data modules (customers, suppliers, products, employees) — they
 *     have no lines.
 */
import type { DocumentSpec } from './documentAdapter';
import { DEFAULT_SPEND_POLICY, type ApprovalPolicy } from './approvalEngine';
import {
  deriveCogsPosting,
  deriveGoodsReceiptPosting,
  deriveMaterialIssuePosting,
  deriveProductionCompletionPosting,
} from './postingRules';

/** Field on a receipt line carrying the agreed purchase price, if stamped. */
function unitCostOf(line: { unitPrice: number }): number {
  return line.unitPrice;
}

/**
 * Approval for supplier bills. Separate from the spend policy so an operator can
 * tune payment authority independently of purchasing authority — and so the
 * creator of a purchase cannot also wave through its payment.
 */
export const BILL_APPROVAL_POLICY: ApprovalPolicy = {
  id: 'bill-default',
  documentType: 'bill',
  steps: [
    { id: 'ap-review', label: 'Accounts payable review', roles: ['finance', 'admin'] },
    { id: 'finance-controller', label: 'Controller approval', roles: ['finance', 'admin'], minAmount: 100_000 },
  ],
  sod: ['creator_cannot_approve', 'requester_cannot_approve_own_payment'],
};

export const DOCUMENT_SPECS: readonly DocumentSpec[] = [
  // ── Procurement ────────────────────────────────────────────────────────
  {
    moduleId: 'procurement-orders',
    documentType: 'purchaseOrder',
    editPermission: 'procurement:manage',
    approval: {
      policy: DEFAULT_SPEND_POLICY,
      amountField: 'total',
      // A PO may not be approved or issued without satisfying the spend policy.
      gatedStatuses: ['approved', 'issued', 'sent'],
    },
  },
  {
    moduleId: 'procurement-receipts',
    documentType: 'goodsReceipt',
    editPermission: 'procurement:manage',
    postOn: {
      // Stock arrives and a liability accrues before the invoice does.
      received: (ctx) =>
        deriveGoodsReceiptPosting({
          receiptId: ctx.record.id,
          lines: ctx.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPrice: unitCostOf(l) })),
        }),
      completed: (ctx) =>
        deriveGoodsReceiptPosting({
          receiptId: ctx.record.id,
          lines: ctx.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPrice: unitCostOf(l) })),
        }),
    },
  },
  {
    moduleId: 'finance-vendor-bills',
    documentType: 'bill',
    // Finance modules share the coarse `operations:*` scope (see PHASE-6-RECON §2).
    editPermission: 'operations:manage',
    approval: {
      policy: BILL_APPROVAL_POLICY,
      amountField: 'total',
      gatedStatuses: ['approved', 'posted', 'paid'],
    },
    // ERP Session 13: the supplier-bill POSTING leg is RETIRED. Vendor-bill GL
    // posting now has ONE authoritative live owner — the finance vendor-bill path
    // (`handleVendorBillChangeForGl`): a PO-sourced goods bill relieves GRNI via
    // the Session 11/12 line-level three-way match; a service bill books
    // Operating Expense. The former adapter `postOn.posted` leg
    // (`deriveSupplierBillPosting`) never fired in production — the document
    // adapter keys `postOn` on the record-level status, which is always 'active',
    // never the domain 'posted' — so removing it changes no live posting and
    // eliminates the only mechanism that could ever have become a second posting
    // owner. The pure derivation remains unit-tested in `erp/erp.test.ts`.
    // Approval gating (a separate, live mechanism) is unchanged.
  },

  // ── Sales ──────────────────────────────────────────────────────────────
  { moduleId: 'sales-quotes', documentType: 'salesQuote', editPermission: 'sales:manage' },
  { moduleId: 'sales-orders', documentType: 'salesOrder', editPermission: 'sales:manage' },
  {
    moduleId: 'warehouse-shipping',
    documentType: 'delivery',
    editPermission: 'warehouse:manage',
    postOn: {
      // Stock leaves and becomes cost of sale — the missing half of gross margin.
      shipped: (ctx) =>
        deriveCogsPosting({
          dispatchId: ctx.record.id,
          method: 'standard',
          lines: ctx.lines.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
            unitCost: l.unitPrice > 0 ? l.unitPrice : null,
          })),
        }),
      dispatched: (ctx) =>
        deriveCogsPosting({
          dispatchId: ctx.record.id,
          method: 'standard',
          lines: ctx.lines.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
            unitCost: l.unitPrice > 0 ? l.unitPrice : null,
          })),
        }),
    },
  },
  // Revenue/receivable already reach the GL through the existing invoice module
  // (`invoiceModule` → `handleInvoiceChangeForGl`). Lines are adopted here for
  // correct multi-line invoicing; posting is deliberately left to that engine.
  // The Invoices module REAL id is 'finance' (FINANCE_MODULE_ID). This spec
  // shipped naming 'finance-invoices' -- a module that does not exist -- so
  // invoice line-item adoption silently never attached on a running device.
  // Same drift class the relationship boot check caught; fixed with it.
  { moduleId: 'finance', documentType: 'invoice', // Finance modules share the coarse `operations:*` scope (see PHASE-6-RECON §2).
    editPermission: 'operations:manage' },

  // ── Manufacturing ──────────────────────────────────────────────────────
  {
    moduleId: 'manufacturing-executions',
    documentType: 'goodsReceipt', // material issue: quantity movement, cost from stock
    editPermission: 'manufacturing:manage',
    postOn: {
      in_progress: (ctx) =>
        deriveMaterialIssuePosting({
          productionOrderId: ctx.record.id,
          lines: ctx.lines.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
            unitCost: l.unitPrice > 0 ? l.unitPrice : null,
          })),
        }),
      completed: (ctx) =>
        deriveProductionCompletionPosting({
          productionOrderId: ctx.record.id,
          wipAccumulated: numberField(ctx.record.fields.wipAccumulated, 0),
          standardCostOfOutput: numberField(ctx.record.fields.standardCost, 0),
        }),
    },
  },
];

function numberField(raw: unknown, fallback: number): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback;
}

/** Module ids that adopt document behaviour. Everything else is untouched. */
export const ADOPTED_MODULE_IDS: readonly string[] = DOCUMENT_SPECS.map((s) => s.moduleId);
