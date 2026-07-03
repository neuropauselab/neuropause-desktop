/**
 * Process-wide sync-state instance. Separate from the class so the class stays
 * Electron-free and testable.
 */
import { join } from 'node:path';
import { app } from 'electron';
import { SyncStateStore } from './syncStateStore';

export const syncStateStore = new SyncStateStore(join(app.getPath('userData'), 'sync-state.json'));
