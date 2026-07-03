/** The ObservabilityStore singleton (historical reporting), backed by userData. */
import { join } from 'node:path';
import { app } from 'electron';
import { ObservabilityStore } from './observabilityStore';

export const observabilityStore = new ObservabilityStore(join(app.getPath('userData'), 'federation-observability.json'));
