/**
 * The application's GovernanceStore singleton, backed by a file under Electron's
 * userData directory. Kept apart from governanceStore.ts so the class stays
 * electron-free and unit-testable.
 */
import { join } from 'node:path';
import { app } from 'electron';
import { GovernanceStore } from './governanceStore';

export const governanceStore = new GovernanceStore(join(app.getPath('userData'), 'enterprise-governance.json'));
