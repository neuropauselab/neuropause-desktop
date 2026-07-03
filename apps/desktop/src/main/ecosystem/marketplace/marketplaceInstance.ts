/**
 * The MarketplaceStore singleton, backed by a file under Electron's userData
 * directory and seeded with example listings owned by the default developer.
 */
import { join } from 'node:path';
import { app } from 'electron';
import { MarketplaceStore } from './marketplaceStore';
import { SEED_LISTINGS } from './seeds';

export const marketplaceStore = new MarketplaceStore(join(app.getPath('userData'), 'ecosystem-marketplace.json'), 'dev-owner', SEED_LISTINGS);
