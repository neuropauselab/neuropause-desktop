/**
 * The application's JobStore singleton, backed by a file under Electron's
 * userData directory. Kept apart from jobStore.ts so the class stays
 * electron-free and unit-testable.
 */
import { join } from 'node:path';
import { app } from 'electron';
import { JobStore } from './jobStore';

export const jobStore = new JobStore(join(app.getPath('userData'), 'workforce-jobs.json'));
