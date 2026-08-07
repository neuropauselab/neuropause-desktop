/**
 * Store envelope (Phase 8 · RC hardening 8.3) — versioned, quarantine-not-reset
 * reads for the JSON stores under the data directory.
 *
 * Before Phase 8 every store followed the same load pattern:
 * `catch { data = empty() }` — which cannot tell a FIRST RUN (no file) from a
 * CORRUPT or FUTURE-VERSIONED file. The failure mode was silent data loss: a
 * shape change between releases, a truncated write, or a downgrade would
 * quietly discard whatever the store held.
 *
 * The envelope closes that class of bug with three rules:
 *
 *  1. ENOENT is the ONLY "empty store" signal — a missing file is a first run.
 *  2. An unreadable/corrupt file is QUARANTINED — renamed beside itself as
 *     `<name>.quarantined-<timestamp>` (contents preserved byte-for-byte for
 *     support/recovery) — and the store starts empty. Never silently reset.
 *  3. A file stamped with a NEWER schemaVersion than this build supports is
 *     also quarantined (a downgrade must not half-read future data), and the
 *     newer file remains intact for the newer build to reclaim.
 *
 * Writers stamp `schemaVersion` at the top level; readers tolerate its absence
 * (legacy files = version 1), so adoption is additive and needs no migration
 * of existing installs — stores restamp themselves on their next persist.
 */
import { promises as fs } from 'node:fs';

/** The store schema version THIS build writes and the max it can read. */
export const STORE_SCHEMA_VERSION = 1;

export type StoreReadState = 'loaded' | 'first-run' | 'quarantined-corrupt' | 'quarantined-newer';

export interface StoreReadResult<T> {
  /** Parsed payload when state is 'loaded'; null otherwise. */
  data: T | null;
  state: StoreReadState;
  /** Absolute path the offending file was preserved at, when quarantined. */
  quarantinedTo: string | null;
}

/** Preserve an unreadable/foreign file beside itself; never destroys bytes. */
export async function quarantineFile(filePath: string, now: () => number = Date.now): Promise<string | null> {
  const dest = `${filePath}.quarantined-${new Date(now()).toISOString().replace(/[:.]/g, '-')}`;
  try {
    await fs.rename(filePath, dest);
    return dest;
  } catch {
    return null; // rename failed (e.g. locked) — caller proceeds without destroying anything
  }
}

/**
 * Read one JSON store under the envelope rules. `supported` defaults to this
 * build's STORE_SCHEMA_VERSION; files without a stamp are treated as v1.
 */
export async function readStoreFile<T>(
  filePath: string,
  opts: { supported?: number; now?: () => number } = {},
): Promise<StoreReadResult<T>> {
  const supported = opts.supported ?? STORE_SCHEMA_VERSION;
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { data: null, state: 'first-run', quarantinedTo: null };
    }
    // Unreadable for another reason (permissions, I/O): preserve and start empty.
    return { data: null, state: 'quarantined-corrupt', quarantinedTo: await quarantineFile(filePath, opts.now) };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { data: null, state: 'quarantined-corrupt', quarantinedTo: await quarantineFile(filePath, opts.now) };
  }
  const version =
    parsed && typeof parsed === 'object' && typeof (parsed as { schemaVersion?: unknown }).schemaVersion === 'number'
      ? (parsed as { schemaVersion: number }).schemaVersion
      : 1;
  if (version > supported) {
    return { data: null, state: 'quarantined-newer', quarantinedTo: await quarantineFile(filePath, opts.now) };
  }
  return { data: parsed as T, state: 'loaded', quarantinedTo: null };
}

/** Stamp a payload with this build's schema version (writers spread this in). */
export function envelopeStamp(): { schemaVersion: number } {
  return { schemaVersion: STORE_SCHEMA_VERSION };
}

/** List quarantined store files in a directory (surfaced by diagnostics). */
export async function listQuarantinedFiles(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir)).filter((name) => name.includes('.quarantined-')).sort();
  } catch {
    return [];
  }
}
