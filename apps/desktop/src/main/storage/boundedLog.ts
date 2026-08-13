/**
 * Bounded append-only log (Phase 8 · RC hardening 8.4) — the ONE rotation
 * helper behind every file the app appends to forever (app.log, crashes.log,
 * audit.log). Before Phase 8 those were raw `fs.appendFile` calls: a
 * crash-looping or long-lived install grew them without limit, and every
 * support bundle copied the whole weight.
 *
 * Semantics: size-based rotation — when the live file would exceed `maxBytes`
 * it is renamed to `<path>.1` (shifting `.1`→`.2`… up to `keep`, oldest
 * dropped) and a fresh file begins. Appends are fire-and-forget but strictly
 * SERIALIZED through one promise chain, so a rotation never races an append.
 * Electron-free (paths injected), so it unit-tests without the app runtime.
 */
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';

export interface BoundedLogOptions {
  /** Rotate when the live file exceeds this many bytes. Default 5 MiB. */
  maxBytes?: number;
  /** How many rotated generations to keep (`.1`…`.keep`). Default 2. */
  keep?: number;
}

export interface BoundedLog {
  /** Fire-and-forget append of one line (newline added if absent). */
  append(line: string): void;
  /** Await all queued appends (tests + shutdown). */
  flush(): Promise<void>;
}

export function createBoundedLog(pathOf: () => string, opts: BoundedLogOptions = {}): BoundedLog {
  const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
  const keep = Math.max(opts.keep ?? 2, 1);
  let chain: Promise<void> = Promise.resolve();

  async function rotateIfNeeded(path: string, incoming: number): Promise<void> {
    let size = 0;
    try {
      size = (await fs.stat(path)).size;
    } catch {
      return; // no live file yet
    }
    if (size + incoming <= maxBytes) return;
    // Shift generations oldest-first: .keep dropped, .n → .n+1, live → .1
    await fs.rm(`${path}.${keep}`, { force: true }).catch(() => undefined);
    for (let n = keep - 1; n >= 1; n -= 1) {
      await fs.rename(`${path}.${n}`, `${path}.${n + 1}`).catch(() => undefined);
    }
    await fs.rename(path, `${path}.1`).catch(() => undefined);
  }

  return {
    append(line: string): void {
      const text = line.endsWith('\n') ? line : `${line}\n`;
      chain = chain
        .then(async () => {
          const path = pathOf();
          await fs.mkdir(dirname(path), { recursive: true });
          await rotateIfNeeded(path, Buffer.byteLength(text));
          await fs.appendFile(path, text);
        })
        .catch(() => undefined); // logging must never take the app down
    },
    flush(): Promise<void> {
      return chain;
    },
  };
}
