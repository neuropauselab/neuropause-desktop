/**
 * The process-wide CRM module singleton — binds the Electron-free module to
 * `userData` (via the framework's canonical path) and the shared AI engine.
 * Mirrors the Finance instance + the `*Instance.ts` pattern across main.
 */
import { app } from 'electron';
import { CRM_MODULE_ID } from '@neuropause/shared';
import { aiEngine } from '../../../ai/engineInstance';
import { enterpriseModuleStorePath } from '../../framework';
import { createContactModule } from './contactModule';
import { runContactAi } from './contactAi';

export const contactModule = createContactModule(
  enterpriseModuleStorePath(app.getPath('userData'), CRM_MODULE_ID),
  (contact, health) => runContactAi(aiEngine, contact, health),
);
