/**
 * The process-wide HR module singletons — bind the Electron-free modules to
 * `userData` (via the framework's canonical path), mirroring the
 * `*Instances.ts` pattern. Salary structures are created first so employee
 * validation can guard template assignment; payroll reads the employee
 * store; its GL posting goes through the runtime action context (the W1 seam).
 */
import { app } from 'electron';
import {
  ATTENDANCE_MODULE_ID,
  EMPLOYEES_MODULE_ID,
  PAYROLL_REGISTER_MODULE_ID,
  PAYROLL_RUNS_MODULE_ID,
  PAYSLIPS_MODULE_ID,
  SALARY_DISBURSEMENTS_MODULE_ID,
  SALARY_STRUCTURES_MODULE_ID,
  STATUTORY_FILINGS_MODULE_ID,
  STATUTORY_RULES_MODULE_ID,
} from '@neuropause/shared';
import { enterpriseModuleStorePath } from '../../framework';
import { createAttendanceModule } from './attendanceModule';
import { createEmployeeModule } from './employeeModule';
import { createPayrollRegisterModule } from './payrollRegisterModule';
import { createPayrollRunModule } from './payrollRunModule';
import { createPayslipModule } from './payslipModule';
import { createSalaryDisbursementModule } from './salaryDisbursementModule';
import { createSalaryStructureModule } from './salaryStructureModule';
import { createStatutoryFilingModule } from './statutoryFilingModule';
import { createStatutoryRuleModule } from './statutoryRuleModule';

const store = (id: string): string => enterpriseModuleStorePath(app.getPath('userData'), id);

export const salaryStructureModule = createSalaryStructureModule(store(SALARY_STRUCTURES_MODULE_ID));

export const statutoryRuleModule = createStatutoryRuleModule(store(STATUTORY_RULES_MODULE_ID));

export const employeeModule = createEmployeeModule(
  store(EMPLOYEES_MODULE_ID),
  salaryStructureModule.store,
);

export const attendanceModule = createAttendanceModule(
  store(ATTENDANCE_MODULE_ID),
  employeeModule.store,
);

export const payrollRunModule = createPayrollRunModule(
  store(PAYROLL_RUNS_MODULE_ID),
  employeeModule.store,
  salaryStructureModule.store,
  statutoryRuleModule.store,
  attendanceModule.store,
);

export const payslipModule = createPayslipModule(store(PAYSLIPS_MODULE_ID));

export const payrollRegisterModule = createPayrollRegisterModule(
  store(PAYROLL_REGISTER_MODULE_ID),
  payrollRunModule.store,
);

export const statutoryFilingModule = createStatutoryFilingModule(
  store(STATUTORY_FILINGS_MODULE_ID),
  payrollRunModule.store,
  employeeModule.store,
);

export const salaryDisbursementModule = createSalaryDisbursementModule(
  store(SALARY_DISBURSEMENTS_MODULE_ID),
  payrollRunModule.store,
  employeeModule.store,
);
