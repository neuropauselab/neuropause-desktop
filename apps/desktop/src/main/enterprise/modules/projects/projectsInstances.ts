/**
 * The process-wide Projects module singletons — bind the Electron-free modules
 * to `userData` (via the framework's canonical path), mirroring the
 * `*Instances.ts` pattern. Wiring is acyclic: tasks take the project store for
 * their open-project guard; project ACTIONS reach tasks at runtime through the
 * action context (the W1 cross-module pattern) — one store instance per file.
 */
import { app } from 'electron';
import { PROJECTS_MODULE_ID, PROJECT_TASKS_MODULE_ID } from '@neuropause/shared';
import { enterpriseModuleStorePath } from '../../framework';
import { customerModule } from '../crm/customerModuleInstance';
import { contractModule } from '../sales/contractModuleInstance';
import { createProjectModule } from './projectModule';
import { createProjectTaskModule } from './projectTaskModule';

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
