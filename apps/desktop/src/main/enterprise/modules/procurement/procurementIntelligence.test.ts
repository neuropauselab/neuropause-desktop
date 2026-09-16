/**
 * S82 — Procurement Spend Analytics + Supplier Risk registers. Focused tests at two layers:
 *   1. the PURE model (lifecycle separation ORDERED/COMMITTED/OPEN/RECEIVED/INVOICED/PAID,
 *      spend-share arithmetic, per-month rollup, unattributed tolerance, honest empties,
 *      no-evidence supplier rows, and score parity with the EXISTING `calculateVendorRisk`);
 *   2. the GOVERNED register modules through the REAL buildModuleHandlers path (RBAC,
 *      fail-closed denial, tenant isolation, snapshot immutability, deterministic repeated
 *      generation, and the read-only guarantee that generating a register never mutates any
 *      source store).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import {
  IpcChannel,
  OPEN_PO_STATUSES,
  COMMITTED_PO_STATUSES,
  calculatePurchaseTotal,
  calculateVendorRisk,
  type EnterpriseEntity,
  type EnterprisePermission,
  type GoodsReceipt,
  type PlatformEventInput,
  type PurchaseOrder,
  type Supplier,
  type TenantScope,
  type VendorBill,
  type VendorPayment,
} from '@neuropause/shared';
import { EnterpriseModuleRegistry, buildModuleHandlers, type EnterpriseModule } from '../../framework';
import { createSupplierModule } from './supplierModule';
import { createPurchaseOrderModule } from './purchaseOrderModule';
import { createGoodsReceiptModule } from './goodsReceiptModule';
import { createVendorContractModule } from './vendorContractModule';
import { createVendorBillModule } from '../finance/vendorBillModule';
import { createVendorPaymentModule } from '../finance/vendorPaymentModule';
import { createSpendAnalyticsModule, SPEND_ANALYTICS_MODULE_ID } from './spendAnalyticsModule';
import { createSupplierRiskModule, SUPPLIER_RISK_MODULE_ID } from './supplierRiskModule';
import { TEST_TENANT_SCOPE, OTHER_TENANT_SCOPE } from '../../../tenancy/testScope';
import {
  HIGH_RISK_SCORE_CUTOFF,
  deliveryRowsFromReceipts,
  countHighRiskSuppliers,
  deriveSpendAnalytics,
  deriveSupplierRiskRegister,
  type ContractInput,
} from './procurementIntelligenceModel';
import {
  openPoExposureObservation,
  openPoExposureCondition,
  highRiskSuppliersObservation,
  highRiskSuppliersCondition,
} from '../../../analyticsPlatform/procurementIntelligenceSeam';

const T0 = '2026-01-10T00:00:00.000Z';
const AS_OF = '2026-09-04';

/* ── fixture builders (typed projections, no I/O) ── */

const po = (over: Partial<PurchaseOrder>): PurchaseOrder => ({
  id: over.id ?? randomUUID(), poNumber: 'PO-1', supplier: 'Acme Supplies', product: 'SKU-1',
  warehouse: 'WH-1', quantity: 10, unitCost: 10, subtotal: 100, discount: 0, tax: 0, total: 0,
  budget: 0, currency: 'USD', expectedDelivery: '', status: 'approved', approvedBy: '',
  sourceRequest: '', createdAt: T0, updatedAt: T0, ...over,
});

const gr = (over: Partial<GoodsReceipt>): GoodsReceipt => ({
  id: over.id ?? randomUUID(), grNumber: 'GR-1', purchaseOrder: '', supplier: 'Acme Supplies',
  product: 'SKU-1', warehouse: 'WH-1', quantityOrdered: 100, quantityReceived: 100,
  expectedDate: '2026-08-01', receiptDate: '2026-08-01', status: 'received', condition: '',
  receiptMovement: '', createdAt: T0, updatedAt: T0, ...over,
});

