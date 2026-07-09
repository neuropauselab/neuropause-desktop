/**
 * The process-wide Stock Movements module singleton — binds the Electron-free
 * module to `userData` (via the framework's canonical path), the shared AI engine,
 * and the Products module's store (so the reconciler can materialize derived stock
 * onto products).
 */
import { app } from 'electron';
import { STOCK_MOVEMENTS_MODULE_ID } from '@neuropause/shared';
import { aiEngine } from '../../../ai/engineInstance';
import { enterpriseModuleStorePath } from '../../framework';
import { createStockMovementModule } from './stockMovementModule';
import { runMovementAi } from './movementAi';

export const stockMovementModule = createStockMovementModule(
  enterpriseModuleStorePath(app.getPath('userData'), STOCK_MOVEMENTS_MODULE_ID),
  (movement) => runMovementAi(aiEngine, movement),
);
