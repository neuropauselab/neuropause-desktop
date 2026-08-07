/**
 * Backup manager — the snapshot/restore/validate core. Injected data + backup
 * directories keep it Electron-free and unit-testable; the electron wiring
 * (real userData paths, scheduled timer, IPC) lives in ./index.
 *
 * A backup is a directory under <backupsDir>/<id>/ holding a copy of each
 * protected domain's files plus a manifest.json carrying a sha256 per file.
 * Integrity validation recomputes those hashes; restore copies the files back
 * after first snapshotting the current state as a safety backup.
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

export interface BackupManagerDeps {
  dataDir: string;
  backupsDir: string;
  appVersion: string;
  dataVersion: () => number;
  now?: () => number;
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

export class BackupManager {
  private readonly now: () => number;

  constructor(private readonly deps: BackupManagerDeps) {
    this.now = deps.now ?? (() => Date.now());
  }

  async create(
    trigger: BackupInfo['trigger'] = 'manual',
    domains: MaintenanceDomain[] = LOCAL_DOMAINS,
  ): Promise<BackupInfo> {
    const ts = new Date(this.now());
    const id = `${ts.toISOString().replace(/[:.]/g, '-')}-${trigger}`;
    const dest = join(this.deps.backupsDir, id);
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

    const manifest: BackupManifest = {
      id,
      createdAt: ts.toISOString(),
      appVersion: this.deps.appVersion,
      dataVersion: this.deps.dataVersion(),
      trigger,
      entries,
    };
    await fs.mkdir(dest, { recursive: true });
    await fs.writeFile(join(dest, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
    return this.toInfo(manifest, null);
  }

  async list(): Promise<BackupInfo[]> {
    if (!(await exists(this.deps.backupsDir))) return [];
    const out: BackupInfo[] = [];
    for (const name of await fs.readdir(this.deps.backupsDir)) {
      const manifest = await this.readManifest(name);
      if (manifest) out.push(this.toInfo(manifest, null));
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async validate(id: string): Promise<BackupValidation> {
    const manifest = await this.readManifest(id);
    if (!manifest) return { id, valid: false, checked: 0, mismatched: [], missing: ['manifest.json'] };
    const mismatched: string[] = [];
    const missing: string[] = [];
    for (const entry of manifest.entries) {
      const path = join(this.deps.backupsDir, id, 'data', entry.relativePath);
      if (!(await exists(path))) {
        missing.push(entry.relativePath);
      } else if ((await sha256(path)) !== entry.sha256) {
        mismatched.push(entry.relativePath);
      }
    }
    return { id, valid: mismatched.length === 0 && missing.length === 0, checked: manifest.entries.length, mismatched, missing };
  }

  async restore(id: string, domains?: MaintenanceDomain[]): Promise<RestoreResult> {
    const manifest = await this.readManifest(id);
    if (!manifest) {
      return { id, ok: false, restored: [], skipped: [], safetyBackupId: null, detail: 'backup not found' };
    }
    const validation = await this.validate(id);
    if (!validation.valid) {
      return { id, ok: false, restored: [], skipped: [], safetyBackupId: null, detail: 'integrity check failed; restore aborted' };
    }

    // Snapshot current state before overwriting anything.
    const safety = await this.create('manual', domains ?? LOCAL_DOMAINS);
    const wanted = new Set<MaintenanceDomain>(domains ?? ALL_DOMAINS);
    const restored = new Set<MaintenanceDomain>();
    const skipped = new Set<MaintenanceDomain>();

    for (const entry of manifest.entries) {
      if (!wanted.has(entry.domain)) {
        skipped.add(entry.domain);
        continue;
      }
      const src = join(this.deps.backupsDir, id, 'data', entry.relativePath);
      const dest = join(this.deps.dataDir, entry.relativePath);
      await fs.mkdir(dirname(dest), { recursive: true });
      await fs.copyFile(src, dest);
      restored.add(entry.domain);
    }

    return {
      id,
      ok: true,
      restored: [...restored],
      skipped: [...skipped],
      safetyBackupId: safety.id,
      detail: null,
    };
  }

  async delete(id: string): Promise<boolean> {
    const dir = join(this.deps.backupsDir, id);
    if (!(await exists(dir))) return false;
    await fs.rm(dir, { recursive: true, force: true });
    return true;
  }

  private async readManifest(id: string): Promise<BackupManifest | null> {
    try {
      const raw = await fs.readFile(join(this.deps.backupsDir, id, 'manifest.json'), 'utf8');
      return JSON.parse(raw) as BackupManifest;
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