const bill = (over: Partial<VendorBill>): VendorBill => ({
  id: over.id ?? randomUUID(), billNumber: 'BILL-1', vendor: 'Acme Supplies', vendorGstin: '',
  amount: 100, taxRate: 0, taxAmount: 0, total: 100, currency: 'USD', exchangeRate: 1,
  status: 'approved', billDate: '', dueDate: '', paidDate: '', paymentReference: '',
  sourcePurchaseOrder: '', amountPaid: 0, outstanding: 100, createdAt: T0, updatedAt: T0, ...over,
});

const pay = (over: Partial<VendorPayment>): VendorPayment => ({
  id: over.id ?? randomUUID(), paymentNumber: 'VP-1', billRef: '', vendor: 'Acme Supplies',
  amount: 50, currency: 'USD', exchangeRate: 1, method: 'bank_transfer', status: 'cleared',
  paidDate: '', transactionRef: '', bankAccount: '', createdAt: T0, updatedAt: T0, ...over,
});

const supplier = (over: Partial<Supplier>): Supplier => ({
  id: over.id ?? randomUUID(), name: 'Acme Supplies', gst: '', pan: '', contactPerson: '',
  email: '', phone: '', bankDetails: '', paymentTerms: '', leadTime: 5, vendorRating: 4,
  status: 'active', ...over,
});

const contract = (over: Partial<ContractInput>): ContractInput => ({
  contractNumber: 'VC-1', supplierName: 'Acme Supplies', recordStatus: 'active',
  startDate: '2026-01-01', endDate: '2026-12-31', renewalNoticeDays: 30, ...over,
});

const empty = { orders: [], receipts: [], bills: [], payments: [] };

