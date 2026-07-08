/**
 * The process-wide Sales Orders module singleton — binds the Electron-free module
 * to `userData` (via the framework's canonical path). No AI runner yet (the rich
 * Order behaviour lands in the dedicated Sales → Orders increment).
 */
import { app } from 'electron';
import { ORDERS_MODULE_ID } from '@neuropause/shared';
import { enterpriseModuleStorePath } from '../../framework';
import { createOrderModule } from './orderModule';

export const orderModule = createOrderModule(
  enterpriseModuleStorePath(app.getPath('userData'), ORDERS_MODULE_ID),
);
