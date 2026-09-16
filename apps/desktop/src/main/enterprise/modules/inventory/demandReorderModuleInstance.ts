/**
 * The process-wide Reorder Recommendations module singleton — binds the Electron-free module to
 * `userData` and injects the Product + Purchase-Request + Purchase-Order + Shipping stores it
 * READS, mirroring the `*Instance.ts` pattern. Advisory only: it writes only its own immutable
 * snapshot and never drafts a purchase request or moves stock.
 */
import { app } from 'electron';
import { enterpriseModuleStorePath } from '../../framework';
import { productModule } from './productModuleInstance';
import { purchaseRequestModule, purchaseOrderModule } from '../procurement/procurementInstances';
import { shippingModule } from '../warehouse/warehouseInstances';
import { createReorderRecommendationModule, REORDER_RECOMMENDATION_MODULE_ID } from './demandReorderModule';

export const reorderRecommendationModule = createReorderRecommendationModule(
  enterpriseModuleStorePath(app.getPath('userData'), REORDER_RECOMMENDATION_MODULE_ID),
  productModule.store,
  purchaseRequestModule.store,
  purchaseOrderModule.store,
  shippingModule.store,
);
