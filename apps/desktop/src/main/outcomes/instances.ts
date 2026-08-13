/**
 * The outcome subsystem's one singleton.
 *
 * Measurements are derived on every read, so the only thing on disk is the
 * audit trail of what was observed and when.
 */
import { app } from 'electron';
import { join } from 'node:path';
import { OutcomeRevisionStore } from './outcomeRevisionStore';

export const outcomeRevisionStore = new OutcomeRevisionStore(
  join(app.getPath('userData'), 'outcome-revisions.json'),
  () => new Date().toISOString(),
);

export { OutcomeRevisionStore };
