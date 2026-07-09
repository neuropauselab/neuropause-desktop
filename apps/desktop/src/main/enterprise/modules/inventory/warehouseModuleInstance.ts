/**
 * The process-wide Warehouses module singleton — binds the Electron-free module
 * to `userData` (via the framework's canonical path). Master data only.
 */
import { app } from 'electron';
import { WAREHOUSES_MODULE_ID } from '@neuropause/shared';
import { enterpriseModuleStorePath } from '../../framework';
import { createWarehouseModule } from './warehouseModule';

export const warehouseModule = createWarehouseModule(
  enterpriseModuleStorePath(app.getPath('userData'), WAREHOUSES_MODULE_ID),
);
