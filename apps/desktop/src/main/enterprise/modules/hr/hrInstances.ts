/**
 * The process-wide HR module singletons — bind the Electron-free modules to
 * `userData` (via the framework's canonical path), mirroring the
 * `*Instances.ts` pattern. Salary structures are created first so employee
 * validation can guard template assignment; payroll reads the employee
 * store; its GL posting goes through the runtime action context (the W1 seam).
 */
import { app } from 'electron';
import {
  EMPLOYEES_MODULE_ID,
  PAYROLL_RUNS_MODULE_ID,
  SALARY_STRUCTURES_MODULE_ID,
  STATUTORY_RULES_MODULE_ID,
} from '@neuropause/shared';
import { enterpriseModuleStorePath } from '../../framework';
import { createEmployeeModule } from './employeeModule';
import { createPayrollRunModule } from './payrollRunModule';
import { createSalaryStructureModule } from './salaryStructureModule';
import { createStatutoryRuleModule } from './statutoryRuleModule';

const store = (id: string): string => enterpriseModuleStorePath(app.getPath('userData'), id);

export const salaryStructureModule = createSalaryStructureModule(store(SALARY_STRUCTURES_MODULE_ID));

export const statutoryRuleModule = createStatutoryRuleModule(store(STATUTORY_RULES_MODULE_ID));

export const employeeModule = createEmployeeModule(
  store(EMPLOYEES_MODULE_ID),
  salaryStructureModule.store,
);

export const payrollRunModule = createPayrollRunModule(
  store(PAYROLL_RUNS_MODULE_ID),
  employeeModule.store,
);
