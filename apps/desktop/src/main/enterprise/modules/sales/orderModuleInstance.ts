/**
 * The process-wide Sales Orders module singleton — binds the Electron-free module
 * to `userData` (via the framework's canonical path) and the shared AI engine.
 * Mirrors the Quotes/CRM/Finance instance + the `*Instance.ts` pattern.
 */
import { app } from 'electron';
import { ORDERS_MODULE_ID } from '@neuropause/shared';
import { aiEngine } from '../../../ai/engineInstance';
import { enterpriseModuleStorePath } from '../../framework';
import { createOrderModule } from './orderModule';
import { runOrderAi } from './orderAi';

export const orderModule = createOrderModule(
  enterpriseModuleStorePath(app.getPath('userData'), ORDERS_MODULE_ID),
  (order, signals) => runOrderAi(aiEngine, order, signals),
);
