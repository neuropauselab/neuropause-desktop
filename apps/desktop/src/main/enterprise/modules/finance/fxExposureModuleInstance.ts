/**
 * The process-wide FX Exposure module singleton — binds the Electron-free module to
 * `userData` and injects the Invoices + Vendor Bills + Exchange Rates stores (the open
 * AR/AP positions and marking rates) plus the Ledger Accounts + Journal stores (to
 * derive foreign cash/bank balances from the posted ledger), mirroring the finance
 * `*Instance.ts` pattern.
 */
import { app } from 'electron';
import { FX_EXPOSURE_MODULE_ID } from '@neuropause/shared';
import { enterpriseModuleStorePath } from '../../framework';
import { invoiceModule } from './invoiceModuleInstance';
import { vendorBillModule } from './vendorBillModuleInstance';
import { exchangeRateModule } from './exchangeRateModuleInstance';
import { ledgerAccountModule } from './ledgerAccountModuleInstance';
import { journalEntryModule } from './journalEntryModuleInstance';
import { createFxExposureModule } from './fxExposureModule';

export const fxExposureModule = createFxExposureModule(
  enterpriseModuleStorePath(app.getPath('userData'), FX_EXPOSURE_MODULE_ID),
  invoiceModule.store,
  vendorBillModule.store,
  exchangeRateModule.store,
  ledgerAccountModule.store,
  journalEntryModule.store,
);
