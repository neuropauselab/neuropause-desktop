/**
 * The process-wide Opportunities module singleton — binds the Electron-free
 * module to `userData` (via the framework's canonical path) and injects the
 * Leads + Quotes stores the deterministic ref guards read from, mirroring the
 * `*Instance.ts` pattern used across main.
 */
import { app } from 'electron';
import { OPPORTUNITIES_MODULE_ID } from '@neuropause/shared';
import { enterpriseModuleStorePath } from '../../framework';
import { leadModule } from './leadModuleInstance';
import { quoteModule } from '../sales/quoteModuleInstance';
import { createOpportunityModule } from './opportunityModule';

export const opportunityModule = createOpportunityModule(
  enterpriseModuleStorePath(app.getPath('userData'), OPPORTUNITIES_MODULE_ID),
  leadModule.store,
  quoteModule.store,
);
