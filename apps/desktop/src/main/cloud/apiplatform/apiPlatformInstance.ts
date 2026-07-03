/** The ApiPlatformStore singleton (enterprise API platform), backed by userData. */
import { join } from 'node:path';
import { app } from 'electron';
import { ApiPlatformStore } from './apiPlatformStore';

export const apiPlatformStore = new ApiPlatformStore(join(app.getPath('userData'), 'cloud-apiplatform.json'));
