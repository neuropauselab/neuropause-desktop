/** The DrStore singleton (disaster recovery), backed by userData. */
import { join } from 'node:path';
import { app } from 'electron';
import { DrStore } from './drStore';

export const drStore = new DrStore(join(app.getPath('userData'), 'federation-dr.json'));
