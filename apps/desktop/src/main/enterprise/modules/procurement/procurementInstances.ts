/**
 * The process-wide Procurement module singletons — bind the Electron-free modules
 * to `userData` (via the framework's canonical path) and the shared AI engine.
 */
import { app } from 'electron';
import {
  GOODS_RECEIPTS_MODULE_ID,
  PURCHASE_ORDERS_MODULE_ID,
  PURCHASE_REQUESTS_MODULE_ID,
  SUPPLIERS_MODULE_ID,
} from '@neuropause/shared';
import { aiEngine } from '../../../ai/engineInstance';
import { enterpriseModuleStorePath } from '../../framework';
import { createSupplierModule } from './supplierModule';
import { createPurchaseRequestModule } from './purchaseRequestModule';
import { createPurchaseOrderModule } from './purchaseOrderModule';
import { createGoodsReceiptModule } from './goodsReceiptModule';
import { runGoodsReceiptAi, runPurchaseOrderAi, runSupplierAi } from './procurementAi';

const store = (id: string): string => enterpriseModuleStorePath(app.getPath('userData'), id);

export const supplierModule = createSupplierModule(store(SUPPLIERS_MODULE_ID), (s, h) => runSupplierAi(aiEngine, s, h));
export const purchaseRequestModule = createPurchaseRequestModule(store(PURCHASE_REQUESTS_MODULE_ID));
export const purchaseOrderModule = createPurchaseOrderModule(store(PURCHASE_ORDERS_MODULE_ID), (o) => runPurchaseOrderAi(aiEngine, o));
export const goodsReceiptModule = createGoodsReceiptModule(store(GOODS_RECEIPTS_MODULE_ID), (r) => runGoodsReceiptAi(aiEngine, r));
