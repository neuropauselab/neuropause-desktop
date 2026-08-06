/**
 * The process-wide Lots module singleton — binds the Electron-free module to
 * `userData` (via the framework's canonical path) and injects the Products
 * store the SKU guard reads from, mirroring the `*Instance.ts` pattern.
 */
import { app } from 'electron';
import { LOTS_MODULE_ID } from '@neuropause/shared';
import { enterpriseModuleStorePath } from '../../framework';
import { productModule } from './productModuleInstance';
import { createLotModule } from './lotModule';

export const lotModule = createLotModule(
  enterpriseModuleStorePath(app.getPath('userData'), LOTS_MODULE_ID),
  productModule.store,
);
