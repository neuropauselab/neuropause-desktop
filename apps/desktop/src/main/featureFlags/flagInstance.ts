/** The feature-flag service singleton, backed by userData. */
import { join } from 'node:path';
import { app } from 'electron';
import { createFlagService } from './flagService';

export const flagService = createFlagService({
  filePath: join(app.getPath('userData'), 'feature-flags.json'),
});
