/**
 * The process-wide Revenue Forecast module singleton — binds the Electron-free
 * module to `userData` (via the framework's canonical path) and injects the
 * Opportunities store generation reads from, mirroring the `*Instance.ts`
 * pattern used across main.
 */
import { app } from 'electron';
import { REVENUE_FORECAST_MODULE_ID } from '@neuropause/shared';
import { enterpriseModuleStorePath } from '../../framework';
import { opportunityModule } from '../crm/opportunityModuleInstance';
import { createRevenueForecastModule } from './revenueForecastModule';

export const revenueForecastModule = createRevenueForecastModule(
  enterpriseModuleStorePath(app.getPath('userData'), REVENUE_FORECAST_MODULE_ID),
  opportunityModule.store,
);
