/**
 * The process-wide Manufacturing module singletons — bind the Electron-free modules
 * to `userData` (via the framework's canonical path) and the shared AI engine. These
 * are the eight production-layer modules; their stock effects (component consumption
 * + finished-goods output) all flow through the Inventory Ledger.
 */
import { app } from 'electron';
import {
  BOM_MODULE_ID,
  MACHINES_MODULE_ID,
  PRODUCTION_COSTINGS_MODULE_ID,
  PRODUCTION_EXECUTIONS_MODULE_ID,
  PRODUCTION_ORDERS_MODULE_ID,
  PRODUCTION_SCHEDULES_MODULE_ID,
  QUALITY_INSPECTIONS_MODULE_ID,
  WORK_CENTERS_MODULE_ID,
} from '@neuropause/shared';
import { aiEngine } from '../../../ai/engineInstance';
import { enterpriseModuleStorePath } from '../../framework';
import { createBomModule } from './bomModule';
import { createProductionOrderModule } from './productionOrderModule';
import { createWorkCenterModule } from './workCenterModule';
import { createMachineModule } from './machineModule';
import { createScheduleModule } from './scheduleModule';
import { createExecutionModule } from './executionModule';
import { createQualityModule } from './qualityModule';
import { createCostingModule } from './costingModule';
import { runCostingAi, runProductionOrderAi, runQualityAi } from './manufacturingAi';

const store = (id: string): string => enterpriseModuleStorePath(app.getPath('userData'), id);

export const bomModule = createBomModule(store(BOM_MODULE_ID));
export const productionOrderModule = createProductionOrderModule(store(PRODUCTION_ORDERS_MODULE_ID), (o) => runProductionOrderAi(aiEngine, o));
export const workCenterModule = createWorkCenterModule(store(WORK_CENTERS_MODULE_ID));
export const machineModule = createMachineModule(store(MACHINES_MODULE_ID));
export const scheduleModule = createScheduleModule(store(PRODUCTION_SCHEDULES_MODULE_ID));
export const executionModule = createExecutionModule(store(PRODUCTION_EXECUTIONS_MODULE_ID));
export const qualityModule = createQualityModule(store(QUALITY_INSPECTIONS_MODULE_ID), (q) => runQualityAi(aiEngine, q));
export const costingModule = createCostingModule(store(PRODUCTION_COSTINGS_MODULE_ID), (c) => runCostingAi(aiEngine, c));
