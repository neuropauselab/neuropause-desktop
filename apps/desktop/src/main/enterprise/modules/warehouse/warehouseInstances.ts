/**
 * The process-wide Warehouse module singletons — bind the Electron-free modules to
 * `userData` (via the framework's canonical path) and the shared AI engine. These
 * are the eight execution-layer modules registered with the enterprise registry;
 * their stock effects all flow through the Inventory Ledger.
 */
import { app } from 'electron';
import {
  CYCLE_COUNTS_MODULE_ID,
  PACKING_MODULE_ID,
  PICK_LISTS_MODULE_ID,
  SHIPPING_MODULE_ID,
  STOCK_ADJUSTMENTS_MODULE_ID,
  TRANSFER_ORDERS_MODULE_ID,
  WAREHOUSE_BINS_MODULE_ID,
  WAREHOUSE_ZONES_MODULE_ID,
} from '@neuropause/shared';
import { aiEngine } from '../../../ai/engineInstance';
import { enterpriseModuleStorePath } from '../../framework';
import { createZoneModule } from './zoneModule';
import { createBinModule } from './binModule';
import { createTransferOrderModule } from './transferOrderModule';
import { createPickListModule } from './pickListModule';
import { createPackingModule } from './packingModule';
import { createShippingModule } from './shippingModule';
import { createCycleCountModule } from './cycleCountModule';
import { createStockAdjustmentModule } from './stockAdjustmentModule';
import { runCycleCountAi, runStockAdjustmentAi, runTransferAi } from './warehouseAi';

const store = (id: string): string => enterpriseModuleStorePath(app.getPath('userData'), id);

export const zoneModule = createZoneModule(store(WAREHOUSE_ZONES_MODULE_ID));
export const binModule = createBinModule(store(WAREHOUSE_BINS_MODULE_ID));
export const transferOrderModule = createTransferOrderModule(store(TRANSFER_ORDERS_MODULE_ID), (t) => runTransferAi(aiEngine, t));
export const pickListModule = createPickListModule(store(PICK_LISTS_MODULE_ID));
export const packingModule = createPackingModule(store(PACKING_MODULE_ID));
export const shippingModule = createShippingModule(store(SHIPPING_MODULE_ID));
export const cycleCountModule = createCycleCountModule(store(CYCLE_COUNTS_MODULE_ID), (c) => runCycleCountAi(aiEngine, c));
export const stockAdjustmentModule = createStockAdjustmentModule(store(STOCK_ADJUSTMENTS_MODULE_ID), (a) => runStockAdjustmentAi(aiEngine, a));
