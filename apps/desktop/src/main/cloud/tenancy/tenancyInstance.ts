/** The TenancyStore singleton, backed by Electron's userData directory. */
import { join } from 'node:path';
import { app } from 'electron';
import { TenancyStore } from './tenancyStore';
import { ORG_ID } from '../../enterprise/org/seed';

export const tenancyStore = new TenancyStore(join(app.getPath('userData'), 'cloud-tenancy.json'), ORG_ID, 'NeuroPause');

export { CLOUD_REGIONS } from './tenancyStore';
