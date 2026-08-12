import { join } from 'node:path';
import { app } from 'electron';
import { TenantAiPreferenceStore } from './tenantAiPreferenceStore';

/**
 * App-wide tenant AI preference store, persisted under userData.
 *
 * A module-level instance like `healthHistoryInstance`, so the composition root
 * binds exactly one boundary — and so `assertAllTenantStoresBound` sees it. The
 * binding happens in `enterprise/index.ts` beside the other tenant stores,
 * which runs BELOW the relocated startup gates (Round 17).
 */
export const tenantAiPreferenceStore = new TenantAiPreferenceStore(
  join(app.getPath('userData'), 'tenant-ai-preference.json'),
);
