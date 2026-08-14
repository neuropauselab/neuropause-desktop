/**
 * Backup manager — the snapshot/restore/validate core. Injected data + backup
 * directories keep it Electron-free and unit-testable; the electron wiring
 * (real userData paths, scheduled timer, IPC) lives in ./index.
 *
 * A backup is a directory under <backupsDir>/<id>/ holding a copy of each
 * protected domain's files plus a manifest.json carrying a sha256 per file.
 * Integrity validation recomputes those hashes; restore copies the files back
 * after first snapshotting the current state as a safety backup.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * P13C ROUND 10 — F22, NEW-M6, NEW-M7. WHAT CHANGED AND WHAT IT IS WORTH.
 *
 * F22 — THE ARCHIVE IS A DECLARED OBJECT NOW, NOT AN UNDECLARED ONE.
 *   Every archive this manager writes carries an `archive` block in its
 *   manifest naming its scope (MULTI_TENANT_INSTALL), what is inside, who may
 *   restore it and what a restore puts back. `./backupArchive.ts` holds the
 *   declaration and the reasoning. `restore` REFUSES an archive with no valid
 *   block and REFUSES a caller that did not acknowledge the boundary the block
 *   declares. The archive is still NOT partitioned per tenant — that is stated
 *   in the declaration rather than glossed, and the restore is still all-or-
 *   nothing across tenants.
 *
 * NEW-M6 — CONTAINMENT IS ON THE RESOLVED REAL PATH.
 *   `BackupIdSchema` had no charset, so `{id:'../../../../tmp/victim'}` reached
 *   `join()` and then `fs.rm(dir,{recursive:true,force:true})`. Every id-taking
 *   method now resolves through `resolveContained` (charset + `fs.realpath` +
 *   prefix check), and every manifest entry is resolved the same way on both
 *   the read side (inside the archive) and the write side (inside the data
 *   directory) — plus checked against the store-path registry for its own
 *   domain, so a planted manifest cannot name a file backup never covers.
 *
 * NEW-M7 — MANUAL BACKUPS ARE CAPPED.
 *   Only `trigger === 'scheduled'` was pruned, so a loop of manual creates was
 *   an unbounded disk-fill. Pruning lives HERE rather than in the IPC handler
 *   so every caller inherits it. Pre-migration snapshots are never pruned: they
 *   are the rollback anchor for a failed migration.
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  BackupEntry,
  BackupInfo,
  BackupManifest,
  BackupValidation,
  MaintenanceDomain,
  RestoreResult,
} from '@neuropause/shared';
import { DOMAIN_FILES, LOCAL_DOMAINS, isPrefixEntry } from '../storage/storePaths';
import {
  INSTALL_ARCHIVE,
  archiveManifestScope,
  isArchiveManifestScope,
  isCoveredByDomain,
  isSafeArchiveId,
  resolveContained,
  restoreBoundaryRefusal,
  type ArchiveManifestScope,
  type RestoreBoundaryAcknowledgement,
} from './backupArchive';

/**
 * Phase 8 (8.2): the domain → files map lives in the store-path REGISTRY
 * (../storage/storePaths) — one source of truth shared by backup, the
 * pre-migration snapshot, and restore. Re-exported here so existing importers
 * keep working. Prefix entries (trailing `*`, e.g. `enterprise-module-*`)
 * resolve against the live data directory at snapshot time, so every
 * certified module store — present and future — is covered automatically.
 */
export { DOMAIN_FILES, LOCAL_DOMAINS };

const ALL_DOMAINS = Object.keys(DOMAIN_FILES) as MaintenanceDomain[];

/**
 * How many MANUAL archives are kept. P13C ROUND 10 — NEW-M7.
 *
 * Ten, matching the scheduler's existing keep count, so the two triggers behave
 * the same way rather than one being special. `pre-migration` is deliberately
 * exempt: pruning the snapshot a migration would roll back to converts a failed
 * migration into data loss.
 */
export const MANUAL_BACKUP_KEEP = 10;

