import { join } from 'node:path';
import { app } from 'electron';
import { HealthHistoryStore } from './healthHistoryStore';

/** App-wide health-history store, persisted under userData. */
export const healthHistoryStore = new HealthHistoryStore(
  join(app.getPath('userData'), 'health-history.json'),
);
