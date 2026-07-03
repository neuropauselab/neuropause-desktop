/**
 * The DeveloperStore singleton, backed by a file under Electron's userData
 * directory. The default developer account is bound to the organization owner.
 */
import { join } from 'node:path';
import { app } from 'electron';
import { DeveloperStore } from './developerStore';
import { ORG_ID } from '../../enterprise/org/seed';

export const developerStore = new DeveloperStore(join(app.getPath('userData'), 'ecosystem-developer.json'), {
  id: 'dev-owner',
  name: 'Organization Owner',
  email: 'owner@neuropause.local',
  organization: 'NeuroPause',
  orgId: ORG_ID,
});
