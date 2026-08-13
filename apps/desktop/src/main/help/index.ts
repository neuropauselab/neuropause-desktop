/**
 * In-app help (Phase 8 · RC hardening 8.14) — opens the BUNDLED documentation
 * set. Before this, 274 files of documentation existed in the repository and
 * not one was reachable from the product; a pilot user with only the DMG had
 * no documentation at all.
 *
 * Fail-closed: the request schema validates against the fixed HELP_DOC_IDS
 * enum, and paths resolve exclusively from the HELP_DOC_BY_ID catalog under
 * the bundled docs root — there is no arbitrary-path or arbitrary-URL surface.
 * Docs open with the OS default Markdown/text viewer via shell.openPath.
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { app, shell } from 'electron';
import { EmptyRequest, HELP_DOCS, HELP_DOC_BY_ID, IpcChannel } from '@neuropause/shared';
import { HelpOpenDocRequest } from '@neuropause/shared';
import type { SecureHandlerDef } from '../ipc/secureBridge';

/** Candidate docs roots: packaged resources first, then the dev repo. */
function docsRoots(): string[] {
  const roots: string[] = [];
  if (process.resourcesPath) roots.push(join(process.resourcesPath, 'docs'));
  // Dev: apps/desktop → repo root /docs (and THIRD-PARTY-NOTICES.md at root).
  roots.push(join(app.getAppPath(), '..', '..', 'docs'));
  return roots;
}

async function resolveDocPath(relativePath: string): Promise<string | null> {
  for (const root of docsRoots()) {
    const candidate = join(root, relativePath);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      /* try next root */
    }
  }
  // Repo-root fallback for the notices file, which lives beside docs/ in dev.
  if (relativePath === 'THIRD-PARTY-NOTICES.md') {
    const candidate = join(app.getAppPath(), '..', '..', 'THIRD-PARTY-NOTICES.md');
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      /* absent */
    }
  }
  return null;
}

export function initHelp(): { handlers: SecureHandlerDef[] } {
  const handlers: SecureHandlerDef[] = [
    {
      channel: IpcChannel.HelpListDocs,
      schema: EmptyRequest,
      handler: () => [...HELP_DOCS],
    },
    {
      channel: IpcChannel.HelpOpenDoc,
      schema: HelpOpenDocRequest,
      handler: async (payload) => {
        const { doc } = payload as HelpOpenDocRequest;
        const meta = HELP_DOC_BY_ID[doc];
        const path = await resolveDocPath(meta.relativePath);
        if (!path) {
          return { ok: false, error: `"${meta.title}" is not bundled with this build.` };
        }
        const openError = await shell.openPath(path);
        return openError ? { ok: false, error: openError } : { ok: true };
      },
    },
  ];
  return { handlers };
}
