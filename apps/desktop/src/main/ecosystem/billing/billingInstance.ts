/**
 * The BillingStore singleton, backed by a file under Electron's userData
 * directory. Seeded with a Free subscription bound to the organization owner.
 */
import { join } from 'node:path';
import { app } from 'electron';
import { BillingStore } from './billingStore';
import { ORG_ID, OWNER_USER_ID } from '../../enterprise/org/seed';

export const billingStore = new BillingStore(join(app.getPath('userData'), 'ecosystem-billing.json'), {
  orgId: ORG_ID,
  ownerUserId: OWNER_USER_ID,
  ownerName: 'Organization Owner',
});
