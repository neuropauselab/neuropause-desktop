import { join } from 'node:path';
import { app } from 'electron';
import { DecisionStore } from './decisionStore';

/** App-wide executive decision store, persisted under userData. */
export const decisionStore = new DecisionStore(
  join(app.getPath('userData'), 'executive-decisions.json'),
);
