/**
 * The application's OrgStore singleton, backed by a file under Electron's
 * userData directory. Kept apart from orgStore.ts so the class stays
 * electron-free and unit-testable.
 */
import { join } from 'node:path';
import { app } from 'electron';
import { OrgStore } from './orgStore';

export const orgStore = new OrgStore(join(app.getPath('userData'), 'enterprise-org.json'));
