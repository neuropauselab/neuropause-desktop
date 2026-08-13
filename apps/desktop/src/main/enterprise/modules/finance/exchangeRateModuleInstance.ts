/**
 * The process-wide Exchange Rates module singleton — binds the Electron-free
 * module to `userData` (via the framework's canonical path), mirroring the
 * finance `*Instance.ts` pattern.
 */
import { app } from 'electron';
import { EXCHANGE_RATES_MODULE_ID } from '@neuropause/shared';
import { enterpriseModuleStorePath } from '../../framework';
import { createExchangeRateModule } from './exchangeRateModule';

export const exchangeRateModule = createExchangeRateModule(
  enterpriseModuleStorePath(app.getPath('userData'), EXCHANGE_RATES_MODULE_ID),
);
