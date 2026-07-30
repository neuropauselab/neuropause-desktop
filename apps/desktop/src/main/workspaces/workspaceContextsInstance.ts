/**
 * The application's WorkspaceContextStore singleton, backed by a file under
 * Electron's userData directory. Kept apart from workspaceContextStore.ts so
 * the class stays electron-free and unit-testable (memoryInstance idiom).
 */
import { join } from 'node:path';
import { app } from 'electron';
import { WorkspaceContextStore } from './workspaceContextStore';

export const workspaceContexts = new WorkspaceContextStore(
  join(app.getPath('userData'), 'workspace-contexts.json'),
);

// Session recovery depends on the last snapshot reaching disk: flush the
// debounced writer when the app is quitting (mirrors windowState's on-close
// flush; a no-op when nothing is pending).
app.on('before-quit', () => workspaceContexts.flush());
