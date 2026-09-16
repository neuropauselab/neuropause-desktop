/**
 * S82 — Procurement Spend Analytics + Supplier Risk: the PURE model.
 *
 * This file invents NOTHING. It joins the records the procurement + finance modules already
 * keep and calls the EXISTING derivations — every number a row carries is produced by a
 * formula that already ships, and the row's `reasons` say which one:
 *
 *   • PO money      — `calculatePurchaseTotal` (shared/types/procurement.ts), never the stored total.
 *   • ORDERED       — POs not draft/cancelled: the exact set `deriveProcurementInsights` uses
 *                     for `procurementSpend` (shared/types/procurement.ts).
 *   • COMMITTED     — `COMMITTED_PO_STATUSES` (shared/types/budgetControls.ts:30 — approved/sent/received).
 *   • OPEN          — `OPEN_PO_STATUSES` (shared/types/procurement.ts:47 — draft/approved/sent).
 *   • INVOICED      — approved + paid vendor bills (booked payables; drafts merely created,
 *                     cancelled dead — the same exclusion convention, and only approved bills
 *                     age in `deriveApAging`).
 *   • PAID          — cleared vendor payments (the settlement source of truth, vendorPayments.ts).
 *   • RISK          — `calculateVendorRisk` (shared/types/procurement.ts:278) fed with REAL
 *                     DeliveryRow evidence built from received goods receipts exactly the way
 *                     `deriveProcurementInsights` builds them — scoped to the supplier the row
 *                     is about, so no vendor wears another vendor's deliveries.
 *   • HIGH RISK     — score >= 60, the repo's existing cutoff (`deriveProcurementInsights`,
 *                     shared/types/procurement.ts:405). Not a new policy.
 *   • CONTRACT      — `contractWindowState` / `contractDaysRemaining` (shared/types/vendorContracts.ts);
 *                     expiring-soon = inside the contract's own `renewalNoticeDays` (evaluateContractGate's rule).
 *
 * Supplier joins are by TRIMMED NAME with the scorecard's '(unattributed)' fallback
 * (deriveSupplierPerformance precedent); missing names are tolerated AND counted, never hidden.
 * Periods are calendar months of the PO date — a calendar convention, not a policy.
 *
 * Electron-free and store-free: every input is a plain array, so it unit-tests directly.
 */
import type {
  DeliveryRow,
  GoodsReceipt,
  PurchaseOrder,
  Supplier,
  VendorBill,
  VendorPayment,
} from '@neuropause/shared';
import {
  COMMITTED_PO_STATUSES,
  OPEN_PO_STATUSES,
  calculateDeliveryPerformance,
  calculatePurchaseTotal,
  calculateVendorRisk,
  contractDaysRemaining,
  contractWindowState,
  type ContractWindowState,
} from '@neuropause/shared';

/**
 * The repo's existing high-risk cutoff: `deriveProcurementInsights` counts a vendor high-risk
 * when `calculateVendorRisk(...) >= 60` (shared/types/procurement.ts:405). Re-declared here as a
 * named constant because the source keeps it inline; the VALUE is the repo's, not a new policy.
 */
export const HIGH_RISK_SCORE_CUTOFF = 60;

const round1 = (n: number): number => Math.round(n * 10) / 10;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The scorecard's join key: trimmed supplier name, '(unattributed)' when absent. */
export function supplierKeyOf(name: string): string {
  return name.trim() || '(unattributed)';
}

/* ── spend analytics ─────────────────────────────────────────────────────── */

export interface SpendInputs {
  orders: PurchaseOrder[];
  receipts: GoodsReceipt[];
  bills: VendorBill[];
  payments: VendorPayment[];
}

