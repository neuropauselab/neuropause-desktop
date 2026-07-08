/**
 * The process-wide Leads module singleton — binds the Electron-free module to
 * `userData` (via the framework's canonical path) and the shared AI engine.
 * Mirrors the Contacts/Finance instance + the `*Instance.ts` pattern.
 */
import { app } from 'electron';
import { LEADS_MODULE_ID } from '@neuropause/shared';
import { aiEngine } from '../../../ai/engineInstance';
import { enterpriseModuleStorePath } from '../../framework';
import { createLeadModule } from './leadModule';
import { runLeadAi } from './leadAi';

export const leadModule = createLeadModule(
  enterpriseModuleStorePath(app.getPath('userData'), LEADS_MODULE_ID),
  (lead, signals) => runLeadAi(aiEngine, lead, signals),
);
