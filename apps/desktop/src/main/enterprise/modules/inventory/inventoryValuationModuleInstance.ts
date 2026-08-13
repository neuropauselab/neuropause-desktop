/**
 * The process-wide Inventory Valuation module singleton — binds the
 * Electron-free module to `userData` (via the framework's canonical path) and
 * injects the Movements + Products stores generation reads from, mirroring
 * the `*Instance.ts` pattern.
 */
import { app } from 'electron';
import { INVENTORY_VALUATION_MODULE_ID } from '@neuropause/shared';
import { enterpriseModuleStorePath } from '../../framework';
import { productModule } from './productModuleInstance';
import { stockMovementModule } from './stockMovementModuleInstance';
import { createInventoryValuationModule } from './inventoryValuationModule';

export const inventoryValuationModule = createInventoryValuationModule(
  enterpriseModuleStorePath(app.getPath('userData'), INVENTORY_VALUATION_MODULE_ID),
  stockMovementModule.store,
  productModule.store,
);