export interface SpendRow {
  supplier: string;
  /** Σ calculatePurchaseTotal over POs not draft/cancelled — the procurement-spend set. */
  orderedValue: number;
  /** Σ calculatePurchaseTotal over COMMITTED_PO_STATUSES (approved/sent/received). */
  committedValue: number;
  /** Σ calculatePurchaseTotal over OPEN_PO_STATUSES (draft/approved/sent). */
  openValue: number;
  /** Posted (status 'received') goods receipts — the delivery evidence count. */
  receiptCount: number;
  /** Σ totals of approved + paid vendor bills (booked payables). */
  invoicedValue: number;
  /** Σ cleared vendor payments. */
  paidValue: number;
  poCount: number;
  billCount: number;
  /** orderedValue ÷ total orderedValue × 100 (plain arithmetic; 0 when nothing ordered). */
  spendSharePct: number;
}

export interface SpendPeriodRow {
  /** Calendar month (YYYY-MM) of the PO's created date — a calendar convention, not policy. */
  period: string;
  orderedValue: number;
  poCount: number;
}

/** Honest accounting of what the register could NOT attribute — counted, never hidden. */
export interface SpendExclusions {
  unattributedOrders: number;
  unattributedReceipts: number;
  unattributedBills: number;
  unattributedPayments: number;
  /** Ordered POs whose created date is unparseable — in totals, absent from byPeriod. */
  undatedOrders: number;
}

export interface SpendTotals {
  orderedValue: number;
  committedValue: number;
  openValue: number;
  invoicedValue: number;
  paidValue: number;
  poCount: number;
  billCount: number;
  receiptCount: number;
}

export interface SpendAnalyticsRegister {
  asOfDate: string;
  rows: SpendRow[];
  byPeriod: SpendPeriodRow[];
  totals: SpendTotals;
  supplierCount: number;
  exclusions: SpendExclusions;
}

const ORDERED = (o: PurchaseOrder): boolean => o.status !== 'draft' && o.status !== 'cancelled';
const COMMITTED = (o: PurchaseOrder): boolean =>
  (COMMITTED_PO_STATUSES as readonly string[]).includes(o.status);
const OPEN = (o: PurchaseOrder): boolean => (OPEN_PO_STATUSES as readonly string[]).includes(o.status);
const INVOICED = (b: VendorBill): boolean => b.status === 'approved' || b.status === 'paid';

/** Calendar month (YYYY-MM) of an ISO instant; null when unparseable. */
function monthOf(iso: string): string | null {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 7) : null;
}

/**
 * Derive the spend-analytics register. Deterministic; read-only; empty in → honestly empty
 * out (no zero rows are fabricated for suppliers that never transacted).
 */
