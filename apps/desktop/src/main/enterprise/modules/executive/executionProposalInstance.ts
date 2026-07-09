/**
 * The process-wide Execution Proposals module singleton — binds the proposal record store to
 * `userData`. Proposals are created by the decision handoff link (a verified decision → one inert
 * proposal) and confirmed by a human; nothing here executes production.
 */
import { app } from 'electron';
import { EXECUTION_PROPOSALS_MODULE_ID } from '@neuropause/shared';
import { enterpriseModuleStorePath } from '../../framework';
import { createExecutionProposalModule } from './executionProposalModule';

export const executionProposalModule = createExecutionProposalModule(
  enterpriseModuleStorePath(app.getPath('userData'), EXECUTION_PROPOSALS_MODULE_ID),
);
