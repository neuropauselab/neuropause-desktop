/**
 * The process-wide Commission Plans module singleton — binds the Electron-free
 * module to `userData` (via the framework's canonical path), mirroring the
 * `*Instance.ts` pattern used across main. The Commission Statements instance
 * injects this store to read the plan book at generation time.
 */
import { app } from 'electron';
import { COMMISSION_PLANS_MODULE_ID } from '@neuropause/shared';
import { enterpriseModuleStorePath } from '../../framework';
import { createCommissionPlanModule } from './commissionPlanModule';

export const commissionPlanModule = createCommissionPlanModule(
  enterpriseModuleStorePath(app.getPath('userData'), COMMISSION_PLANS_MODULE_ID),
);
