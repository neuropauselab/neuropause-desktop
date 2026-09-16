/**
 * The process-wide Demand Trend module singleton — binds the Electron-free module to `userData`
 * and injects the Shipping store (the canonical demand source), mirroring the `*Instance.ts`
 * pattern. Reads shipments; writes only its own immutable snapshot.
 */
import { app } from 'electron';
import { enterpriseModuleStorePath } from '../../framework';
import { shippingModule } from '../warehouse/warehouseInstances';
import { createDemandTrendModule, DEMAND_TREND_MODULE_ID } from './demandTrendModule';

export const demandTrendModule = createDemandTrendModule(
  enterpriseModuleStorePath(app.getPath('userData'), DEMAND_TREND_MODULE_ID),
  shippingModule.store,
);
