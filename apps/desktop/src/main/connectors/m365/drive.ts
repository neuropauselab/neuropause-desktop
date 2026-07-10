/**
 * P2.4 — OneDrive write actions (live Microsoft Graph, no mocks).
 *
 * upload (auto-resumable for large files) / download / rename / move / delete / create folder /
 * share (create link) / restore a previous version. Uploads over 5 MiB use a resumable upload session.
 */
import {
  GRAPH,
  enc,
  optStr,
  quotaFrom,
  str,
  type WriteAction,
  type WriteActionContext,
  type WriteActionResult,
  type WriteParams,
} from './actionSdk';

/** The body type `fetch` accepts for resumable chunk PUTs (derived to avoid the DOM `BodyInit` lib type). */
type FetchBody = NonNullable<Parameters<typeof fetch>[1]>['body'];

const RW = 'Files.ReadWrite.All';
const READ = 'Files.Read';
/** Resumable chunk size — must be a multiple of 320 KiB per Graph's upload-session rules. */
const CHUNK = 5 * 1024 * 1024;

interface GraphDriveItemRef {
  id?: string;
  name?: string;
  webUrl?: string;
  size?: number;
}
interface GraphUploadSession {
  uploadUrl?: string;
}
interface GraphLinkRef {
  link?: { webUrl?: string };
}

function b64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}
function encodePath(path: string): string {
  return path
    .split('/')
    .filter((s) => s.length > 0)
    .map(enc)
    .join('/');
}

async function upload(ctx: WriteActionContext, p: WriteParams): Promise<WriteActionResult> {
  const path = str(p, 'path');
  const bytes = b64ToBytes(str(p, 'contentBytes'));
  const contentType = optStr(p, 'contentType') ?? 'application/octet-stream';

  if (bytes.byteLength <= CHUNK) {
    const res = await ctx.http.sendBinary<GraphDriveItemRef>(
      'PUT',
      `${GRAPH}/me/drive/root:/${encodePath(path)}:/content`,
      bytes,
      contentType,
    );
    return {
      ok: true,
      summary: `Uploaded ${path} (${bytes.byteLength} bytes)`,
      data: { id: res.data.id ?? null, webUrl: res.data.webUrl ?? null, size: res.data.size ?? bytes.byteLength },
      quotaRemaining: quotaFrom(res.headers),
    };
  }

  // Resumable upload session for large files.
  const session = await ctx.http.postJson<GraphUploadSession>(
    `${GRAPH}/me/drive/root:/${encodePath(path)}:/createUploadSession`,
    { item: { '@microsoft.graph.conflictBehavior': 'replace' } },
  );
  const uploadUrl = session.data.uploadUrl;
  if (!uploadUrl) throw new Error('Graph did not return an upload session URL');
  let uploaded = 0;
  let last: GraphDriveItemRef = {};
  while (uploaded < bytes.byteLength) {
    const end = Math.min(uploaded + CHUNK, bytes.byteLength);
    const chunk = bytes.subarray(uploaded, end);
    const r = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Range': `bytes ${uploaded}-${end - 1}/${bytes.byteLength}` },
      body: chunk as unknown as FetchBody,
    });
    if (r.status >= 400) throw new Error(`Resumable upload failed (HTTP ${r.status})`);
    if (r.status === 200 || r.status === 201) last = (await r.json()) as GraphDriveItemRef;
    uploaded = end;
  }
  return {
    ok: true,
    summary: `Uploaded ${path} (${bytes.byteLength} bytes, resumable)`,
    data: { id: last.id ?? null, size: bytes.byteLength },
    quotaRemaining: null,
  };
}

async function download(ctx: WriteActionContext, p: WriteParams): Promise<WriteActionResult> {
  const id = str(p, 'itemId');
  const res = await ctx.http.getBinary(`${GRAPH}/me/drive/items/${enc(id)}/content`);
  return {
    ok: true,
    summary: `Downloaded file (${res.bytes.byteLength} bytes)`,
    data: { contentBytes: Buffer.from(res.bytes).toString('base64'), size: res.bytes.byteLength },
    quotaRemaining: quotaFrom(res.headers),
  };
}

