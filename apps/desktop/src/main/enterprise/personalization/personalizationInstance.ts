/**
 * The process-wide Enterprise Personalization store singleton — binds the Electron-free
 * PersonalizationStore to a JSON document under userData. Kept separate so the store class stays testable.
 */
import { app } from 'electron';
import { join } from 'node:path';
import { PersonalizationStore } from './personalizationStore';

export const personalizationStore = new PersonalizationStore(join(app.getPath('userData'), 'enterprise-personalization.json'));
