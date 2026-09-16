/**
 * The process-wide Reorder Decision Readiness module singleton — binds the Electron-free module to
 * `userData` and injects the Product + Purchase-Request + Purchase-Order + Shipping stores it READS,
 * mirroring the `*Instance.ts` pattern. Decision intelligence only: it writes only its own immutable
 * snapshot and never drafts a purchase request, moves stock, or executes anything.
 */
import { app } from 'electron';
import { enterpriseModuleStorePath } from '../../framework';
import { productModule } from './productModuleInstance';
import { purchaseRequestModule, purchaseOrderModule } from '../procurement/procurementInstances';
import { shippingModule } from '../warehouse/warehouseInstances';
import { createReorderDecisionModule, REORDER_DECISION_MODULE_ID } from './reorderDecisionModule';

export const reorderDecisionModule = createReorderDecisionModule(
  enterpriseModuleStorePath(app.getPath('userData'), REORDER_DECISION_MODULE_ID),
  productModule.store,
  purchaseRequestModule.store,
  purchaseOrderModule.store,
  shippingModule.store,
);
