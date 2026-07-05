import { join } from 'node:path';
import { app } from 'electron';
import { AutomationStore } from './automationStore';

/** App-wide automation rule store, persisted under userData. */
export const automationStore = new AutomationStore(
  join(app.getPath('userData'), 'automations.json'),
);
