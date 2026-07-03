/**
 * The process-wide unified store instance. Kept separate from the store class so
 * the class stays Electron-free and unit-testable (the test constructs its own
 * instance against a temp path).
 */
import { join } from 'node:path';
import { app } from 'electron';
import { UnifiedStore } from './unifiedStore';

export const unifiedStore = new UnifiedStore(join(app.getPath('userData'), 'unified-store.json'));
