/**
 * The process-wide ATP module singleton — binds the Electron-free module to `userData`
 * (via the framework's canonical path) and injects the authoritative stock-movement ledger
 * + purchase-order stores the snapshot reads from, mirroring the `*Instance.ts` pattern.
 */
import { app } from 'electron';
import { enterpriseModuleStorePath } from '../../framework';
import { stockMovementModule } from './stockMovementModuleInstance';
import { purchaseOrderModule } from '../procurement/procurementInstances';
import { createAtpModule, ATP_MODULE_ID } from './atpModule';

export const atpModule = createAtpModule(
  enterpriseModuleStorePath(app.getPath('userData'), ATP_MODULE_ID),
  stockMovementModule.store,
  purchaseOrderModule.store,
);
