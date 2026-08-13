/**
 * The process-wide Commission Statements module singleton — binds the
 * Electron-free module to `userData` (via the framework's canonical path) and
 * injects the Opportunities + Commission Plans stores generation reads from,
 * mirroring the `*Instance.ts` pattern used across main.
 */
import { app } from 'electron';
import { COMMISSION_STATEMENTS_MODULE_ID } from '@neuropause/shared';
import { enterpriseModuleStorePath } from '../../framework';
import { opportunityModule } from '../crm/opportunityModuleInstance';
import { commissionPlanModule } from './commissionPlanModuleInstance';
import { createCommissionStatementModule } from './commissionStatementModule';

export const commissionStatementModule = createCommissionStatementModule(
  enterpriseModuleStorePath(app.getPath('userData'), COMMISSION_STATEMENTS_MODULE_ID),
  opportunityModule.store,
  commissionPlanModule.store,
);
