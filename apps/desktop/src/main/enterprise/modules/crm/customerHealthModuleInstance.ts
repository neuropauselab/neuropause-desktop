/**
 * The process-wide Customer Health module singleton — binds the Electron-free
 * module to `userData` (via the framework's canonical path) and injects the
 * Customer + Invoice + Opportunity + Activity + Contract stores the register
 * reads from, mirroring the `*Instance.ts` pattern used across main.
 */
import { app } from 'electron';
import { CUSTOMER_HEALTH_MODULE_ID } from '@neuropause/shared';
import { enterpriseModuleStorePath } from '../../framework';
import { customerModule } from './customerModuleInstance';
import { opportunityModule } from './opportunityModuleInstance';
import { activityModule } from './activityModuleInstance';
import { invoiceModule } from '../finance/invoiceModuleInstance';
import { contractModule } from '../sales/contractModuleInstance';
import { createCustomerHealthModule } from './customerHealthModule';

export const customerHealthModule = createCustomerHealthModule(
  enterpriseModuleStorePath(app.getPath('userData'), CUSTOMER_HEALTH_MODULE_ID),
  customerModule.store,
  invoiceModule.store,
  opportunityModule.store,
  activityModule.store,
  contractModule.store,
);