/** The manifest as written to disk: the shared shape plus the archive scope. */
export interface StoredBackupManifest extends BackupManifest {
  /**
   * F22. Absent on archives produced before Round 10 and on hand-planted
   * directories; `restore` refuses both. Optional in the TYPE because a manifest
   * read off disk may genuinely lack it — that is the case being detected.
   */
  archive?: ArchiveManifestScope;
}

export interface BackupManagerDeps {
  dataDir: string;
  backupsDir: string;
  appVersion: string;
  dataVersion: () => number;
  now?: () => number;
  /**
   * F22 — REQUIRED. The boundary this manager's restores cross, stated at the
   * composition root. A wiring that does not say "my restores put every tenant
   * back at once" does not compile, and one that says something else throws.
   */
  restoreBoundary: RestoreBoundaryAcknowledgement;
  /** Test seam for the manual cap. Production uses MANUAL_BACKUP_KEEP. */
  manualKeep?: number;
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

async function sha256(path: string): Promise<string> {
  const buf = await fs.readFile(path);
  return createHash('sha256').update(buf).digest('hex');
}

/** Resolve a domain's configured paths to the concrete files that exist. */
async function filesForPath(dataDir: string, rel: string): Promise<string[]> {
  // Prefix pattern (Phase 8): `enterprise-module-*` → every top-level entry
  // of the data directory that starts with the prefix, resolved live.
  if (isPrefixEntry(rel)) {
    const prefix = rel.slice(0, -1);
    if (!(await exists(dataDir))) return [];
    const out: string[] = [];
    for (const name of await fs.readdir(dataDir)) {
      if (name.startsWith(prefix)) out.push(...(await filesForPath(dataDir, name)));
    }
    return out;
  }
  const abs = join(dataDir, rel);
  if (!(await exists(abs))) return [];
  const stat = await fs.stat(abs);
  if (stat.isDirectory()) {
    const out: string[] = [];
    for (const name of await fs.readdir(abs)) {
      out.push(...(await filesForPath(dataDir, join(rel, name))));
    }
    return out;
  }
  return [rel];
}

/** One manifest entry, resolved to real paths that are provably contained. */
interface PlannedEntry {
  entry: BackupEntry;
  src: string;
  dest: string;
}

export class BackupManager {
  private readonly now: () => number;

  constructor(private readonly deps: BackupManagerDeps) {
    this.now = deps.now ?? (() => Date.now());
    const refusal = restoreBoundaryRefusal(
      archiveManifestScope(INSTALL_ARCHIVE),
      deps.restoreBoundary,
    );
    if (refusal) {
      throw new Error(
        `BackupManager was constructed without a usable restoration boundary — ${refusal}. ` +
          `Declare it at the composition root: it copies every organization's records back over ` +
          'the live data directory. See backup/backupArchive.ts.',
      );
    }
  }

  async create(
    trigger: BackupInfo['trigger'] = 'manual',
    domains: MaintenanceDomain[] = LOCAL_DOMAINS,
  ): Promise<BackupInfo> {
    return this.createInternal(trigger, domains, null);
  }

