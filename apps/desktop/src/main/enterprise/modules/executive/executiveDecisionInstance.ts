/**
 * The process-wide Executive Decision module singleton — binds the governance record store to
 * `userData` and wires the read-only planning-model provider the verification action re-runs the
 * Digital Twin against.
 */
import { app } from 'electron';
import { EXECUTIVE_DECISIONS_MODULE_ID } from '@neuropause/shared';
import { enterpriseModuleStorePath } from '../../framework';
import { collectPlanningModel } from '../../planningModel';
import { createExecutiveDecisionModule } from './executiveDecisionModule';

export const executiveDecisionModule = createExecutiveDecisionModule(
  enterpriseModuleStorePath(app.getPath('userData'), EXECUTIVE_DECISIONS_MODULE_ID),
  collectPlanningModel,
);
