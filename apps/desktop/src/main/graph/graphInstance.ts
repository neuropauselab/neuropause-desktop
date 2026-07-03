/**
 * The application's GraphStore singleton, backed by a file under Electron's
 * userData directory. Kept apart from graphStore.ts so the class stays
 * electron-free and unit-testable; only the runtime composition imports this.
 */
import { join } from 'node:path';
import { app } from 'electron';
import { GraphStore } from './graphStore';

export const graphStore = new GraphStore(join(app.getPath('userData'), 'graph.json'));