  /**
   * `protectId` is the archive a restore is reading FROM. The safety snapshot a
   * restore takes first goes through the manual cap like any other manual
   * backup, and without this the prune could delete the archive mid-restore.
   */
  private async createInternal(
    trigger: BackupInfo['trigger'],
    domains: MaintenanceDomain[],
    protectId: string | null,
  ): Promise<BackupInfo> {
    const ts = new Date(this.now());
    const id = `${ts.toISOString().replace(/[:.]/g, '-')}-${trigger}`;
    // The id is generated here, so this cannot fail — it is asserted because the
    // write path is the one that must never take an unchecked path, whatever
    // future change alters how ids are made.
    const dest = await resolveContained(this.deps.backupsDir, id);
    if (!dest) throw new Error(`Refusing to write a backup outside the backups directory: ${id}`);
    const entries: BackupEntry[] = [];

    for (const domain of domains) {
      for (const rel of DOMAIN_FILES[domain]) {
        for (const file of await filesForPath(this.deps.dataDir, rel)) {
          const src = join(this.deps.dataDir, file);
          const out = join(dest, 'data', file);
          await fs.mkdir(dirname(out), { recursive: true });
          await fs.copyFile(src, out);
          const stat = await fs.stat(src);
          entries.push({ domain, relativePath: file, sizeBytes: stat.size, sha256: await sha256(src) });
        }
      }
    }

    const manifest: StoredBackupManifest = {
      id,
      createdAt: ts.toISOString(),
      appVersion: this.deps.appVersion,
      dataVersion: this.deps.dataVersion(),
      trigger,
      entries,
      // F22 — the archive states its own scope, on the archive.
      archive: archiveManifestScope(INSTALL_ARCHIVE),
    };
    await fs.mkdir(dest, { recursive: true });
    await fs.writeFile(join(dest, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
    if (trigger === 'manual') await this.pruneManual(protectId, id);
    return this.toInfo(manifest, null);
  }

  /** NEW-M7 — keep the newest N manual archives; never touch the other triggers. */
  private async pruneManual(protectId: string | null, justCreated: string): Promise<void> {
    const keep = this.deps.manualKeep ?? MANUAL_BACKUP_KEEP;
    const manual = (await this.list()).filter((b) => b.trigger === 'manual');
    for (const old of manual.slice(Math.max(keep, 0))) {
      if (old.id === protectId || old.id === justCreated) continue;
      await this.delete(old.id);
    }
  }

  async list(): Promise<BackupInfo[]> {
    if (!(await exists(this.deps.backupsDir))) return [];
    const out: BackupInfo[] = [];
    for (const name of await fs.readdir(this.deps.backupsDir)) {
      // A directory whose name is not a legal archive id is not listed: it can
      // never be validated, restored or deleted through this class, so offering
      // it would be offering an id every other method refuses.
      if (!isSafeArchiveId(name)) continue;
      const manifest = await this.readManifest(name);
      if (manifest) out.push(this.toInfo(manifest, null));
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async validate(id: string): Promise<BackupValidation> {
    const manifest = await this.readManifest(id);
    if (!manifest) return { id, valid: false, checked: 0, mismatched: [], missing: ['manifest.json'] };
    const dataRoot = await resolveContained(this.deps.backupsDir, id, 'data');
    if (!dataRoot) return { id, valid: false, checked: 0, mismatched: [], missing: ['manifest.json'] };
    const mismatched: string[] = [];
    const missing: string[] = [];
    for (const entry of manifest.entries) {
      // An entry whose path escapes the archive cannot be verified, so it counts
      // as missing — which makes the archive invalid, which aborts any restore.
      const path = await resolveContained(dataRoot, entry.relativePath);
      if (!path || !(await exists(path))) {
        missing.push(entry.relativePath);
      } else if ((await sha256(path)) !== entry.sha256) {
        mismatched.push(entry.relativePath);
      }
    }
    return { id, valid: mismatched.length === 0 && missing.length === 0, checked: manifest.entries.length, mismatched, missing };
  }

  /**
   * Put an archive back over the live data directory.
   *
   * REFUSES, in order, before anything is written: an id that is not contained;
   * a missing manifest; an archive with no scope declaration (F22 — fails closed
   * rather than defaulting to install-wide); an unacknowledged or mismatched
   * restoration boundary; a failed integrity check; and any manifest entry whose
   * path escapes the archive, escapes the data directory, or names a file the
   * store-path registry does not cover for that entry's own domain.
   *
   * The pre-flight is complete before the first byte moves, so a refusal never
   * leaves the data directory half-restored.
   */
  async restore(
    id: string,
    domains?: MaintenanceDomain[],
    ack: RestoreBoundaryAcknowledgement = this.deps.restoreBoundary,
  ): Promise<RestoreResult> {
    const refuse = (detail: string): RestoreResult => ({
      id,
      ok: false,
      restored: [],
      skipped: [],
      requiresRestart: false, // nothing was written; nothing to pick up

      safetyBackupId: null,
      detail,
    });

    const archiveRoot = await resolveContained(this.deps.backupsDir, id);
    if (!archiveRoot) return refuse('refused: backup id escapes the backups directory');
    const manifest = await this.readManifest(id);
    if (!manifest) return refuse('backup not found');
    if (!isArchiveManifestScope(manifest.archive)) {
      return refuse(
        'refused: this archive carries no scope declaration, so what a restore would put back is ' +
          'undeclared. See backup/backupArchive.ts.',
      );
    }
    const boundaryRefusal = restoreBoundaryRefusal(manifest.archive, ack);
    if (boundaryRefusal) return refuse(boundaryRefusal);

    const validation = await this.validate(id);
    if (!validation.valid) return refuse('integrity check failed; restore aborted');

    const wanted = new Set<MaintenanceDomain>(domains ?? ALL_DOMAINS);
    const skipped = new Set<MaintenanceDomain>();
    const planned: PlannedEntry[] = [];
    for (const entry of manifest.entries) {
      if (!wanted.has(entry.domain)) {
        skipped.add(entry.domain);
        continue;
      }
      if (!isCoveredByDomain(entry.domain, entry.relativePath)) {
        return refuse(
          `refused: manifest entry "${entry.relativePath}" is not a path backup covers for ` +
            `domain "${entry.domain}"`,
        );
      }
      const src = await resolveContained(archiveRoot, 'data', entry.relativePath);
      if (!src) {
        return refuse(`refused: manifest entry "${entry.relativePath}" escapes the archive`);
      }
      const dest = await resolveContained(this.deps.dataDir, entry.relativePath);
      if (!dest) {
        return refuse(
          `refused: manifest entry "${entry.relativePath}" escapes the data directory`,
        );
      }
      planned.push({ entry, src, dest });
    }

    // Snapshot current state before overwriting anything. Only now — a refusal
    // above must not leave a spurious archive behind.
    const safety = await this.createInternal('manual', domains ?? LOCAL_DOMAINS, id);
    const restored = new Set<MaintenanceDomain>();
    for (const { entry, src, dest } of planned) {
      await fs.mkdir(dirname(dest), { recursive: true });
      /**
       * P13C ROUND 37 — GATE 16. Atomic per file: `copyFile` wrote the
       * destination IN PLACE, so a crash or ENOSPC mid-restore left a
       * truncated store file — which the quarantine machinery then treats as
       * corrupt. tmp + rename means every restored file is either the old
       * bytes or the complete new bytes, never a torn middle.
       */
      const tmp = `${dest}.restore-tmp`;
      await fs.copyFile(src, tmp);
      await fs.rename(tmp, dest);
      restored.add(entry.domain);
    }

    return {
      id,
      ok: true,
      restored: [...restored],
      skipped: [...skipped],
      safetyBackupId: safety.id,
      detail: null,
      /**
       * Round 37 — Gate 16: the restored files sit UNDER stores that already
       * hold pre-restore state in memory; their next coalesced persist would
       * overwrite the restore. The tenant-scoped path always modeled this
       * (`tenantArchive.requiresRestart`); the install-wide path now does too,
       * and the IPC layer enforces the relaunch.
       */
      requiresRestart: true,
    };
  }

  async delete(id: string): Promise<boolean> {
    // NEW-M6: this is the `fs.rm(recursive, force)` the traversal reached.
    const dir = await resolveContained(this.deps.backupsDir, id);
    if (!dir) return false;
    if (!(await exists(dir))) return false;
    await fs.rm(dir, { recursive: true, force: true });
    return true;
  }

  private async readManifest(id: string): Promise<StoredBackupManifest | null> {
    const dir = await resolveContained(this.deps.backupsDir, id);
    if (!dir) return null;
    try {
      const raw = await fs.readFile(join(dir, 'manifest.json'), 'utf8');
      return JSON.parse(raw) as StoredBackupManifest;
    } catch {
      return null;
    }
  }

  private toInfo(manifest: BackupManifest, valid: boolean | null): BackupInfo {
    const domains = [...new Set(manifest.entries.map((e) => e.domain))];
    const sizeBytes = manifest.entries.reduce((sum, e) => sum + e.sizeBytes, 0);
    return {
      id: manifest.id,
      createdAt: manifest.createdAt,
      appVersion: manifest.appVersion,
      trigger: manifest.trigger,
      domains,
      sizeBytes,
      valid,
    };
  }
}
