/**
 * P9 — Marketplace singletons. Binds the org policy store to a userData path (0o600),
 * mirroring the house store-instance pattern.
 */
import { app } from 'electron';
import { join } from 'node:path';
import { OrgPolicyStore } from './orgPolicyStore';

export const orgPolicyStore = new OrgPolicyStore(join(app.getPath('userData'), 'marketplace-policy.json'));
