/**
 * The process-wide Customer Timeline module singleton — binds the
 * Electron-free module to `userData` (via the framework's canonical path) and
 * injects the Customer + Quote + Invoice + Opportunity + Activity + Contract
 * stores generation reads from, mirroring the `*Instance.ts` pattern used
 * across main.
 */
import { app } from 'electron';
import { CUSTOMER_TIMELINE_MODULE_ID } from '@neuropause/shared';
import { enterpriseModuleStorePath } from '../../framework';
import { customerModule } from './customerModuleInstance';
import { opportunityModule } from './opportunityModuleInstance';
import { activityModule } from './activityModuleInstance';
import { quoteModule } from '../sales/quoteModuleInstance';
import { invoiceModule } from '../finance/invoiceModuleInstance';
import { contractModule } from '../sales/contractModuleInstance';
import { createCustomerTimelineModule } from './customerTimelineModule';

export const customerTimelineModule = createCustomerTimelineModule(
  enterpriseModuleStorePath(app.getPath('userData'), CUSTOMER_TIMELINE_MODULE_ID),
  customerModule.store,
  quoteModule.store,
  invoiceModule.store,
  opportunityModule.store,
  activityModule.store,
  contractModule.store,
);
