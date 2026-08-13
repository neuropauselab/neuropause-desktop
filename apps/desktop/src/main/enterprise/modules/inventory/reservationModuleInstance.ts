/**
 * The process-wide Reservations module singleton — binds the Electron-free
 * module to `userData` (via the framework's canonical path) and injects the
 * Movements + Products stores the availability guard reads from, mirroring
 * the `*Instance.ts` pattern.
 */
import { app } from 'electron';
import { RESERVATIONS_MODULE_ID } from '@neuropause/shared';
import { enterpriseModuleStorePath } from '../../framework';
import { productModule } from './productModuleInstance';
import { stockMovementModule } from './stockMovementModuleInstance';
import { createReservationModule } from './reservationModule';

export const reservationModule = createReservationModule(
  enterpriseModuleStorePath(app.getPath('userData'), RESERVATIONS_MODULE_ID),
  stockMovementModule.store,
  productModule.store,
);