// ─────────────────────────────────────────────────────────────────────────────
// 1. PURE MODEL — spend analytics
// ─────────────────────────────────────────────────────────────────────────────
describe('S82 pure model — spend analytics lifecycle separation', () => {
  it('keeps ORDERED / COMMITTED / OPEN / RECEIVED / INVOICED / PAID apart — never one number', () => {
    const reg = deriveSpendAnalytics({
      orders: [
        po({ poNumber: 'PO-D', status: 'draft', subtotal: 100 }),
        po({ poNumber: 'PO-A', status: 'approved', subtotal: 200 }),
        po({ poNumber: 'PO-S', status: 'sent', subtotal: 300 }),
        po({ poNumber: 'PO-R', status: 'received', subtotal: 400 }),
        po({ poNumber: 'PO-C', status: 'cancelled', subtotal: 500 }),
      ],
      receipts: [gr({}), gr({ id: 'g2', grNumber: 'GR-2', status: 'pending' })],
      bills: [
        bill({ billNumber: 'B-A', status: 'approved', total: 150 }),
        bill({ billNumber: 'B-P', status: 'paid', total: 50 }),
        bill({ billNumber: 'B-D', status: 'draft', total: 999 }),
        bill({ billNumber: 'B-C', status: 'cancelled', total: 999 }),
      ],
      payments: [
        pay({ amount: 120, status: 'cleared' }),
        pay({ paymentNumber: 'VP-2', amount: 999, status: 'pending' }),
        pay({ paymentNumber: 'VP-3', amount: 999, status: 'void' }),
      ],
    }, AS_OF);

    const row = reg.rows.find((r) => r.supplier === 'Acme Supplies')!;
    // ORDERED — the existing procurement-spend set (not draft, not cancelled: 200+300+400)
    expect(row.orderedValue).toBe(900);
    // COMMITTED — COMMITTED_PO_STATUSES (approved/sent/received) from budgetControls
    expect(row.committedValue).toBe(900);
    expect([...COMMITTED_PO_STATUSES]).toEqual(['approved', 'sent', 'received']);
    // OPEN — OPEN_PO_STATUSES (draft/approved/sent): 100+200+300, NOT the ordered number
    expect(row.openValue).toBe(600);
    expect([...OPEN_PO_STATUSES]).toEqual(['draft', 'approved', 'sent']);
    // RECEIVED — posted (status received) receipts only
    expect(row.receiptCount).toBe(1);
    // INVOICED — booked payables (approved + paid bills), never drafts/cancelled
    expect(row.invoicedValue).toBe(200);
    expect(row.billCount).toBe(2);
    // PAID — cleared vendor payments only
    expect(row.paidValue).toBe(120);
    expect(row.poCount).toBe(3);
    // and the totals mirror the row (one supplier)
    expect(reg.totals).toMatchObject({ orderedValue: 900, openValue: 600, invoicedValue: 200, paidValue: 120 });
  });

  it('spend share is plain arithmetic over ordered value', () => {
    const reg = deriveSpendAnalytics({
      ...empty,
      orders: [
        po({ supplier: 'Acme Supplies', status: 'sent', subtotal: 300 }),
        po({ supplier: 'Beta Parts', status: 'approved', subtotal: 100 }),
      ],
    }, AS_OF);
    expect(reg.rows.find((r) => r.supplier === 'Acme Supplies')!.spendSharePct).toBe(75);
    expect(reg.rows.find((r) => r.supplier === 'Beta Parts')!.spendSharePct).toBe(25);
    // total via the EXISTING calculatePurchaseTotal, not a rewrite
    expect(reg.totals.orderedValue).toBe(
      calculatePurchaseTotal({ subtotal: 300, discount: 0, tax: 0 }) +
        calculatePurchaseTotal({ subtotal: 100, discount: 0, tax: 0 }),
    );
  });

  it('rolls ordered spend into calendar months; undated orders are excluded and counted', () => {
    const reg = deriveSpendAnalytics({
      ...empty,
      orders: [
        po({ status: 'approved', subtotal: 200, createdAt: '2026-01-15T10:00:00.000Z' }),
        po({ status: 'sent', subtotal: 300, createdAt: '2026-02-10T10:00:00.000Z' }),
        po({ status: 'received', subtotal: 400, createdAt: '2026-02-20T10:00:00.000Z' }),
        po({ status: 'draft', subtotal: 999, createdAt: '2026-03-01T10:00:00.000Z' }), // not ordered
        po({ status: 'approved', subtotal: 50, createdAt: '' }), // undated — excluded, counted
      ],
    }, AS_OF);
    expect(reg.byPeriod).toEqual([
      { period: '2026-01', orderedValue: 200, poCount: 1 },
      { period: '2026-02', orderedValue: 700, poCount: 2 },
    ]);
    expect(reg.exclusions.undatedOrders).toBe(1);
    expect(reg.totals.orderedValue).toBe(950); // the undated order still counts toward totals
  });

  it('tolerates missing supplier names honestly — (unattributed) row + exclusion counts', () => {
    const reg = deriveSpendAnalytics({
      orders: [po({ supplier: '   ', status: 'approved', subtotal: 100 })],
      receipts: [gr({ supplier: '' })],
      bills: [bill({ vendor: '', total: 10, status: 'approved' })],
      payments: [pay({ vendor: '', amount: 5 })],
    }, AS_OF);
    const row = reg.rows.find((r) => r.supplier === '(unattributed)')!;
    expect(row).toMatchObject({ orderedValue: 100, invoicedValue: 10, paidValue: 5, receiptCount: 1 });
    expect(reg.exclusions).toMatchObject({
      unattributedOrders: 1, unattributedReceipts: 1, unattributedBills: 1, unattributedPayments: 1,
    });
  });

  it('empty datasets → honestly empty register, no fabricated zero rows', () => {
    const reg = deriveSpendAnalytics(empty, AS_OF);
    expect(reg.rows).toEqual([]);
    expect(reg.byPeriod).toEqual([]);
    expect(reg.supplierCount).toBe(0);
    expect(reg.totals).toMatchObject({ orderedValue: 0, invoicedValue: 0, paidValue: 0, poCount: 0 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1b. PURE MODEL — supplier risk register
// ─────────────────────────────────────────────────────────────────────────────
describe('S82 pure model — supplier risk register', () => {
  it('risk score IS calculateVendorRisk fed with that supplier’s own delivery evidence', () => {
    const acme = supplier({ name: 'Acme Supplies', vendorRating: 2, leadTime: 20 });
    const receipts = [
      gr({ supplier: 'Acme Supplies', expectedDate: '2026-08-01', receiptDate: '2026-08-10' }), // late
      gr({ id: 'g2', supplier: 'Acme Supplies', expectedDate: '2026-08-01', receiptDate: '2026-08-01' }), // on time
      gr({ id: 'g3', supplier: 'Beta Parts', expectedDate: '2026-08-01', receiptDate: '2026-09-09' }), // other supplier
    ];
    const reg = deriveSupplierRiskRegister({ ...empty, suppliers: [acme], receipts, contracts: [] }, AS_OF);
    const row = reg.rows[0]!;
    const ownRows = deliveryRowsFromReceipts(receipts.filter((r) => r.supplier === 'Acme Supplies'));
    expect(ownRows).toHaveLength(2); // Beta's receipt is NOT Acme's evidence
    expect(row.riskScore).toBe(calculateVendorRisk(acme, ownRows)); // parity with the EXISTING formula
    expect(row.deliveryPerformancePct).toBe(50);
    expect(row.lateDeliveries).toBe(1);
    expect(row.reasons.join(' ')).toContain('calculateVendorRisk');
  });

  it('high-risk uses the EXISTING >=60 cutoff (deriveProcurementInsights, procurement.ts) — boundary included', () => {
    expect(HIGH_RISK_SCORE_CUTOFF).toBe(60);
    const risky = supplier({ name: 'Risky Co', vendorRating: 1, leadTime: 40 }); // (5−1)×12 + 20 = 68
    const safe = supplier({ name: 'Safe Co', vendorRating: 4, leadTime: 5 }); // (5−4)×12 = 12
    const reg = deriveSupplierRiskRegister({ ...empty, suppliers: [risky, safe], receipts: [], contracts: [] }, AS_OF);
    const riskyRow = reg.rows.find((r) => r.supplier === 'Risky Co')!;
    const safeRow = reg.rows.find((r) => r.supplier === 'Safe Co')!;
    expect(riskyRow.riskScore).toBe(68);
    expect(riskyRow.highRisk).toBe(true);
    expect(riskyRow.reasons.join(' ')).toContain('60');
    expect(safeRow.highRisk).toBe(false);
    expect(reg.highRiskCount).toBe(1);
    expect(reg.rows[0]!.supplier).toBe('Risky Co'); // riskiest first
  });

  it('a supplier with no transactions gets an explicit no-evidence row, never fabricated metrics', () => {
    const reg = deriveSupplierRiskRegister(
      { ...empty, suppliers: [supplier({ name: 'Fresh Vendor' })], receipts: [], contracts: [] },
      AS_OF,
    );
    const row = reg.rows[0]!;
    expect(row.deliveryPerformancePct).toBeNull(); // unmeasured, not 100-as-data
    expect(row.lateDeliveries).toBe(0);
    expect(row.receiptCount).toBe(0);
    expect(row.openBillExposure).toBe(0);
    expect(row.spendSharePct).toBe(0);
    expect(row.reasons.join(' ')).toMatch(/no received deliveries|unmeasured/);
  });

  it('a supplier seen only in transactions (no master record) is excluded and NAMED, never scored blind', () => {
    const reg = deriveSupplierRiskRegister(
      { ...empty, suppliers: [], receipts: [gr({ supplier: 'Ghost Vendor' })], contracts: [] },
      AS_OF,
    );
    expect(reg.rows).toEqual([]);
    expect(reg.unregisteredSuppliers).toEqual(['Ghost Vendor']);
  });

  it('open-bill exposure = outstanding of APPROVED unpaid bills only (the deriveApAging open-payable rule)', () => {
    const reg = deriveSupplierRiskRegister({
      ...empty,
      suppliers: [supplier({})],
      receipts: [],
      contracts: [],
      bills: [
        bill({ status: 'approved', total: 150, amountPaid: 50, outstanding: 100 }), // partial-paid: 100 open
        bill({ billNumber: 'B2', status: 'paid', total: 999, outstanding: 0 }),
        bill({ billNumber: 'B3', status: 'draft', total: 999, outstanding: 999 }),
        bill({ billNumber: 'B4', status: 'cancelled', total: 999, outstanding: 999 }),
      ],
    }, AS_OF);
    expect(reg.rows[0]!.openBillExposure).toBe(100);
    expect(reg.openBillExposureTotal).toBe(100);
  });

  it('contract status reuses contractWindowState / daysRemaining / expiringSoon; none → "none"', () => {
    const reg = deriveSupplierRiskRegister({
      ...empty,
      suppliers: [
        supplier({ name: 'Acme Supplies' }),
        supplier({ name: 'Beta Parts' }),
        supplier({ name: 'Gamma LLC' }),
      ],
      receipts: [],
      contracts: [
        contract({ supplierName: 'Acme Supplies', endDate: '2026-09-20', renewalNoticeDays: 30 }), // open, 16d left → expiring soon
        contract({ contractNumber: 'VC-2', supplierName: 'Beta Parts', startDate: '2025-01-01', endDate: '2025-12-31' }), // expired
      ],
    }, AS_OF);
    const acme = reg.rows.find((r) => r.supplier === 'Acme Supplies')!;
    expect(acme).toMatchObject({ contractState: 'open', contractDaysRemaining: 16, contractExpiringSoon: true });
    expect(reg.rows.find((r) => r.supplier === 'Beta Parts')!.contractState).toBe('expired');
    expect(reg.rows.find((r) => r.supplier === 'Gamma LLC')!.contractState).toBe('none');
    expect(reg.expiringSoonCount).toBe(1);
  });

  it('deterministic — same inputs, same register', () => {
    const inputs = {
      suppliers: [supplier({ vendorRating: 1, leadTime: 40 })],
      orders: [po({ status: 'sent', subtotal: 300 })],
      receipts: [gr({})],
      bills: [bill({})],
      payments: [pay({})],
      contracts: [contract({})],
    };
    expect(deriveSupplierRiskRegister(inputs, AS_OF)).toEqual(deriveSupplierRiskRegister(inputs, AS_OF));
    expect(deriveSpendAnalytics(inputs, AS_OF)).toEqual(deriveSpendAnalytics(inputs, AS_OF));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1c. KPI seam — existing numbers only; unconfigured limit is fail-closed
// ─────────────────────────────────────────────────────────────────────────────
describe('S82 KPI seam', () => {
  it('open-PO exposure sums calculatePurchaseTotal over OPEN_PO_STATUSES only', () => {
    const obs = openPoExposureObservation([
      po({ status: 'draft', subtotal: 100 }),
      po({ status: 'approved', subtotal: 200 }),
      po({ status: 'sent', subtotal: 300 }),
      po({ status: 'received', subtotal: 999 }),
      po({ status: 'cancelled', subtotal: 999 }),
    ]);
    expect(obs.kpiKey).toBe('procurement.openPoExposure');
    expect(obs.value).toBe(600);
  });

  it('high-risk supplier count mirrors the register (>=60 via calculateVendorRisk)', () => {
    const suppliers = [supplier({ name: 'Risky Co', vendorRating: 1, leadTime: 40 }), supplier({ name: 'Safe Co' })];
    expect(countHighRiskSuppliers(suppliers, [])).toBe(1);
    expect(highRiskSuppliersObservation(suppliers, []).value).toBe(1);
  });

  it('conditions: any high-risk supplier (0); exposure limit UNCONFIGURED → fail-closed', () => {
    expect(highRiskSuppliersCondition()).toMatchObject({ direction: 'above', exceptionThreshold: 0 });
    expect(openPoExposureCondition()).toMatchObject({ direction: 'above', exceptionThreshold: null });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. GOVERNED REGISTER MODULES (buildModuleHandlers — RBAC + tenancy + immutability)
// ─────────────────────────────────────────────────────────────────────────────
describe('S82 governed register modules', () => {
  const NOW = '2026-09-04T00:00:00.000Z';
  const paths: string[] = [];
  let rec: { authorized: EnterprisePermission[]; publish: PlatformEventInput[] };
  let registry: EnterpriseModuleRegistry;
  let handlers: ReturnType<typeof buildModuleHandlers>;
  let suppliers: EnterpriseModule;
  let pos: EnterpriseModule;
  let receipts: EnterpriseModule;
  let contracts: EnterpriseModule;
  let bills: EnterpriseModule;
  let payments: EnterpriseModule;
  let scope: TenantScope;

  function tmp(tag: string): string {
    const p = join(tmpdir(), `np-s82-${tag}-${randomUUID()}.json`);
    paths.push(p);
    return p;
  }
  function spyCtx() {
    return {
      authorize: (p: EnterprisePermission) => rec.authorized.push(p),
      audit: () => undefined,
      publish: (i: PlatformEventInput) => rec.publish.push(i),
      broadcast: () => undefined,
      notify: () => undefined,
      actor: () => 'tester@np.dev',
      now: () => NOW,
    };
  }

  beforeEach(() => {
    rec = { authorized: [], publish: [] };
    suppliers = createSupplierModule(tmp('sup'));
    pos = createPurchaseOrderModule(tmp('po'));
    receipts = createGoodsReceiptModule(tmp('gr'));
    contracts = createVendorContractModule(tmp('vc'), suppliers.store);
    bills = createVendorBillModule(tmp('bill'));
    payments = createVendorPaymentModule(tmp('pay'), bills.store);
    const spend = createSpendAnalyticsModule(tmp('spend'), {
      purchaseOrders: () => pos.store,
      goodsReceipts: () => receipts.store,
      vendorBills: () => bills.store,
      vendorPayments: () => payments.store,
      suppliers: () => suppliers.store,
    });
    const risk = createSupplierRiskModule(tmp('risk'), {
      suppliers: () => suppliers.store,
      purchaseOrders: () => pos.store,
      goodsReceipts: () => receipts.store,
      vendorBills: () => bills.store,
      vendorContracts: () => contracts.store,
    });
    registry = new EnterpriseModuleRegistry();
    for (const m of [suppliers, pos, receipts, contracts, bills, payments, spend, risk]) registry.register(m);
    scope = TEST_TENANT_SCOPE;
    registry.bindScope(() => scope); // one binding across all stores; switch `scope` to change tenant
    handlers = buildModuleHandlers(registry, spyCtx());
  });
  afterEach(async () => {
    for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined);
  });

  function handler(channel: string): (p: unknown) => unknown | Promise<unknown> {
    const def = handlers.find((d) => d.channel === channel);
    if (!def) throw new Error(`no handler for ${channel}`);
    return def.handler;
  }
  async function create(moduleId: string, fields: Record<string, unknown>) {
    return (await handler(IpcChannel.EnterpriseModuleCreate)({ moduleId, fields })) as {
      ok: boolean;
      record?: EnterpriseEntity;
      errors?: Record<string, string>;
    };
  }
  async function list(moduleId: string) {
    return (await handler(IpcChannel.EnterpriseModuleList)({ moduleId })) as EnterpriseEntity[];
  }
  /** Seed a SOURCE record directly against the tenant-bound store (the registers only READ these). */
  function seed(m: EnterpriseModule, title: string, fields: Record<string, unknown>): EnterpriseEntity {
    return m.store.create({ title, fields, actor: 'tester@np.dev', now: T0 });
  }
  function seedAcmeWorld(): void {
    seed(suppliers, 'Acme Supplies', { name: 'Acme Supplies', vendorRating: 1, leadTime: 40, status: 'active' });
    seed(pos, 'PO-1', { poNumber: 'PO-1', supplier: 'Acme Supplies', product: 'SKU-1', subtotal: 200, discount: 0, tax: 0, status: 'approved' });
    seed(receipts, 'GR-1', { grNumber: 'GR-1', supplier: 'Acme Supplies', product: 'SKU-1', quantityOrdered: 10, quantityReceived: 10, expectedDate: '2026-08-01', receiptDate: '2026-08-05', status: 'received' });
    seed(bills, 'BILL-1', { billNumber: 'BILL-1', vendor: 'Acme Supplies', amount: 100, taxRate: 0, status: 'approved' });
    seed(payments, 'VP-1', { paymentNumber: 'VP-1', vendor: 'Acme Supplies', amount: 40, status: 'cleared' });
  }
  /** Byte-snapshot of every source store — the read-only proof reads this before/after. */
  function sourceBytes(): string {
    return JSON.stringify([suppliers, pos, receipts, contracts, bills, payments].map((m) => m.store.list()));
  }

  it('RBAC — generating a register authorizes procurement:manage; listing authorizes procurement:read', async () => {
    for (const moduleId of [SPEND_ANALYTICS_MODULE_ID, SUPPLIER_RISK_MODULE_ID]) {
      rec.authorized.length = 0;
      await create(moduleId, { asOfDate: AS_OF });
      expect(rec.authorized).toContain('procurement:manage');
      rec.authorized.length = 0;
      await list(moduleId);
      expect(rec.authorized).toEqual(['procurement:read']);
    }
  });

  it('RBAC — a caller the authorizer refuses gets NOTHING (fail-closed)', async () => {
    const denyingHandlers = buildModuleHandlers(registry, {
      ...spyCtx(),
      authorize: () => {
        throw new Error('permission denied: procurement');
      },
    });
    const denied = denyingHandlers.find((d) => d.channel === IpcChannel.EnterpriseModuleCreate)!;
    await expect(
      Promise.resolve(denied.handler({ moduleId: SPEND_ANALYTICS_MODULE_ID, fields: { asOfDate: AS_OF } })),
    ).rejects.toThrow(/denied/);
  });

  it('empty procurement → honest empty registers (not fabricated)', async () => {
    const spendRes = await create(SPEND_ANALYTICS_MODULE_ID, { asOfDate: AS_OF });
    expect(spendRes.ok).toBe(true);
    expect(Number(spendRes.record?.fields.orderedTotal)).toBe(0);
    expect(Number(spendRes.record?.fields.supplierCount)).toBe(0);
    expect(String(spendRes.record?.fields.note)).toMatch(/empty, not fabricated/);
    const riskRes = await create(SUPPLIER_RISK_MODULE_ID, { asOfDate: AS_OF });
    expect(riskRes.ok).toBe(true);
    expect(Number(riskRes.record?.fields.supplierCount)).toBe(0);
    expect(String(riskRes.record?.fields.note)).toMatch(/empty, not fabricated/);
  });

  it('spend register reflects lifecycle states through the governed path — and mutates NO source store', async () => {
    seedAcmeWorld();
    const before = sourceBytes();
    const res = await create(SPEND_ANALYTICS_MODULE_ID, { asOfDate: AS_OF });
    expect(res.ok).toBe(true);
    expect(String(res.record?.fields.reportNumber)).toBe(`SA-${AS_OF}-1`);
    expect(Number(res.record?.fields.orderedTotal)).toBe(200);
    expect(Number(res.record?.fields.openTotal)).toBe(200); // approved is still open
    expect(Number(res.record?.fields.invoicedTotal)).toBe(100);
    expect(Number(res.record?.fields.paidTotal)).toBe(40);
    const rows = JSON.parse(String(res.record?.fields.rows)) as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({ supplier: 'Acme Supplies', orderedValue: 200, receiptCount: 1 });
    expect(sourceBytes()).toBe(before); // READ-ONLY: every source store byte-identical
  });

  it('risk register indicators through the governed path — reasons cite the existing formula', async () => {
    seedAcmeWorld();
    const before = sourceBytes();
    const res = await create(SUPPLIER_RISK_MODULE_ID, { asOfDate: AS_OF });
    expect(res.ok).toBe(true);
    expect(String(res.record?.fields.reportNumber)).toBe(`SR-${AS_OF}-1`);
    expect(Number(res.record?.fields.highRiskCount)).toBe(1); // rating 1 + 40d lead + late delivery ≥ 60
    expect(Number(res.record?.fields.openBillExposure)).toBe(100);
    const rows = JSON.parse(String(res.record?.fields.rows)) as Array<{ riskScore: number; highRisk: boolean; reasons: string[] }>;
    expect(rows[0]!.highRisk).toBe(true);
    expect(rows[0]!.reasons.join(' ')).toContain('calculateVendorRisk');
    expect(sourceBytes()).toBe(before);
  });

  it('registers are immutable — a generated snapshot cannot be edited in place', async () => {
    const res = await create(SPEND_ANALYTICS_MODULE_ID, { asOfDate: AS_OF });
    const update = (await handler(IpcChannel.EnterpriseModuleUpdate)({
      moduleId: SPEND_ANALYTICS_MODULE_ID,
      id: res.record?.id,
      fields: { ...res.record?.fields, orderedTotal: 9999 },
    })) as { ok: boolean; errors?: Record<string, string> };
    expect(update.ok).toBe(false);
    expect(JSON.stringify(update.errors ?? {})).toContain('immutable');
  });

  it('repeated generation over the same sources is deterministic (same rows, same numbers)', async () => {
    seedAcmeWorld();
    const a = await create(SPEND_ANALYTICS_MODULE_ID, { asOfDate: AS_OF });
    const b = await create(SPEND_ANALYTICS_MODULE_ID, { asOfDate: AS_OF });
    for (const key of ['rows', 'byPeriod', 'orderedTotal', 'openTotal', 'invoicedTotal', 'paidTotal']) {
      expect(b.record?.fields[key]).toEqual(a.record?.fields[key]);
    }
    expect(String(b.record?.fields.reportNumber)).toBe(`SA-${AS_OF}-2`); // a NEW snapshot, same content
    const ra = await create(SUPPLIER_RISK_MODULE_ID, { asOfDate: AS_OF });
    const rb = await create(SUPPLIER_RISK_MODULE_ID, { asOfDate: AS_OF });
    expect(rb.record?.fields.rows).toEqual(ra.record?.fields.rows);
  });

  it('TENANT ISOLATION — registers see only the acting tenant; the renderer supplies no tenant', async () => {
    scope = TEST_TENANT_SCOPE;
    seedAcmeWorld();
    const aSnap = await create(SPEND_ANALYTICS_MODULE_ID, { asOfDate: AS_OF });
    expect(Number(aSnap.record?.fields.orderedTotal)).toBe(200);

    // Tenant B sends the IDENTICAL payload; the store's binding, not the payload, decides scope.
    scope = OTHER_TENANT_SCOPE;
    const bSnap = await create(SPEND_ANALYTICS_MODULE_ID, { asOfDate: AS_OF });
    expect(Number(bSnap.record?.fields.orderedTotal)).toBe(0);
    const bList = await list(SPEND_ANALYTICS_MODULE_ID);
    expect(bList.every((r) => r.id !== aSnap.record?.id)).toBe(true);

    scope = TEST_TENANT_SCOPE;
    const aList = await list(SPEND_ANALYTICS_MODULE_ID);
    expect(aList.some((r) => r.id === aSnap.record?.id)).toBe(true);
    expect(aList.every((r) => r.id !== bSnap.record?.id)).toBe(true);
  });
});
