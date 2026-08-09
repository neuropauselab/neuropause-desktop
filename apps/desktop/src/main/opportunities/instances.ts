/**
 * The Opportunity subsystem's one singleton.
 *
 * Only decisions persist — findings are recomputed on every read — so this is
 * the whole of the subsystem's disk footprint.
 */
import { app } from 'electron';
import { join } from 'node:path';
import { OpportunityDecisionStore } from './opportunityDecisionStore';

export const opportunityDecisionStore = new OpportunityDecisionStore(
  join(app.getPath('userData'), 'opportunity-decisions.json'),
);
