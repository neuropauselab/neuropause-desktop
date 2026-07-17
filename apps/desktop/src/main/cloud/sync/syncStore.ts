/**
 * The cloud synchronization store. Tracks per-domain sync state (version,
 * pending, status, cursor) for the eight syncable domains, an offline flag, and
 * the resolved-conflict log. Sync runs the pure engine against an **in-process
 * cloud mirror** that simulates the remote.
 *
 * Honest seam: there is no real remote backend in this stage — the "remote" is a
 * simulated mirror that produces small, plausible deltas so offline-first,
 * incremental sync, and conflict resolution are demonstrable and tested. The
 * state machine and engine are real and drop onto a real backend unchanged.
 * Electron-free.
 */
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { SYNC_DOMAINS, type SyncConflict, type SyncDomain, type SyncDomainState, type SyncResult, type SyncSummary } from '@neuropause/shared';
import { planSync, type ConflictSample } from './syncEngine';
import { createLogger } from '../../logger';

const log = createLogger('cloud-sync');

interface SyncFile {
  states: SyncDomainState[];
  conflicts: SyncConflict[];
  online: boolean;
  lastFullSyncAt: string | null;
  tick: number;
  seeded: boolean;
}

const DOMAIN_LABEL: Record<SyncDomain, string> = {
  knowledge_graph: 'node',
  ai_memory: 'item',
  timeline: 'event',
  governance: 'rule',
  ai_workers: 'worker',
  templates: 'template',
  connectors: 'connector',
  marketplace: 'listing',
};

export class SyncStore extends EventEmitter {
  private states = new Map<SyncDomain, SyncDomainState>();
  private conflicts: SyncConflict[] = [];
  private online = true;
  private lastFullSyncAt: string | null = null;
  private tick = 0;

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
      const data = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as Partial<SyncFile>;
      for (const s of data.states ?? []) if (s?.domain) this.states.set(s.domain, s);
      this.conflicts = data.conflicts ?? [];
      this.online = data.online ?? true;
      this.lastFullSyncAt = data.lastFullSyncAt ?? null;
      this.tick = data.tick ?? 0;
      if (!data.seeded || this.states.size === 0) this.applySeed();
    } catch {
      this.applySeed();
    }
    this.loaded = true;
    log.info('Cloud sync ready', { domains: this.states.size, online: this.online });
  }

  private applySeed(): void {
    // Honest initial state for a fresh install: nothing has synced yet, so every domain starts at version 0
    // with no last-sync timestamp. (Previously these were seeded to fabricated non-zero versions/timestamps,
    // which inflated the sync-ops usage KPI on a brand-new install.)
    for (const domain of SYNC_DOMAINS) {
      if (this.states.has(domain)) continue;
      this.states.set(domain, {
        domain,
        localVersion: 0,
        remoteVersion: 0,
        pendingChanges: 0,
        status: 'synced',
        lastSyncedAt: null,
        cursor: `${domain}@0`,
      });
    }
    this.lastFullSyncAt = null;
    this.schedulePersist();
  }

  private async persist(): Promise<void> {
    const tmp = `${this.filePath}.tmp`;
    const payload: SyncFile = {
      states: [...this.states.values()],
      conflicts: this.conflicts.slice(0, 200),
      online: this.online,
      lastFullSyncAt: this.lastFullSyncAt,
      tick: this.tick,
      seeded: true,
    };
    await fs.writeFile(tmp, JSON.stringify(payload), { mode: 0o600 });
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
      log.error('Sync persist failed', { error: String(err) });
    } finally {
      this.persisting = false;
    }
  }
  async flush(): Promise<void> {
    while (this.persisting) await this.lastPersist;
  }

  states_(): SyncDomainState[] {
    return SYNC_DOMAINS.map((d) => this.states.get(d)).filter((s): s is SyncDomainState => Boolean(s));
  }
  listConflicts(): SyncConflict[] {
    return this.conflicts.slice(0, 100);
  }
  isOnline(): boolean {
    return this.online;
  }

  summary(): SyncSummary {
    const states = this.states_();
    return {
      domains: states.length,
      synced: states.filter((s) => s.status === 'synced').length,
      pending: states.reduce((n, s) => n + s.pendingChanges, 0),
      conflicts: this.conflicts.length,
      online: this.online,
      lastFullSyncAt: this.lastFullSyncAt,
    };
  }

  /** Simulate local edits to a domain (bumps pending + local version). */
  recordLocalChange(domain: SyncDomain, count = 1): void {
    const s = this.states.get(domain);
    if (!s) return;
    const next: SyncDomainState = {
      ...s,
      localVersion: s.localVersion + count,
      pendingChanges: s.pendingChanges + count,
      status: this.online ? 'pending' : 'offline',
    };
    this.states.set(domain, next);
    this.schedulePersist();
    this.emit('changed');
  }

  setOnline(online: boolean): void {
    this.online = online;
    for (const [domain, s] of this.states) {
      const status = !online ? 'offline' : s.pendingChanges > 0 ? 'pending' : 'synced';
      this.states.set(domain, { ...s, status });
    }
    this.schedulePersist();
    this.emit('changed');
  }

  /** Simulated remote delta for a domain on this tick (0–2 changes). */
  private remoteDelta(domain: SyncDomain): number {
    const idx = SYNC_DOMAINS.indexOf(domain);
    return (this.tick + idx) % 3;
  }

  private sampleConflicts(domain: SyncDomain, count: number): ConflictSample[] {
    const noun = DOMAIN_LABEL[domain];
    const samples: ConflictSample[] = [];
    for (let i = 0; i < count; i += 1) {
      samples.push({
        entityId: `${noun}-${(this.tick + i) % 7}`,
        field: 'updatedAt',
        localValue: 'edited locally',
        remoteValue: 'edited on another device',
      });
    }
    return samples;
  }

  syncDomain(domain: SyncDomain): SyncResult | { offline: true } {
    const state = this.states.get(domain);
    if (!state) return { offline: true };
    if (!this.online) {
      // Queue: ensure pending state recorded, no push/pull.
      this.states.set(domain, { ...state, status: 'offline' });
      this.schedulePersist();
      this.emit('changed');
      return { offline: true };
    }
    this.tick += 1;
    const remoteChanges = this.remoteDelta(domain);
    const localPending = state.pendingChanges;
    const conflicts = localPending > 0 && remoteChanges > 0 ? this.sampleConflicts(domain, 1) : [];
    const now = Date.now();
    const result = planSync({ state, localPending, remoteChanges, conflicts, now });

    this.states.set(domain, {
      domain,
      localVersion: result.toVersion,
      remoteVersion: result.toVersion,
      pendingChanges: 0,
      status: result.conflicts.length > 0 ? 'synced' : 'synced',
      lastSyncedAt: new Date(now).toISOString(),
      cursor: result.cursor,
    });
    if (result.conflicts.length > 0) this.conflicts = [...result.conflicts, ...this.conflicts].slice(0, 200);
    this.schedulePersist();
    this.emit('changed');
    return result;
  }

  syncAll(): SyncResult[] {
    const results: SyncResult[] = [];
    for (const domain of SYNC_DOMAINS) {
      const r = this.syncDomain(domain);
      if (!('offline' in r)) results.push(r);
    }
    if (this.online) this.lastFullSyncAt = new Date().toISOString();
    this.schedulePersist();
    this.emit('changed');
    return results;
  }
}
