/**
 * The process-wide Projects module singletons — bind the Electron-free modules
 * to `userData` (via the framework's canonical path), mirroring the
 * `*Instances.ts` pattern. Wiring is acyclic: tasks take the project store for
 * their open-project guard; project ACTIONS reach tasks at runtime through the
 * action context (the W1 cross-module pattern) — one store instance per file.
 */
import { app } from 'electron';
import {
  BILLING_RUNS_MODULE_ID,
  PROJECTS_MODULE_ID,
  PROJECT_TASKS_MODULE_ID,
  TIME_ENTRIES_MODULE_ID,
} from '@neuropause/shared';
import { enterpriseModuleStorePath } from '../../framework';
import { customerModule } from '../crm/customerModuleInstance';
import { contractModule } from '../sales/contractModuleInstance';
import { createProjectModule } from './projectModule';
import { createProjectTaskModule } from './projectTaskModule';
import { createTimeEntryModule } from './timeEntryModule';
import { createBillingRunModule } from './billingRunModule';

const store = (id: string): string => enterpriseModuleStorePath(app.getPath('userData'), id);

export const projectModule = createProjectModule(
  store(PROJECTS_MODULE_ID),
  customerModule.store,
  contractModule.store,
);

export const projectTaskModule = createProjectTaskModule(
  store(PROJECT_TASKS_MODULE_ID),
  projectModule.store,
);

// W4.2 — the portfolio→billing chain: time entries guarded by open projects,
// billing runs previewing over them and issuing REAL W1 invoices at runtime.
export const timeEntryModule = createTimeEntryModule(
  store(TIME_ENTRIES_MODULE_ID),
  projectModule.store,
);

export const billingRunModule = createBillingRunModule(
  store(BILLING_RUNS_MODULE_ID),
  timeEntryModule.store,
  projectModule.store,
  customerModule.store,
);
