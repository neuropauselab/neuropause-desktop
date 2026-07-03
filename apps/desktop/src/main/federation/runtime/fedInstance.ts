/** The FederationRuntimeStore singleton, backed by userData. */
import { join } from 'node:path';
import { app } from 'electron';
import { FederationRuntimeStore } from './fedStore';
import { ORG_ID } from '../../enterprise/org/seed';

export const fedStore = new FederationRuntimeStore(join(app.getPath('userData'), 'federation-runtime.json'), ORG_ID, 'NeuroPause');
