/**
 * The process-wide Treasury Positions module singleton — binds the
 * Electron-free module to `userData`, mirroring the `*Instance.ts` pattern.
 * Source stores (chart, invoices, vendor bills) resolve from the runtime
 * action context at refresh time — no construction-order coupling.
 */
import { app } from 'electron';
import { TREASURY_POSITIONS_MODULE_ID } from '@neuropause/shared';
import { enterpriseModuleStorePath } from '../../framework';
import { createTreasuryPositionModule } from './treasuryPositionModule';

export const treasuryPositionModule = createTreasuryPositionModule(
  enterpriseModuleStorePath(app.getPath('userData'), TREASURY_POSITIONS_MODULE_ID),
);
