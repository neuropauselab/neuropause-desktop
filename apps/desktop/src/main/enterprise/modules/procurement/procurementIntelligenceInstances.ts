/**
 * S82 — Procurement Intelligence singletons (Spend Analytics + Supplier Risk).
 *
 * DELIBERATELY A LEAF FILE, separate from `procurementInstances.ts`: the finance instance
 * files (`vendorBillModuleInstance`, `vendorPaymentModuleInstance`) import
 * `procurementInstances` for the PO store, so importing them back FROM `procurementInstances`
 * creates an ESM evaluation cycle that dereferences half-initialized singletons (TDZ) in any
 * load order that reaches procurement first. Nothing inside that cycle imports THIS file, so
 * evaluating it always finds every source singleton fully constructed. Store access is still
 * via lazy getters — registers read the stores only when a register is generated.
 */
import { app } from 'electron';
import { enterpriseModuleStorePath } from '../../framework';
import {
  goodsReceiptModule,
  purchaseOrderModule,
  supplierModule,
  vendorContractModule,
} from './procurementInstances';
import { vendorBillModule } from '../finance/vendorBillModuleInstance';
import { vendorPaymentModule } from '../finance/vendorPaymentModuleInstance';
import { createSpendAnalyticsModule, SPEND_ANALYTICS_MODULE_ID } from './spendAnalyticsModule';
import { createSupplierRiskModule, SUPPLIER_RISK_MODULE_ID } from './supplierRiskModule';

const store = (id: string): string => enterpriseModuleStorePath(app.getPath('userData'), id);

// S82 — Spend Analytics: immutable per-supplier spend registers (ordered / committed / open /
// received / invoiced / paid kept apart). Reads procurement + finance stores; mutates nothing.
export const spendAnalyticsModule = createSpendAnalyticsModule(store(SPEND_ANALYTICS_MODULE_ID), {
  purchaseOrders: () => purchaseOrderModule.store,
  goodsReceipts: () => goodsReceiptModule.store,
  vendorBills: () => vendorBillModule.store,
  vendorPayments: () => vendorPaymentModule.store,
  suppliers: () => supplierModule.store,
});

// S82 — Supplier Risk: immutable risk registers (existing calculateVendorRisk over real
// delivery evidence, >=60 cutoff, open-bill exposure, contract standing). Read-only sources.
export const supplierRiskModule = createSupplierRiskModule(store(SUPPLIER_RISK_MODULE_ID), {
  suppliers: () => supplierModule.store,
  purchaseOrders: () => purchaseOrderModule.store,
  goodsReceipts: () => goodsReceiptModule.store,
  vendorBills: () => vendorBillModule.store,
  vendorContracts: () => vendorContractModule.store,
  vendorPayments: () => vendorPaymentModule.store,
});
