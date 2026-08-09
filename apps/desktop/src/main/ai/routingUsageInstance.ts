/**
 * The process-wide routing-usage store — binds the Electron-free store to
 * userData, following the `*Instance.ts` pattern. Wired into the shared AiEngine
 * instance below so every AI run in the app lands one measured count.
 */
import { app } from 'electron';
import { join } from 'node:path';
import { RoutingUsageStore } from './routingUsageStore';

export const routingUsageStore = new RoutingUsageStore(
  join(app.getPath('userData'), 'ai-routing-usage.json'),
);
