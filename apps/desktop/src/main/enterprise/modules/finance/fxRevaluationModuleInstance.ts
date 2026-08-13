/**
 * The process-wide FX Revaluation module singleton — binds the Electron-free
 * module to `userData` and injects the Invoices + Exchange Rates + Accounting
 * Periods stores the period-end revaluation reads (open receivables, real
 * registered rates, the period lock), mirroring the finance `*Instance.ts`
 * pattern.
 */
import { app } from 'electron';
import { FX_REVALUATION_MODULE_ID } from '@neuropause/shared';
import { enterpriseModuleStorePath } from '../../framework';
import { invoiceModule } from './invoiceModuleInstance';
import { exchangeRateModule } from './exchangeRateModuleInstance';
import { accountingPeriodModule } from './accountingPeriodModuleInstance';
import { vendorBillModule } from './vendorBillModuleInstance';
import { ledgerAccountModule } from './ledgerAccountModuleInstance';
import { journalEntryModule } from './journalEntryModuleInstance';
import { createFxRevaluationModule } from './fxRevaluationModule';

export const fxRevaluationModule = createFxRevaluationModule(
  enterpriseModuleStorePath(app.getPath('userData'), FX_REVALUATION_MODULE_ID),
  invoiceModule.store,
  exchangeRateModule.store,
  accountingPeriodModule.store,
  vendorBillModule.store,
  ledgerAccountModule.store,
  journalEntryModule.store,
);
