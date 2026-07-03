/** The GlobalGovStore singleton (global governance), backed by userData. */
import { join } from 'node:path';
import { app } from 'electron';
import { GlobalGovStore } from './globalGovStore';
import { ORG_ID } from '../../enterprise/org/seed';

export const globalGovStore = new GlobalGovStore(join(app.getPath('userData'), 'federation-governance.json'), ORG_ID, 'NeuroPause');
