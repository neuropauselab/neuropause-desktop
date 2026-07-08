/**
 * The process-wide Customers module singleton — binds the Electron-free module to
 * `userData` (via the framework's canonical path) and the shared AI engine.
 * Mirrors the Leads/Contacts/Finance instance + the `*Instance.ts` pattern.
 */
import { app } from 'electron';
import { CUSTOMERS_MODULE_ID } from '@neuropause/shared';
import { aiEngine } from '../../../ai/engineInstance';
import { enterpriseModuleStorePath } from '../../framework';
import { createCustomerModule } from './customerModule';
import { runCustomerAi } from './customerAi';

export const customerModule = createCustomerModule(
  enterpriseModuleStorePath(app.getPath('userData'), CUSTOMERS_MODULE_ID),
  (customer, signals) => runCustomerAi(aiEngine, customer, signals),
);
