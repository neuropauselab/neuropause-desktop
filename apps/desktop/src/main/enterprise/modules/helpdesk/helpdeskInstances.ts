/**
 * The process-wide Helpdesk module singletons — bind the Electron-free modules
 * to `userData` (via the framework's canonical path), mirroring the
 * `*Instances.ts` pattern.
 */
import { app } from 'electron';
import { TICKETS_MODULE_ID } from '@neuropause/shared';
import { enterpriseModuleStorePath } from '../../framework';
import { customerModule } from '../crm/customerModuleInstance';
import { createTicketModule } from './ticketModule';

export const ticketModule = createTicketModule(
  enterpriseModuleStorePath(app.getPath('userData'), TICKETS_MODULE_ID),
  customerModule.store,
);
