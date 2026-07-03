/** The FederationStore singleton (identity federation), backed by userData. */
import { join } from 'node:path';
import { app } from 'electron';
import { FederationStore } from './federationStore';

export const federationStore = new FederationStore(join(app.getPath('userData'), 'cloud-identity.json'));