async function rename(ctx: WriteActionContext, p: WriteParams): Promise<WriteActionResult> {
  const id = str(p, 'itemId');
  const name = str(p, 'name');
  const res = await ctx.http.patchJson<GraphDriveItemRef>(`${GRAPH}/me/drive/items/${enc(id)}`, { name });
  return { ok: true, summary: `Renamed to “${name}”`, data: { id: res.data.id ?? id }, quotaRemaining: quotaFrom(res.headers) };
}

async function move(ctx: WriteActionContext, p: WriteParams): Promise<WriteActionResult> {
  const id = str(p, 'itemId');
  const parentId = str(p, 'parentId');
  const res = await ctx.http.patchJson<GraphDriveItemRef>(`${GRAPH}/me/drive/items/${enc(id)}`, {
    parentReference: { id: parentId },
  });
  return { ok: true, summary: 'Moved file', data: { id: res.data.id ?? id }, quotaRemaining: quotaFrom(res.headers) };
}

async function remove(ctx: WriteActionContext, p: WriteParams): Promise<WriteActionResult> {
  const id = str(p, 'itemId');
  const res = await ctx.http.deleteJson(`${GRAPH}/me/drive/items/${enc(id)}`);
  return { ok: true, summary: 'Deleted file (moved to recycle bin)', data: { itemId: id }, quotaRemaining: quotaFrom(res.headers) };
}

async function createFolder(ctx: WriteActionContext, p: WriteParams): Promise<WriteActionResult> {
  const parentId = optStr(p, 'parentId') ?? 'root';
  const name = str(p, 'name');
  const res = await ctx.http.postJson<GraphDriveItemRef>(`${GRAPH}/me/drive/items/${enc(parentId)}/children`, {
    name,
    folder: {},
    '@microsoft.graph.conflictBehavior': 'rename',
  });
  return { ok: true, summary: `Created folder “${name}”`, data: { id: res.data.id ?? null }, quotaRemaining: quotaFrom(res.headers) };
}

async function createLink(ctx: WriteActionContext, p: WriteParams): Promise<WriteActionResult> {
  const id = str(p, 'itemId');
  const type = optStr(p, 'linkType') === 'edit' ? 'edit' : 'view';
  const scope = optStr(p, 'scope') === 'organization' ? 'organization' : 'anonymous';
  const res = await ctx.http.postJson<GraphLinkRef>(`${GRAPH}/me/drive/items/${enc(id)}/createLink`, { type, scope });
  return {
    ok: true,
    summary: `Created ${scope} ${type} link`,
    data: { webUrl: res.data.link?.webUrl ?? null, type, scope },
    quotaRemaining: quotaFrom(res.headers),
  };
}

async function restoreVersion(ctx: WriteActionContext, p: WriteParams): Promise<WriteActionResult> {
  const id = str(p, 'itemId');
  const versionId = str(p, 'versionId');
  const res = await ctx.http.postJson(`${GRAPH}/me/drive/items/${enc(id)}/versions/${enc(versionId)}/restoreVersion`, {});
  return { ok: true, summary: `Restored file to version ${versionId}`, data: { itemId: id, versionId }, quotaRemaining: quotaFrom(res.headers) };
}

export const driveActions: WriteAction[] = [
  { id: 'drive.upload', label: 'Upload file', domain: 'drive', scopes: [RW], mutates: true, run: upload },
  { id: 'drive.download', label: 'Download file', domain: 'drive', scopes: [READ], mutates: false, run: download },
  { id: 'drive.rename', label: 'Rename', domain: 'drive', scopes: [RW], mutates: true, run: rename },
  { id: 'drive.move', label: 'Move', domain: 'drive', scopes: [RW], mutates: true, run: move },
  { id: 'drive.delete', label: 'Delete', domain: 'drive', scopes: [RW], mutates: true, run: remove },
  { id: 'drive.createFolder', label: 'Create folder', domain: 'drive', scopes: [RW], mutates: true, run: createFolder },
  { id: 'drive.share', label: 'Share / create link', domain: 'drive', scopes: [RW], mutates: true, run: createLink },
  { id: 'drive.restoreVersion', label: 'Restore version', domain: 'drive', scopes: [RW], mutates: true, run: restoreVersion },
];
