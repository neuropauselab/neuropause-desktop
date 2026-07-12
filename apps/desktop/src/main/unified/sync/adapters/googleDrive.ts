/**
 * Google Drive adapter. Maps Drive files (incl. Docs/Sheets/Slides, which ARE Drive files with a
 * google-apps mimeType) → the UDM `file` kind.
 *
 * Incremental sync uses the Drive Changes API — the production-correct delta mechanism:
 *   INIT     — capture a `startPageToken` baseline FIRST (so nothing that changes during enumeration is
 *              missed), then enumerate existing files page by page (`files.list`).
 *   CHANGES  — from the baseline token, `changes.list(pageToken)` returns only what changed; `removed` /
 *              `file.trashed` become soft-deletes. The final page yields `newStartPageToken`, persisted as
 *              the next cursor. An expired/invalid page token (410/400) transparently restarts a full INIT.
 *
 * Mirrors googleCalendar.ts's cursor/token-reset pattern; the engine is untouched.
 */
import type { UnifiedEntity } from '@neuropause/shared';
import type { AdapterResource, SyncContext, SyncPage } from '../adapterSdk';
import { makeEntity } from '../adapterSdk';
import { makeUnifiedId } from '../../ids';
import { isExpiredCursorError } from './delta';
import { parseJsonCursor, toJsonCursor } from './util';

const DRIVE = 'https://www.googleapis.com/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const FILE_FIELDS = 'id,name,mimeType,createdTime,modifiedTime,webViewLink,parents,trashed,owners(displayName,emailAddress),size';
const FILES_LIST_FIELDS = `nextPageToken,files(${FILE_FIELDS})`;
const CHANGES_FIELDS = `nextPageToken,newStartPageToken,changes(fileId,removed,time,file(${FILE_FIELDS}))`;
const DRIVE_QUERY = { supportsAllDrives: true, includeItemsFromAllDrives: true } as const;

interface DriveFile {
  id: string;
  name?: string;
  mimeType?: string;
  createdTime?: string;
  modifiedTime?: string;
  webViewLink?: string;
  parents?: string[];
  trashed?: boolean;
  owners?: Array<{ displayName?: string; emailAddress?: string }>;
  size?: string;
}

interface DriveFilesResp {
  files?: DriveFile[];
  nextPageToken?: string;
}

interface DriveChange {
  fileId?: string;
  removed?: boolean;
  time?: string;
  file?: DriveFile;
}

interface DriveChangesResp {
  changes?: DriveChange[];
  nextPageToken?: string;
  newStartPageToken?: string;
}

/** INIT enumerates existing files; CHANGES follows the delta feed. `startToken` is captured once at INIT start. */
interface DriveCursor {
  phase: 'init' | 'changes';
  /** INIT: the files.list page token. */
  filesPage?: string;
  /** INIT: the changes baseline captured before enumeration. */
  startToken?: string;
  /** CHANGES: the changes.list page token. */
  pageToken?: string;
}

export function mapFile(ctx: SyncContext, f: DriveFile): UnifiedEntity {
  const isFolder = f.mimeType === FOLDER_MIME;
  const owner = f.owners?.[0];
  return makeEntity({
    connectorId: ctx.connectorId,
    accountId: ctx.accountId,
    kind: 'file',
    sourceId: f.id,
    now: ctx.now,
    title: f.name || '(untitled)',
    url: f.webViewLink ?? null,
    createdAt: f.createdTime ?? ctx.now,
    updatedAt: f.modifiedTime ?? ctx.now,
    body: null,
    status: f.trashed ? 'trashed' : 'active',
    author: owner?.emailAddress ?? owner?.displayName ?? null,
    timestamp: f.modifiedTime ?? null,
    // Link a file to its parent folder (also a `file`) so the graph can draw containment.
    containerId: f.parents?.[0] ? makeUnifiedId(ctx.connectorId, ctx.accountId, 'file', f.parents[0]) : null,
    metadata: {
      mimeType: f.mimeType ?? null,
      isFolder,
      size: f.size ? Number(f.size) : null,
      parent: f.parents?.[0] ?? null,
      owner: owner?.emailAddress ?? null,
    },
  });
}

async function startPageToken(ctx: SyncContext): Promise<string> {
  const resp = await ctx.http.getJson<{ startPageToken: string }>(`${DRIVE}/changes/startPageToken`, {
    query: { ...DRIVE_QUERY },
  });
  return resp.data.startPageToken;
}

async function pullFiles(ctx: SyncContext): Promise<SyncPage> {
  const c = parseJsonCursor<DriveCursor>(ctx.cursor);

  // ── CHANGES phase ──
  if (c && c.phase === 'changes' && c.pageToken) {
    let data: DriveChangesResp;
    try {
      data = (
        await ctx.http.getJson<DriveChangesResp>(`${DRIVE}/changes`, {
          query: { pageToken: c.pageToken, includeRemoved: true, pageSize: 100, fields: CHANGES_FIELDS, ...DRIVE_QUERY },
        })
      ).data;
    } catch (err) {
      // An expired/invalid change token → restart a full INIT (fresh baseline + re-enumeration).
      if (isExpiredCursorError(err, [410, 400])) return { entities: [], cursor: null, hasMore: true };
      throw err;
    }
    const entities: UnifiedEntity[] = [];
    const deletedSourceIds: string[] = [];
    for (const ch of data.changes ?? []) {
      if (ch.removed || ch.file?.trashed) {
        if (ch.fileId) deletedSourceIds.push(ch.fileId);
      } else if (ch.file) {
        entities.push(mapFile(ctx, ch.file));
      }
    }
    const next = data.nextPageToken;
    const cursor: DriveCursor = { phase: 'changes', pageToken: next ?? data.newStartPageToken ?? c.pageToken };
    return { entities, deletedSourceIds, cursor: toJsonCursor(cursor), hasMore: Boolean(next) };
  }

  // ── INIT phase (cursor null or phase 'init') ──
  const startToken = c?.startToken ?? (await startPageToken(ctx));
  const resp = await ctx.http.getJson<DriveFilesResp>(`${DRIVE}/files`, {
    query: {
      q: 'trashed=false',
      pageSize: 1000,
      orderBy: 'modifiedTime desc',
      fields: FILES_LIST_FIELDS,
      pageToken: c?.filesPage,
      ...DRIVE_QUERY,
    },
  });
  const entities = (resp.data.files ?? []).map((f) => mapFile(ctx, f));
  const next = resp.data.nextPageToken;
  if (next) {
    const cursor: DriveCursor = { phase: 'init', filesPage: next, startToken };
    return { entities, cursor: toJsonCursor(cursor), hasMore: true };
  }
  // Enumeration complete → switch to the delta feed from the captured baseline.
  const cursor: DriveCursor = { phase: 'changes', pageToken: startToken };
  return { entities, cursor: toJsonCursor(cursor), hasMore: false };
}

/** Drive service resource(s) — also surfaces Docs/Sheets/Slides files. Mounted on google-workspace. */
export const googleDriveResources: AdapterResource[] = [
  { id: 'drive', label: 'Drive', kind: 'file', pull: pullFiles },
];
