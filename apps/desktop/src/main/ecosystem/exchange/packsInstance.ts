/** The PacksStore singleton (Organization Exchange), backed by userData. */
import { join } from 'node:path';
import { app } from 'electron';
import { PacksStore } from './packsStore';
import { ORG_ID } from '../../enterprise/org/seed';

export const packsStore = new PacksStore(join(app.getPath('userData'), 'ecosystem-packs.json'), ORG_ID, 'NeuroPause');
