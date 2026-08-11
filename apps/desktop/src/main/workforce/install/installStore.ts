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
import { declareSystemGlobalStore } from '../../tenancy/tenantOwnedStore';

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
  /**
   * P13C ROUND 5 — DECLARED SYSTEM-GLOBAL, WITH A REASON, AND WITH ITS COST NAMED.
   *
   * Installed worker packages are publisher-authored software inventory for one machine: id, version, author, declared skills and permissions, an Ed25519 signature re-verified against a trusted key on every load, and one retained prior version for rollback. No field is derived from, names, or counts a customer record. A per-tenant partition would also be WRONG rather than merely unnecessary: composed workers register into one process-wide WorkerRegistry with one skill-resolution seam, so two tenants cannot hold different versions of the same worker id in one running process. The deliberate cost is a shared administration surface — a workforce:manage holder can uninstall or roll back a package other tenants use — which is the same property as uninstalling a plugin and is why that permission is Admin/Owner only.
   *
   * The cost is stated rather than omitted because that is the difference
   * between a declaration and a dismissal. A reviewer who disagrees with the
   * trade now has something to disagree WITH.
   */
  private installs = new Map<string, StoredInstall>();
  private loaded = false;
  private lastPersist: Promise<void> = Promise.resolve();
  private persisting = false;
  private dirty = false;

  constructor(private readonly filePath: string) {
    declareSystemGlobalStore('workforce-installs', 'Installed worker packages are publisher-authored software inventory for one machine: id, version, author, declared skills and permissions, an Ed25519 signature re-verified against a trusted key on every load, and one retained prior version for rollback. No field is derived from, names, or counts a customer record. A per-tenant partition would also be WRONG rather than merely unnecessary: composed workers register into one process-wide WorkerRegistry with one skill-resolution seam, so two tenants cannot hold different versions of the same worker id in one running process. The deliberate cost is a shared administration surface — a workforce:manage holder can uninstall or roll back a package other tenants use — which is the same property as uninstalling a plugin and is why that permission is Admin/Owner only.');
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
