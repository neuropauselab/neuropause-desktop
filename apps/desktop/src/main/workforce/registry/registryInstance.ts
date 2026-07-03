/**
 * The application's WorkerRegistry singleton, backed by a file under Electron's
 * userData directory. Kept apart from workerRegistry.ts so the class stays
 * electron-free and unit-testable.
 */
import { join } from 'node:path';
import { app } from 'electron';
import { WorkerRegistry } from './workerRegistry';

export const workerRegistry = new WorkerRegistry(join(app.getPath('userData'), 'workforce-registry.json'));
