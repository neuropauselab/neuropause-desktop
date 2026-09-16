/**
 * The process-wide Inventory Aging module singleton — binds the Electron-free module to
 * `userData` (via the framework's canonical path) and injects the authoritative
 * stock-movement ledger store the snapshot reads from, mirroring the `*Instance.ts` pattern.
 */
import { app } from 'electron';
import { enterpriseModuleStorePath } from '../../framework';
import { stockMovementModule } from './stockMovementModuleInstance';
import { createInventoryAgingModule, INVENTORY_AGING_MODULE_ID } from './inventoryAgingModule';

export const inventoryAgingModule = createInventoryAgingModule(
  enterpriseModuleStorePath(app.getPath('userData'), INVENTORY_AGING_MODULE_ID),
  stockMovementModule.store,
);
