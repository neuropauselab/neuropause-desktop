/**
 * The process-wide Quotes module singleton — binds the Electron-free module to
 * `userData` (via the framework's canonical path) and the shared AI engine.
 * Mirrors the CRM/Finance instance + the `*Instance.ts` pattern.
 */
import { app } from 'electron';
import { QUOTES_MODULE_ID } from '@neuropause/shared';
import { aiEngine } from '../../../ai/engineInstance';
import { enterpriseModuleStorePath } from '../../framework';
import { createQuoteModule } from './quoteModule';
import { runQuoteAi } from './quoteAi';

export const quoteModule = createQuoteModule(
  enterpriseModuleStorePath(app.getPath('userData'), QUOTES_MODULE_ID),
  (quote, signals) => runQuoteAi(aiEngine, quote, signals),
);
