/**
 * The process-wide Procurement module singletons — bind the Electron-free modules
 * to `userData` (via the framework's canonical path) and the shared AI engine.
 */
import { app } from 'electron';
import {
  GOODS_RECEIPTS_MODULE_ID,
  PURCHASE_ORDERS_MODULE_ID,
  PURCHASE_REQUESTS_MODULE_ID,
  RFQS_MODULE_ID,
  SUPPLIER_PERFORMANCE_MODULE_ID,
  SUPPLIERS_MODULE_ID,
  VENDOR_CONTRACTS_MODULE_ID,
} from '@neuropause/shared';
import { aiEngine } from '../../../ai/engineInstance';
import { budgetModule } from '../finance/budgetModuleInstance';
import { enterpriseModuleStorePath } from '../../framework';
import { createSupplierModule } from './supplierModule';
import { createVendorContractModule } from './vendorContractModule';
import { createPurchaseRequestModule } from './purchaseRequestModule';
import { createPurchaseOrderModule } from './purchaseOrderModule';
import { createGoodsReceiptModule } from './goodsReceiptModule';
import { createRfqModule } from './rfqModule';
import { createSupplierPerformanceModule } from './supplierPerformanceModule';
import { createMultiLineReceiptModule, MULTILINE_RECEIPTS_MODULE_ID } from './multiLineReceiptModule';
import { runGoodsReceiptAi, runPurchaseOrderAi, runSupplierAi } from './procurementAi';

const store = (id: string): string => enterpriseModuleStorePath(app.getPath('userData'), id);

// ERP Session 7-Fix — first-class multi-line goods receipt (header → N lines → N movements).
export const multiLineReceiptModule = createMultiLineReceiptModule(store(MULTILINE_RECEIPTS_MODULE_ID));

export const supplierModule = createSupplierModule(store(SUPPLIERS_MODULE_ID), (s, h) => runSupplierAi(aiEngine, s, h));
export const purchaseRequestModule = createPurchaseRequestModule(store(PURCHASE_REQUESTS_MODULE_ID));
// FW-7 — vendor contracts: dated supplier agreements; the supplier store backs the guard + name snapshot.
export const vendorContractModule = createVendorContractModule(store(VENDOR_CONTRACTS_MODULE_ID), supplierModule.store);
// FW-5 — approval consults the named Finance budget (off/warn/block commitment policy).
// FW-7 — approval also consults the named vendor contract (live + activated + open window + same supplier).
export const purchaseOrderModule = createPurchaseOrderModule(
  store(PURCHASE_ORDERS_MODULE_ID),
  (o) => runPurchaseOrderAi(aiEngine, o),
  budgetModule.store,
  vendorContractModule.store,
);
export const goodsReceiptModule = createGoodsReceiptModule(store(GOODS_RECEIPTS_MODULE_ID), (r) => runGoodsReceiptAi(aiEngine, r));
// W3.1 — RFQs: multi-supplier quotation cycle; quotes validated against the Suppliers register.
export const rfqModule = createRfqModule(store(RFQS_MODULE_ID), supplierModule.store);
// W3.2 — Supplier Performance: immutable scorecards from goods-receipt evidence.
export const supplierPerformanceModule = createSupplierPerformanceModule(
  store(SUPPLIER_PERFORMANCE_MODULE_ID),
  goodsReceiptModule.store,
  supplierModule.store,
);
