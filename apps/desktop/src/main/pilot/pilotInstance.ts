/** The pilot service singleton, backed by userData. */
import { join } from 'node:path';
import { app } from 'electron';
import { createPilotService } from './pilotService';

export const pilotService = createPilotService({
  filePath: join(app.getPath('userData'), 'pilot.json'),
});
