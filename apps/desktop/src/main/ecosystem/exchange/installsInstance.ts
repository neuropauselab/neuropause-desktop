/** The InstallsStore singleton, backed by a file under Electron's userData directory. */
import { join } from 'node:path';
import { app } from 'electron';
import { InstallsStore } from './installsStore';

export const installsStore = new InstallsStore(join(app.getPath('userData'), 'ecosystem-installs.json'));
