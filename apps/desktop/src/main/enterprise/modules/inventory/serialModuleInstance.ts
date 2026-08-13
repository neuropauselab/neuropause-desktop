/**
 * The process-wide Serial Units module singleton — binds the Electron-free
 * module to `userData` (via the framework's canonical path) and injects the
 * Products store the SKU guard reads from, mirroring the `*Instance.ts` pattern.
 */
import { app } from 'electron';
import { SERIALS_MODULE_ID } from '@neuropause/shared';
import { enterpriseModuleStorePath } from '../../framework';
import { productModule } from './productModuleInstance';
import { createSerialModule } from './serialModule';

export const serialModule = createSerialModule(
  enterpriseModuleStorePath(app.getPath('userData'), SERIALS_MODULE_ID),
  productModule.store,
);
