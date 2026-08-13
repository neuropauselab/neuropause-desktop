/**
 * The process-wide BI Reports module singleton — binds the Electron-free
 * module to `userData` (via the framework's canonical path); report targets
 * resolve at RUNTIME through the action context, so nothing is injected.
 */
import { app } from 'electron';
import { BI_REPORTS_MODULE_ID } from '@neuropause/shared';
import { enterpriseModuleStorePath } from '../../framework';
import { createBiReportModule } from './biReportModule';

export const biReportModule = createBiReportModule(
  enterpriseModuleStorePath(app.getPath('userData'), BI_REPORTS_MODULE_ID),
);
