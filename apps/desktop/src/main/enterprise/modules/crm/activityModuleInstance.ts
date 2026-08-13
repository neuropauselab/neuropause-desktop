/**
 * The process-wide Activities module singleton — binds the Electron-free
 * module to `userData` (via the framework's canonical path) and injects the
 * Leads + Opportunities + Customers stores the ref guards and the
 * staleness-clock touch wiring read from, mirroring the `*Instance.ts`
 * pattern used across main.
 */
import { app } from 'electron';
import { ACTIVITIES_MODULE_ID } from '@neuropause/shared';
import { enterpriseModuleStorePath } from '../../framework';
import { leadModule } from './leadModuleInstance';
import { customerModule } from './customerModuleInstance';
import { opportunityModule } from './opportunityModuleInstance';
import { createActivityModule } from './activityModule';

export const activityModule = createActivityModule(
  enterpriseModuleStorePath(app.getPath('userData'), ACTIVITIES_MODULE_ID),
  leadModule.store,
  opportunityModule.store,
  customerModule.store,
);
