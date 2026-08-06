/**
 * The process-wide Campaigns module singleton — binds the Electron-free module
 * to `userData` (via the framework's canonical path) and injects the Leads
 * store live attribution reads from, mirroring the `*Instance.ts` pattern.
 */
import { app } from 'electron';
import { CAMPAIGNS_MODULE_ID } from '@neuropause/shared';
import { enterpriseModuleStorePath } from '../../framework';
import { leadModule } from './leadModuleInstance';
import { createCampaignModule } from './campaignModule';

export const campaignModule = createCampaignModule(
  enterpriseModuleStorePath(app.getPath('userData'), CAMPAIGNS_MODULE_ID),
  leadModule.store,
);
