/**
 * The process-wide Fixed Assets module singleton — binds the Electron-free
 * module to `userData`, mirroring the `*Instance.ts` pattern used across main.
 */
import { app } from 'electron';
import { FIXED_ASSETS_MODULE_ID } from '@neuropause/shared';
import { enterpriseModuleStorePath } from '../../framework';
import { createFixedAssetModule } from './fixedAssetModule';

export const fixedAssetModule = createFixedAssetModule(
  enterpriseModuleStorePath(app.getPath('userData'), FIXED_ASSETS_MODULE_ID),
);