export function deriveSpendAnalytics(inputs: SpendInputs, asOfDate: string): SpendAnalyticsRegister {
  const rowsByKey = new Map<string, SpendRow>();
  const rowFor = (name: string): SpendRow => {
    const key = supplierKeyOf(name);
    let row = rowsByKey.get(key);
    if (!row) {
      row = {
        supplier: key, orderedValue: 0, committedValue: 0, openValue: 0, receiptCount: 0,
        invoicedValue: 0, paidValue: 0, poCount: 0, billCount: 0, spendSharePct: 0,
      };
      rowsByKey.set(key, row);
    }
    return row;
  };
  const exclusions: SpendExclusions = {
    unattributedOrders: 0, unattributedReceipts: 0, unattributedBills: 0,
    unattributedPayments: 0, undatedOrders: 0,
  };
  const byPeriodMap = new Map<string, SpendPeriodRow>();

  for (const o of inputs.orders) {
    if (!o.supplier.trim()) exclusions.unattributedOrders += 1;
    const total = calculatePurchaseTotal(o); // the existing PO-money rule, never the stored total
    const row = rowFor(o.supplier);
    if (ORDERED(o)) {
      row.orderedValue += total;
      row.poCount += 1;
      const period = monthOf(o.createdAt);
      if (period === null) {
        exclusions.undatedOrders += 1;
      } else {
        const p = byPeriodMap.get(period) ?? { period, orderedValue: 0, poCount: 0 };
        p.orderedValue += total;
        p.poCount += 1;
        byPeriodMap.set(period, p);
      }
    }
    if (COMMITTED(o)) row.committedValue += total;
    if (OPEN(o)) row.openValue += total;
  }
  for (const r of inputs.receipts) {
    if (!r.supplier.trim()) exclusions.unattributedReceipts += 1;
    if (r.status === 'received') rowFor(r.supplier).receiptCount += 1;
    else rowFor(r.supplier); // a pending/rejected receipt still names the supplier — row, no count
  }
  for (const b of inputs.bills) {
    if (!b.vendor.trim()) exclusions.unattributedBills += 1;
    const row = rowFor(b.vendor);
    if (INVOICED(b)) {
      row.invoicedValue = round2(row.invoicedValue + b.total);
      row.billCount += 1;
    }
  }
  for (const p of inputs.payments) {
    if (!p.vendor.trim()) exclusions.unattributedPayments += 1;
    if (p.status === 'cleared') {
      const row = rowFor(p.vendor);
      row.paidValue = round2(row.paidValue + p.amount);
    }
  }

  const rows = [...rowsByKey.values()];
  const totals: SpendTotals = {
    orderedValue: 0, committedValue: 0, openValue: 0, invoicedValue: 0, paidValue: 0,
    poCount: 0, billCount: 0, receiptCount: 0,
  };
  for (const r of rows) {
    totals.orderedValue += r.orderedValue;
    totals.committedValue += r.committedValue;
    totals.openValue += r.openValue;
    totals.invoicedValue = round2(totals.invoicedValue + r.invoicedValue);
    totals.paidValue = round2(totals.paidValue + r.paidValue);
    totals.poCount += r.poCount;
    totals.billCount += r.billCount;
    totals.receiptCount += r.receiptCount;
  }
  for (const r of rows) {
    r.spendSharePct = totals.orderedValue > 0 ? round1((r.orderedValue / totals.orderedValue) * 100) : 0;
  }
  rows.sort((a, b) => b.orderedValue - a.orderedValue || a.supplier.localeCompare(b.supplier));
  const byPeriod = [...byPeriodMap.values()].sort((a, b) => a.period.localeCompare(b.period));

  return { asOfDate, rows, byPeriod, totals, supplierCount: rows.length, exclusions };
}

/* ── supplier risk register ──────────────────────────────────────────────── */

/** The minimal contract shape the register reads (the instance adapts records). */
export interface ContractInput {
  contractNumber: string;
  supplierName: string;
  /** The record's own lifecycle field (draft | active | terminated). */
  recordStatus: string;
  startDate: string;
  endDate: string;
  renewalNoticeDays: number;
}

export interface RiskInputs extends SpendInputs {
  suppliers: Supplier[];
  contracts: ContractInput[];
}

export interface SupplierRiskRow {
  supplier: string;
  /** The supplier master's own lifecycle status. */
  status: string;
  /** calculateVendorRisk (the EXISTING formula) fed this supplier's own delivery evidence. */
  riskScore: number;
  /** riskScore >= 60 — the repo's existing cutoff (procurement.ts:405). */
  highRisk: boolean;
  /** calculateDeliveryPerformance over own received receipts; null when none carry both dates. */
  deliveryPerformancePct: number | null;
  lateDeliveries: number;
  receiptCount: number;
  /** The supplier master's own lead time (the field deriveProcurementInsights averages). */
  leadTimeDays: number;
  /** Σ outstanding of APPROVED unpaid bills — the deriveApAging open-payable rule. */
  openBillExposure: number;
  openBillCount: number;
  /** contractWindowState of the supplier's active contract at as-of; 'none' when there is none. */
  contractState: ContractWindowState | 'none';
  contractDaysRemaining: number | null;
  contractExpiringSoon: boolean;
  spendSharePct: number;
  /** The evidence + which existing formula produced each number — printed, never a vibe. */
  reasons: string[];
}

