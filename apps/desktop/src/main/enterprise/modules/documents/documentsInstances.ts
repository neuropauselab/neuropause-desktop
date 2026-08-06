/**
 * The process-wide Documents module singleton — binds the Electron-free module
 * to `userData` (via the framework's canonical path), mirroring the
 * `*Instances.ts` pattern.
 */
import { app } from 'electron';
import { DOCUMENTS_MODULE_ID } from '@neuropause/shared';
import { enterpriseModuleStorePath } from '../../framework';
import { createDocumentModule } from './documentModule';

export const documentModule = createDocumentModule(
  enterpriseModuleStorePath(app.getPath('userData'), DOCUMENTS_MODULE_ID),
);
