/**
 * Background download manager for package artifacts. Streams to a temp file so
 * artifacts never sit fully in memory, reports byte progress, caches completed
 * downloads, and supports pause/resume via HTTP Range requests and cancel via
 * AbortController.
 *
 * This is a complete HTTP(S) downloader. Web apps carry no artifact (nothing to
 * download); for packaged app types it fetches the artifact URL the Store
 * returns. Until a real package registry serves signed artifacts, those URLs
 * will not resolve — the manager surfaces that as a clear network failure
 * rather than pretending success.
 */
import { promises as fs, createWriteStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { Readable } from 'node:stream';
import { app } from 'electron';
import { createLogger } from '../logger';
import { sha256File, hashesEqual } from './integrity';

const log = createLogger('download');

export interface DownloadProgress {
  bytesDownloaded: number;
  bytesTotal: number | null;
}

interface Task {
  id: string;
  url: string;
  partPath: string;
  finalPath: string;
  controller: AbortController;
  paused: boolean;
  bytesDownloaded: number;
  bytesTotal: number | null;
}

export interface DownloadResult {
  path: string;
  sha256: string;
  bytes: number;
  fromCache: boolean;
}

function cacheDir(): string {
  return join(app.getPath('userData'), 'cache', 'packages');
}

async function fileSize(path: string): Promise<number> {
  try {
    return (await fs.stat(path)).size;
  } catch {
    return 0;
  }
}

class DownloadManager {
  private tasks = new Map<string, Task>();

  /** Cancels an in-flight download (keeps nothing; deletes the partial file). */
  async cancel(id: string): Promise<void> {
    const t = this.tasks.get(id);
    if (!t) return;
    t.controller.abort();
    this.tasks.delete(id);
    await fs.rm(t.partPath, { force: true });
  }

  /** Pauses an in-flight download; the partial bytes are preserved for resume. */
  pause(id: string): void {
    const t = this.tasks.get(id);
    if (t) {
      t.paused = true;
      t.controller.abort();
    }
  }

  isActive(id: string): boolean {
    return this.tasks.has(id);
  }

  /**
   * Downloads `url` to the cache, verifying `expectedSha256` when provided.
   * Resumes automatically from any existing partial file for this id.
   */
  async download(opts: {
    id: string;
    url: string;
    fileName: string;
    expectedSha256?: string | null;
    onProgress?: (p: DownloadProgress) => void;
  }): Promise<DownloadResult> {
    const dir = cacheDir();
    await fs.mkdir(dir, { recursive: true });
    const finalPath = join(dir, opts.fileName);
    const partPath = `${finalPath}.part`;

    // Cache hit: a previously completed, hash-matching artifact.
    if (opts.expectedSha256) {
      try {
        await fs.access(finalPath);
        const have = await sha256File(finalPath);
        if (hashesEqual(have, opts.expectedSha256)) {
          const bytes = await fileSize(finalPath);
          opts.onProgress?.({ bytesDownloaded: bytes, bytesTotal: bytes });
          return { path: finalPath, sha256: have, bytes, fromCache: true };
        }
      } catch {
        /* not cached; fall through to download */
      }
    }

    const startAt = await fileSize(partPath);
    const controller = new AbortController();
    const task: Task = {
      id: opts.id,
      url: opts.url,
      partPath,
      finalPath,
      controller,
      paused: false,
      bytesDownloaded: startAt,
      bytesTotal: null,
    };
    this.tasks.set(opts.id, task);

    try {
      const headers: Record<string, string> = {};
      if (startAt > 0) headers.Range = `bytes=${startAt}-`;

      const res = await fetch(opts.url, { headers, signal: controller.signal });
      if (!res.ok && res.status !== 206) {
        throw new Error(`Download failed: HTTP ${res.status}`);
      }
      const lenHeader = res.headers.get('content-length');
      const len = lenHeader ? Number(lenHeader) : null;
      task.bytesTotal = len != null ? len + startAt : null;

      await dirOf(partPath);
      const out = createWriteStream(partPath, { flags: startAt > 0 && res.status === 206 ? 'a' : 'w' });
      if (!res.body) throw new Error('Empty response body');

      const nodeStream = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
      await new Promise<void>((resolve, reject) => {
        nodeStream.on('data', (chunk: Buffer) => {
          task.bytesDownloaded += chunk.length;
          opts.onProgress?.({ bytesDownloaded: task.bytesDownloaded, bytesTotal: task.bytesTotal });
        });
        nodeStream.on('error', reject);
        out.on('error', reject);
        out.on('finish', resolve);
        nodeStream.pipe(out);
      });

      const sha = await sha256File(partPath);
      if (opts.expectedSha256 && !hashesEqual(sha, opts.expectedSha256)) {
        await fs.rm(partPath, { force: true });
        throw new Error('Integrity check failed: artifact hash mismatch');
      }
      await fs.rename(partPath, finalPath);
      const bytes = await fileSize(finalPath);
      this.tasks.delete(opts.id);
      return { path: finalPath, sha256: sha, bytes, fromCache: false };
    } catch (err) {
      this.tasks.delete(opts.id);
      if (task.paused) {
        const e = new Error('paused') as Error & { paused?: boolean };
        e.paused = true;
        throw e;
      }
      log.warn('Download error', { url: opts.url, message: (err as Error).message });
      throw err;
    }
  }

  /** Total bytes currently cached on disk. */
  async cacheSize(): Promise<number> {
    try {
      const dir = cacheDir();
      const files = await fs.readdir(dir);
      let total = 0;
      for (const f of files) total += await fileSize(join(dir, f));
      return total;
    } catch {
      return 0;
    }
  }

  async clearCache(): Promise<void> {
    await fs.rm(cacheDir(), { recursive: true, force: true });
  }
}

async function dirOf(path: string): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
}

export const downloadManager = new DownloadManager();
