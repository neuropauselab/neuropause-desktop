/** The SyncStore singleton (cloud synchronization), backed by userData. */
import { join } from 'node:path';
import { app } from 'electron';
import { SyncStore } from './syncStore';

export const syncStore = new SyncStore(join(app.getPath('userData'), 'cloud-sync.json'));
