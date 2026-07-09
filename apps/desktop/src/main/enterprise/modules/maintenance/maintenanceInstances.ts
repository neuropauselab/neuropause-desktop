/**
 * The process-wide Maintenance module singletons — bind the Electron-free modules to
 * `userData` (via the framework's canonical path) and the shared AI engine. These are
 * the ten maintenance modules; downtime + spare-parts effects flow through the
 * authoritative Machine record and the Inventory Ledger respectively.
 */
import { app } from 'electron';
import {
  ASSETS_MODULE_ID,
  ASSET_CATEGORIES_MODULE_ID,
  CORRECTIVE_MAINTENANCE_MODULE_ID,
  DOWNTIME_EVENTS_MODULE_ID,
  MAINTENANCE_HISTORY_MODULE_ID,
  MAINTENANCE_PLANS_MODULE_ID,
  PREVENTIVE_MAINTENANCE_MODULE_ID,
  SPARE_PARTS_MODULE_ID,
  TECHNICIANS_MODULE_ID,
  WORK_ORDERS_MODULE_ID,
} from '@neuropause/shared';
import { aiEngine } from '../../../ai/engineInstance';
import { enterpriseModuleStorePath } from '../../framework';
import { createAssetCategoryModule } from './assetCategoryModule';
import { createAssetModule } from './assetModule';
import { createMaintenancePlanModule } from './maintenancePlanModule';
import { createPreventiveMaintenanceModule } from './preventiveMaintenanceModule';
import { createCorrectiveMaintenanceModule } from './correctiveMaintenanceModule';
import { createWorkOrderModule } from './workOrderModule';
import { createTechnicianModule } from './technicianModule';
import { createMaintenanceHistoryModule } from './maintenanceHistoryModule';
import { createSparePartModule } from './sparePartModule';
import { createDowntimeEventModule } from './downtimeEventModule';
import { runAssetAi, runDowntimeAi, runWorkOrderAi } from './maintenanceAi';

const store = (id: string): string => enterpriseModuleStorePath(app.getPath('userData'), id);

export const assetCategoryModule = createAssetCategoryModule(store(ASSET_CATEGORIES_MODULE_ID));
export const assetModule = createAssetModule(store(ASSETS_MODULE_ID), (a) => runAssetAi(aiEngine, a));
export const maintenancePlanModule = createMaintenancePlanModule(store(MAINTENANCE_PLANS_MODULE_ID));
export const preventiveMaintenanceModule = createPreventiveMaintenanceModule(store(PREVENTIVE_MAINTENANCE_MODULE_ID));
export const correctiveMaintenanceModule = createCorrectiveMaintenanceModule(store(CORRECTIVE_MAINTENANCE_MODULE_ID));
export const workOrderModule = createWorkOrderModule(store(WORK_ORDERS_MODULE_ID), (w) => runWorkOrderAi(aiEngine, w));
export const technicianModule = createTechnicianModule(store(TECHNICIANS_MODULE_ID));
export const maintenanceHistoryModule = createMaintenanceHistoryModule(store(MAINTENANCE_HISTORY_MODULE_ID));
export const sparePartModule = createSparePartModule(store(SPARE_PARTS_MODULE_ID));
export const downtimeEventModule = createDowntimeEventModule(store(DOWNTIME_EVENTS_MODULE_ID), (e) => runDowntimeAi(aiEngine, e));