export interface SupplierRiskRegister {
  asOfDate: string;
  rows: SupplierRiskRow[];
  supplierCount: number;
  highRiskCount: number;
  expiringSoonCount: number;
  openBillExposureTotal: number;
  /** Names seen in transactions with NO supplier master record — excluded (the risk formula
   *  needs master fields), named here honestly instead of being scored blind. */
  unregisteredSuppliers: string[];
}

/**
 * DeliveryRow evidence from posted receipts — the EXACT builder `deriveProcurementInsights`
 * uses (status 'received' → {expectedDate, receiptDate, quantityOrdered, quantityReceived}).
 */
export function deliveryRowsFromReceipts(receipts: GoodsReceipt[]): DeliveryRow[] {
  return receipts
    .filter((r) => r.status === 'received')
    .map((r) => ({
      expectedDate: r.expectedDate,
      receiptDate: r.receiptDate,
      quantityOrdered: r.quantityOrdered,
      quantityReceived: r.quantityReceived,
    }));
}

function parseDay(d: string): number | null {
  if (!d) return null;
  const t = Date.parse(d);
  return Number.isFinite(t) ? t : null;
}

/**
 * High-risk supplier count for the KPI seam: the register's own rule — the existing
 * `calculateVendorRisk` >= 60 over each supplier's OWN delivery evidence.
 */
export function countHighRiskSuppliers(suppliers: Supplier[], receipts: GoodsReceipt[]): number {
  return suppliers.filter((s) => {
    const own = receipts.filter((r) => supplierKeyOf(r.supplier) === supplierKeyOf(s.name));
    return calculateVendorRisk(s, deliveryRowsFromReceipts(own)) >= HIGH_RISK_SCORE_CUTOFF;
  }).length;
}

/**
 * Derive the supplier-risk register: one indicator row per REGISTERED supplier (the risk
 * formula reads master fields, so only masters can be scored). Deterministic; read-only.
 */
