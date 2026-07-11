/**
 * The application's WebhookStore singleton, backed by a file under Electron's
 * userData. Kept apart from webhookStore.ts so the class stays electron-free and
 * unit-testable on a temp file.
 */
import { join } from 'node:path';
import { app } from 'electron';
import { WebhookStore } from './webhookStore';

export const webhookStore = new WebhookStore(join(app.getPath('userData'), 'webhooks.json'));
