/**
 * The application's WorkspaceStore singleton, backed by a file under Electron's
 * userData directory. Kept apart from workspaceStore.ts so the class stays
 * electron-free and unit-testable.
 */
import { join } from 'node:path';
import { app } from 'electron';
import { WorkspaceStore } from './workspaceStore';

export const workspaceStore = new WorkspaceStore(join(app.getPath('userData'), 'enterprise-workspaces.json'));
