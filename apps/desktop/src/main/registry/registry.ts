/**
 * The Local Application Registry — the on-disk source of truth for everything
 * installed through NeuroPause. It records install metadata, integrity hashes,
 * granted permissions, runtime/health status, usage analytics, and user flags
 * (pinned/favorite). The Package Service writes it; the Runtime reads it; the
 * UI renders it.
 *
 * Durability: writes are atomic (temp file + rename). Integrity: the file
 * carries a SHA-256 over its canonical contents, verified on load. The whole
 * file is versioned so its schema can migrate forward safely.
 */
import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { app } from 'electron';
import type {
  AppType,
  HealthStatus,
  PermissionGrant,
  RegistryEntryDto,
  RegistryStats,
  RuntimePermissionKey,
  RuntimeStatus,
} from '@neuropause/shared';
import { createLogger } from '../logger';

const log = createLogger('registry');
const SCHEMA_VERSION = 1;

export interface RegistryEntry {
  slug: string;
  name: string;
  appType: AppType;
  installedVersion: string | null;
  channel: string;
  installLocation: string | null;
  packageHash: string | null;
  signatureKeyId: string | null;
  hasSignature: boolean;
  /** Retained across an update so a rollback has a target. */
  previousVersion: string | null;
  previousPackageHash: string | null;
  grantedPermissions: RuntimePermissionKey[];
  permissionGrants: PermissionGrant[];
  launchCount: number;
  lastLaunchedAt: string | null;
  installedAt: string;
  lastUpdatedAt: string | null;
  runtimeStatus: RuntimeStatus;
  healthStatus: HealthStatus;
  diskUsageBytes: number | null;
  pinned: boolean;
  favorite: boolean;
  config: Record<string, unknown>;
  usage: { launches: number; totalActiveMs: number; lastSessionAt: string | null };
}

interface RegistryFile {
  schemaVersion: number;
  checksum: string;
  meta: { createdAt: string; updatedAt: string };
  entries: Record<string, RegistryEntry>;
}

function registryPath(): string {
  return join(app.getPath('userData'), 'registry.json');
}

/** Stable stringification so the checksum is order-independent. */
function canonical(entries: Record<string, RegistryEntry>): string {
  const sorted = Object.keys(entries)
    .sort()
    .reduce<Record<string, RegistryEntry>>((acc, k) => {
      acc[k] = entries[k];
      return acc;
    }, {});
  return JSON.stringify(sorted);
}

function checksumOf(entries: Record<string, RegistryEntry>): string {
  return createHash('sha256').update(canonical(entries)).digest('hex');
}

function emptyFile(): RegistryFile {
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    checksum: checksumOf({}),
    meta: { createdAt: now, updatedAt: now },
    entries: {},
  };
}

/** Forward migration hook. Each step upgrades the file in place. */
function migrate(file: RegistryFile): RegistryFile {
  const f = file;
  // if (f.schemaVersion < 2) { ...transform...; f.schemaVersion = 2; }
  f.schemaVersion = SCHEMA_VERSION;
  return f;
}