export function deriveSupplierRiskRegister(inputs: RiskInputs, asOfDate: string): SupplierRiskRegister {
  const spend = deriveSpendAnalytics(inputs, asOfDate);
  const spendByKey = new Map(spend.rows.map((r) => [r.supplier, r]));
  const registered = new Set(inputs.suppliers.map((s) => supplierKeyOf(s.name)));

  const rows: SupplierRiskRow[] = [];
  for (const s of inputs.suppliers) {
    const key = supplierKeyOf(s.name);
    const ownReceipts = inputs.receipts.filter((r) => supplierKeyOf(r.supplier) === key);
    const deliveryRows = deliveryRowsFromReceipts(ownReceipts);
    const dated = deliveryRows.filter((r) => r.expectedDate && r.receiptDate);
    const riskScore = calculateVendorRisk(s, deliveryRows);
    const highRisk = riskScore >= HIGH_RISK_SCORE_CUTOFF;
    const deliveryPerformancePct = dated.length > 0 ? calculateDeliveryPerformance(deliveryRows) : null;
    const lateDeliveries = dated.filter((r) => {
      const exp = parseDay(r.expectedDate);
      const rec = parseDay(r.receiptDate);
      return exp !== null && rec !== null && rec > exp;
    }).length;

    // Open payable exposure — approved unpaid bills only (deriveApAging's open-payable rule).
    const openBills = inputs.bills.filter(
      (b) => supplierKeyOf(b.vendor) === key && b.status === 'approved' && b.outstanding > 0,
    );
    const openBillExposure = round2(openBills.reduce((sum, b) => sum + b.outstanding, 0));

    // Contract standing — active contracts for this supplier (name match, evaluateContractGate's
    // case-insensitive convention); prefer an OPEN window, else the latest-ending one.
    const own = inputs.contracts.filter(
      (c) => c.recordStatus === 'active' && c.supplierName.trim().toLowerCase() === s.name.trim().toLowerCase(),
    );
    let contractState: ContractWindowState | 'none' = 'none';
    let daysRemaining: number | null = null;
    let expiringSoon = false;
    let contractNumber = '';
    if (own.length > 0) {
      const withState = own.map((c) => ({ c, state: contractWindowState(c.startDate, c.endDate, asOfDate) }));
      const open = withState.filter((w) => w.state === 'open');
      const pick =
        open.length > 0
          ? open.reduce((a, b) =>
              (contractDaysRemaining(b.c.endDate, asOfDate) ?? -1) > (contractDaysRemaining(a.c.endDate, asOfDate) ?? -1) ? b : a,
            )
          : withState.reduce((a, b) => (b.c.endDate > a.c.endDate ? b : a));
      contractState = pick.state;
      contractNumber = pick.c.contractNumber;
      if (pick.state === 'open') {
        daysRemaining = contractDaysRemaining(pick.c.endDate, asOfDate);
        const noticeDays = Math.max(pick.c.renewalNoticeDays, 0);
        expiringSoon = daysRemaining !== null && daysRemaining <= noticeDays;
      }
    }

    const spendRow = spendByKey.get(key);
    const reasons: string[] = [
      `risk ${riskScore} = calculateVendorRisk(rating ${s.vendorRating}/5, lead ${s.leadTime}d, status ${s.status}, ` +
        `${deliveryRows.length} received receipt(s)) — the existing formula (shared/types/procurement.ts)`,
      highRisk
        ? `HIGH RISK: score ${riskScore} >= ${HIGH_RISK_SCORE_CUTOFF} — the repo's existing cutoff (deriveProcurementInsights, procurement.ts:405)`
        : `below the repo's high-risk cutoff (>= ${HIGH_RISK_SCORE_CUTOFF}, procurement.ts:405)`,
      deliveryPerformancePct === null
        ? 'no received deliveries carry both dates — on-time unmeasured, not fabricated'
        : `on-time ${deliveryPerformancePct}% over ${dated.length} dated receipt(s), ${lateDeliveries} late (calculateDeliveryPerformance)`,
      openBills.length > 0
        ? `open payable exposure ${openBillExposure} across ${openBills.length} approved unpaid bill(s) (deriveApAging open-payable rule)`
        : 'no open payables',
      contractState === 'none'
        ? 'no active vendor contract'
        : `contract ${contractNumber} ${contractState}` +
          (daysRemaining !== null ? `, ${daysRemaining} day(s) remaining` : '') +
          (expiringSoon ? ' — RENEWAL DUE (inside the notice period)' : '') +
          ' (contractWindowState/contractDaysRemaining)',
    ];

    rows.push({
      supplier: key,
      status: s.status,
      riskScore,
      highRisk,
      deliveryPerformancePct,
      lateDeliveries,
      receiptCount: deliveryRows.length,
      leadTimeDays: s.leadTime,
      openBillExposure,
      openBillCount: openBills.length,
      contractState,
      contractDaysRemaining: daysRemaining,
      contractExpiringSoon: expiringSoon,
      spendSharePct: spendRow?.spendSharePct ?? 0,
      reasons,
    });
  }
  rows.sort((a, b) => b.riskScore - a.riskScore || a.supplier.localeCompare(b.supplier));

  // Names transacted with but never registered — no master fields, so no score; named honestly.
  const unregistered = new Set<string>();
  for (const name of [
    ...inputs.orders.map((o) => o.supplier),
    ...inputs.receipts.map((r) => r.supplier),
    ...inputs.bills.map((b) => b.vendor),
    ...inputs.payments.map((p) => p.vendor),
  ]) {
    const key = supplierKeyOf(name);
    if (key !== '(unattributed)' && !registered.has(key)) unregistered.add(key);
  }

  return {
    asOfDate,
    rows,
    supplierCount: rows.length,
    highRiskCount: rows.filter((r) => r.highRisk).length,
    expiringSoonCount: rows.filter((r) => r.contractExpiringSoon).length,
    openBillExposureTotal: round2(rows.reduce((sum, r) => sum + r.openBillExposure, 0)),
    unregisteredSuppliers: [...unregistered].sort(),
  };
}
