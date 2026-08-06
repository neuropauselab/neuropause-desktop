/**
 * The process-wide BOM Explosions module singleton — binds the Electron-free
 * module to `userData` (via the framework's canonical path) and injects the
 * BOMs + Products stores generation reads from, mirroring the `*Instance.ts`
 * pattern used across main.
 */
import { app } from 'electron';
import { BOM_EXPLOSIONS_MODULE_ID } from '@neuropause/shared';
import { enterpriseModuleStorePath } from '../../framework';
import { bomModule } from './manufacturingInstances';
import { productModule } from '../inventory/productModuleInstance';
import { createBomExplosionModule } from './bomExplosionModule';

export const bomExplosionModule = createBomExplosionModule(
  enterpriseModuleStorePath(app.getPath('userData'), BOM_EXPLOSIONS_MODULE_ID),
  bomModule.store,
  productModule.store,
);