class Registry {
  private file: RegistryFile = emptyFile();
  private loaded = false;
  private integrityOk = true;

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(registryPath(), 'utf8');
      const parsed = JSON.parse(raw) as RegistryFile;
      const expected = checksumOf(parsed.entries ?? {});
      this.integrityOk = expected === parsed.checksum;
      if (!this.integrityOk) {
        log.warn('Registry checksum mismatch; file may have been edited out of band');
      }
      this.file = migrate({
        schemaVersion: parsed.schemaVersion ?? 1,
        checksum: parsed.checksum,
        meta: parsed.meta ?? { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        entries: parsed.entries ?? {},
      });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.file = emptyFile();
        await this.persist();
      } else {
        log.error('Failed to read registry; starting empty', err);
        this.file = emptyFile();
      }
    }
    this.loaded = true;
    log.info('Registry loaded', { entries: Object.keys(this.file.entries).length, integrityOk: this.integrityOk });
  }

  private ensureLoaded(): void {
    if (!this.loaded) throw new Error('Registry used before load()');
  }

  private async persist(): Promise<void> {
    this.file.checksum = checksumOf(this.file.entries);
    this.file.meta.updatedAt = new Date().toISOString();
    const path = registryPath();
    await fs.mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.file, null, 2), { mode: 0o600 });
    await fs.rename(tmp, path);
  }

  /* ── reads ── */

  has(slug: string): boolean {
    return !!this.file.entries[slug];
  }
  getRaw(slug: string): RegistryEntry | null {
    return this.file.entries[slug] ?? null;
  }
  get(slug: string): RegistryEntryDto | null {
    const e = this.file.entries[slug];
    return e ? toDto(e) : null;
  }
  list(): RegistryEntryDto[] {
    return Object.values(this.file.entries).map(toDto);
  }
  isIntegrityOk(): boolean {
    return this.integrityOk;
  }

  stats(): RegistryStats {
    const entries = Object.values(this.file.entries);
    const byType: Record<string, number> = {};
    let totalDisk = 0;
    let totalLaunches = 0;
    let pinned = 0;
    let favorite = 0;
    for (const e of entries) {
      byType[e.appType] = (byType[e.appType] ?? 0) + 1;
      totalDisk += e.diskUsageBytes ?? 0;
      totalLaunches += e.launchCount;
      if (e.pinned) pinned += 1;
      if (e.favorite) favorite += 1;
    }
    return {
      totalInstalled: entries.length,
      totalLaunches,
      totalDiskBytes: totalDisk,
      pinnedCount: pinned,
      favoriteCount: favorite,
      byType,
    };
  }

  /* ── writes ── */

  async upsert(entry: RegistryEntry): Promise<RegistryEntryDto> {
    this.ensureLoaded();
    this.file.entries[entry.slug] = entry;
    await this.persist();
    return toDto(entry);
  }

  async patch(slug: string, fn: (e: RegistryEntry) => void): Promise<RegistryEntryDto | null> {
    this.ensureLoaded();
    const e = this.file.entries[slug];
    if (!e) return null;
    fn(e);
    await this.persist();
    return toDto(e);
  }

  async remove(slug: string): Promise<boolean> {
    this.ensureLoaded();
    if (!this.file.entries[slug]) return false;
    delete this.file.entries[slug];
    await this.persist();
    return true;
  }

  async setFlags(slug: string, flags: { pinned?: boolean; favorite?: boolean }): Promise<RegistryEntryDto | null> {
    return this.patch(slug, (e) => {
      if (flags.pinned !== undefined) e.pinned = flags.pinned;
      if (flags.favorite !== undefined) e.favorite = flags.favorite;
    });
  }

  async setRuntimeStatus(slug: string, status: RuntimeStatus): Promise<void> {
    await this.patch(slug, (e) => {
      e.runtimeStatus = status;
    });
  }
  async setHealth(slug: string, health: HealthStatus): Promise<void> {
    await this.patch(slug, (e) => {
      e.healthStatus = health;
    });
  }

  async recordLaunch(slug: string): Promise<void> {
    const now = new Date().toISOString();
    await this.patch(slug, (e) => {
      e.launchCount += 1;
      e.lastLaunchedAt = now;
      e.usage.launches += 1;
      e.usage.lastSessionAt = now;
    });
  }

  async recordSessionDuration(slug: string, ms: number): Promise<void> {
    await this.patch(slug, (e) => {
      e.usage.totalActiveMs += Math.max(0, ms);
    });
  }

  /* ── import / export / backup / restore ── */

  export(): string {
    return JSON.stringify(this.file, null, 2);
  }

  async import(data: string, opts: { merge?: boolean } = {}): Promise<number> {
    this.ensureLoaded();
    const incoming = JSON.parse(data) as RegistryFile;
    if (typeof incoming !== 'object' || !incoming.entries) {
      throw new Error('Invalid registry payload');
    }
    const next = opts.merge ? { ...this.file.entries, ...incoming.entries } : incoming.entries;
    this.file.entries = next;
    await this.persist();
    return Object.keys(next).length;
  }

  async backup(): Promise<string> {
    const dir = join(app.getPath('userData'), 'backups');
    await fs.mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const path = join(dir, `registry-${stamp}.json`);
    await fs.writeFile(path, this.export(), { mode: 0o600 });
    log.info('Registry backed up', { path });
    return path;
  }

  async restore(path: string): Promise<number> {
    const raw = await fs.readFile(path, 'utf8');
    return this.import(raw, { merge: false });
  }
}

export function toDto(e: RegistryEntry): RegistryEntryDto {
  return {
    slug: e.slug,
    name: e.name,
    appType: e.appType,
    installedVersion: e.installedVersion,
    channel: e.channel,
    installLocation: e.installLocation,
    packageHash: e.packageHash,
    signatureKeyId: e.signatureKeyId,
    hasSignature: e.hasSignature,
    grantedPermissions: e.grantedPermissions,
    launchCount: e.launchCount,
    lastLaunchedAt: e.lastLaunchedAt,
    installedAt: e.installedAt,
    lastUpdatedAt: e.lastUpdatedAt,
    runtimeStatus: e.runtimeStatus,
    healthStatus: e.healthStatus,
    diskUsageBytes: e.diskUsageBytes,
    pinned: e.pinned,
    favorite: e.favorite,
    config: e.config,
    usage: {
      launches: e.usage.launches,
      totalActiveMs: e.usage.totalActiveMs,
      lastSessionAt: e.usage.lastSessionAt,
    },
  };
}

export const registry = new Registry();
