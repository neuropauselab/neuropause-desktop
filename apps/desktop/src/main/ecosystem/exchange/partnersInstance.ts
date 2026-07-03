/** The PartnersStore singleton (Partner Platform directory), backed by userData. */
import { join } from 'node:path';
import { app } from 'electron';
import { PartnersStore } from './partnersStore';

export const partnersStore = new PartnersStore(join(app.getPath('userData'), 'ecosystem-partners.json'));
