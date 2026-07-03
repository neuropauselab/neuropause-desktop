/**
 * The Installations store: which marketplace listings the organization has
 * installed, at which version. It is deliberately unaware of the marketplace —
 * it stores the installed version id; the composition root compares that against
 * each listing's current published version to surface "update available".
 * Electron-free.
 */
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Installation, ListingKind } from '@neuropause/shared';
import { createLogger } from '../../logger';

const log = createLogger('ecosystem-installs');

interface InstallFile {
  installs: Installation[];
}

export interface InstallInput {
  orgId: string;
  listingId: string;
  listingName: string;
  kind: ListingKind;
  versionId: string;
  version: string;
}

export class InstallsStore extends EventEmitter {
  private installs = new Map<string, Installation>();
  private loaded = false;
  private persisting = false;
  private dirty = false;
  private lastPersist: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {
    super();
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const data = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as Partial<InstallFile>;
      for (const i of data.installs ?? []) if (i?.id) this.installs.set(i.id, i);
    } catch {
      /* empty until first install */
    }
    this.loaded = true;
    log.info('Ecosystem installs ready', { installs: this.installs.size });
  }

  private async persist(): Promise<void> {
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ installs: [...this.installs.values()] } satisfies InstallFile), { mode: 0o600 });
    await fs.rename(tmp, this.filePath);
  }
  private schedulePersist(): void {
    this.dirty = true;
    if (this.persisting) return;
    this.persisting = true;
    this.lastPersist = this.drain();
  }
  private async drain(): Promise<void> {
    try {
      while (this.dirty) {
        this.dirty = false;
        await this.persist();
      }
    } catch (err) {
      log.error('Installs persist failed', { error: String(err) });
    } finally {
      this.persisting = false;
    }
  }
  async flush(): Promise<void> {
    while (this.persisting) await this.lastPersist;
  }

  forOrg(orgId: string): Installation[] {
    return [...this.installs.values()].filter((i) => i.orgId === orgId).sort((a, b) => b.installedAt.localeCompare(a.installedAt));
  }

  forListing(orgId: string, listingId: string): Installation | null {
    return [...this.installs.values()].find((i) => i.orgId === orgId && i.listingId === listingId) ?? null;
  }

  /** Install a listing, or bump the installed version if already present. */
  install(input: InstallInput): Installation {
    const existing = this.forListing(input.orgId, input.listingId);
    const now = new Date().toISOString();
    if (existing) {
      const next: Installation = { ...existing, installedVersionId: input.versionId, installedVersion: input.version, status: 'installed', updatedAt: now };
      this.installs.set(existing.id, next);
      this.schedulePersist();
      this.emit('changed');
      return next;
    }
    const install: Installation = {
      id: `ins_${randomUUID()}`,
      orgId: input.orgId,
      listingId: input.listingId,
      listingName: input.listingName,
      kind: input.kind,
      installedVersionId: input.versionId,
      installedVersion: input.version,
      status: 'installed',
      installedAt: now,
      updatedAt: now,
    };
    this.installs.set(install.id, install);
    this.schedulePersist();
    this.emit('changed');
    return install;
  }

  setDisabled(id: string, disabled: boolean): Installation | null {
    const i = this.installs.get(id);
    if (!i) return null;
    const next: Installation = { ...i, status: disabled ? 'disabled' : 'installed', updatedAt: new Date().toISOString() };
    this.installs.set(id, next);
    this.schedulePersist();
    this.emit('changed');
    return next;
  }

  uninstall(id: string): boolean {
    const ok = this.installs.delete(id);
    if (ok) {
      this.schedulePersist();
      this.emit('changed');
    }
    return ok;
  }
}
