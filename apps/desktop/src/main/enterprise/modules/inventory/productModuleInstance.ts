/**
 * The process-wide Products module singleton — binds the Electron-free module to
 * `userData` (via the framework's canonical path) and the shared AI engine.
 */
import { app } from 'electron';
import { PRODUCTS_MODULE_ID } from '@neuropause/shared';
import { aiEngine } from '../../../ai/engineInstance';
import { enterpriseModuleStorePath } from '../../framework';
import { createProductModule } from './productModule';
import { runProductAi } from './productAi';

export const productModule = createProductModule(
  enterpriseModuleStorePath(app.getPath('userData'), PRODUCTS_MODULE_ID),
  (product, health) => runProductAi(aiEngine, product, health),
);
