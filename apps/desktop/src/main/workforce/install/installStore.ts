/**
 * P8.5 — Worker install store.
 *
 * A JSON-file-backed store of installed worker packages, mirroring the WorkerRegistry
 * persistence pattern exactly (electron-free, first-run tolerant, atomic temp+rename
 * at mode 0o600, serialized background writer, `changed` event). It is the durable
 * source of truth for re-composition on startup and holds the PREVIOUS version of
 * each package for rollback. It is dumb persistence — lifecycle logic lives in the
 * install service.
 */
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import type { WorkerInstallState, WorkerPackageManifest } from '@neuropause/shared';
import { createLogger } from '../../logger';

const log = createLogger('workforce-install-store');

/** A retained prior version, enabling one-step rollback. */
export interface StoredInstallPrevious {
  version: string;
  manifest: WorkerPackageManifest;
  checksum: string;
  signatureKeyId: string | null;
  /** The prior version's signature, retained so rollback stays signature-verifiable. */
  signature: string | null;
}

/** The persisted record for one installed worker package. */
export interface StoredInstall {
  id: string;
  version: string;
  state: WorkerInstallState;
  manifest: WorkerPackageManifest;
  checksum: string;
  signatureKeyId: string | null;
  /** The package signature, retained so it can be RE-VERIFIED on load (tamper-evidence). */
  signature: string | null;
  previous: StoredInstallPrevious | null;
  installedAt: string;
  updatedAt: string;
}

interface InstallFile {
  installs: StoredInstall[];
}

export class InstallStore extends EventEmitter {
  private installs = new Map<string, StoredInstall>();
  private loaded = false;
  private lastPersist: Promise<void> = Promise.resolve();
  private persisting = false;
  private dirty = false;

  constructor(private readonly filePath: string) {
    super();
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const data = JSON.parse(raw) as Partial<InstallFile>;
      for (const r of data.installs ?? []) if (r && r.id) this.installs.set(r.id, r);
    } catch {
      /* First run — empty store. */
    }
    this.loaded = true;
  }

  get(id: string): StoredInstall | null {
    return this.installs.get(id) ?? null;
  }

  has(id: string): boolean {
    return this.installs.has(id);
  }

  all(): StoredInstall[] {
    return [...this.installs.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  put(record: StoredInstall): void {
    this.installs.set(record.id, record);
    this.mutated();
  }

  delete(id: string): boolean {
    const removed = this.installs.delete(id);
    if (removed) this.mutated();
    return removed;
  }

  async flush(): Promise<void> {
    while (this.persisting) await this.lastPersist;
  }

  private mutated(): void {
    this.schedulePersist();
    this.emit('changed');
  }

  private schedulePersist(): void {
    this.dirty = true;
    if (this.persisting) return;
    this.persisting = true;
    this.lastPersist = this.drainPersist();
  }

  private async drainPersist(): Promise<void> {
    try {
      while (this.dirty) {
        this.dirty = false;
        await this.persist();
      }
    } catch (err) {
      log.error('Install store persist failed', { error: String(err) });
    } finally {
      this.persisting = false;
    }
  }

  private async persist(): Promise<void> {
    const file: InstallFile = { installs: [...this.installs.values()] };
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(file), { mode: 0o600 });
    await fs.rename(tmp, this.filePath);
  }
}
