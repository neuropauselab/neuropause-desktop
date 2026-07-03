/**
 * The application's MemoryStore singleton, backed by a file under Electron's
 * userData directory. Kept apart from memoryStore.ts so the class stays
 * electron-free and unit-testable.
 */
import { join } from 'node:path';
import { app } from 'electron';
import { MemoryStore } from './memoryStore';

export const memoryStore = new MemoryStore(join(app.getPath('userData'), 'memory.json'));
