/**
 * The process-wide Contracts module singleton — binds the Electron-free module
 * to `userData` (via the framework's canonical path) and injects the
 * Customers + Opportunities stores the ref guards read from, mirroring the
 * `*Instance.ts` pattern used across main.
 */
import { app } from 'electron';
import { CONTRACTS_MODULE_ID } from '@neuropause/shared';
import { enterpriseModuleStorePath } from '../../framework';
import { customerModule } from '../crm/customerModuleInstance';
import { opportunityModule } from '../crm/opportunityModuleInstance';
import { createContractModule } from './contractModule';

export const contractModule = createContractModule(
  enterpriseModuleStorePath(app.getPath('userData'), CONTRACTS_MODULE_ID),
  customerModule.store,
  opportunityModule.store,
);
