/**
 * Discovery state (P6). The incremental-discovery cursor + per-domain stats, keyed `platformId::accountId`.
 *
 * This is the infrastructure analog of `SyncStateStore` — deliberately a small, separate store (not a reuse
 * of `SyncStateStore`) because that store's `ResourceCursor` is typed to `UnifiedEntityKind` and
 * connector-module statuses, which don't fit infrastructure domains. It mirrors `SyncStateStore`'s design
 * exactly (durable JSON, cursor preserved across stat writes, crash-reconcile) so the discovery engine gets
 * the SAME incremental-resume guarantees. The heavier runtime primitives — `RetryQueue`, `RateLimiter`, and
 * the `HttpClient` — ARE reused verbatim by the engine; only this thin state holder is infra-specific.
 *
 * Electron-free (JSON-file-backed, or in-memory when constructed with a null path).
 */
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import type { InfrastructureDomain } from '@neuropause/shared';

export type DomainDiscoveryStatus = 'active' | 'unauthorized' | 'unprovisioned' | 'error' | 'idle';
export type AccountDiscoveryStatus = 'idle' | 'discovering' | 'degraded' | 'error';

/** Per-domain discovery state: the incremental cursor plus the stats the Cloud Platform Center reads. */
export interface DomainCursorState {
  cursor: string | null;
  lastDiscoveryAt: string | null;
  label?: string;
  domain?: InfrastructureDomain;
  resourceCount?: number;
  status?: DomainDiscoveryStatus;
  reason?: string | null;
}

export interface AccountDiscoveryState {
  platformId: string;
  accountId: string;
  status: AccountDiscoveryStatus;
  lastDiscoveryAt: string | null;
  nextDiscoveryAt: string | null;
  resourceCount: number;
  consecutiveFailures: number;
  region: string | null;
  domains: Record<string, DomainCursorState>;
}

/** The narrow port the discovery engine depends on (injected, so tests use a fake). */
export interface DiscoveryStatePort {
  getCursor(platformId: string, accountId: string, collectorId: string): string | null;
  setCursor(platformId: string, accountId: string, collectorId: string, cursor: string | null, at: string): Promise<void>;
  recordDomain(platformId: string, accountId: string, collectorId: string, patch: Partial<Omit<DomainCursorState, 'cursor'>>): Promise<void>;
  recordRun(platformId: string, accountId: string, patch: Partial<Omit<AccountDiscoveryState, 'platformId' | 'accountId' | 'domains'>>): Promise<void>;
  get(platformId: string, accountId: string): AccountDiscoveryState;
  all(platformId?: string): AccountDiscoveryState[];
}

const key = (p: string, a: string): string => `${p}::${a}`;

function defaultState(platformId: string, accountId: string): AccountDiscoveryState {
  return {
    platformId,
    accountId,
    status: 'idle',
    lastDiscoveryAt: null,
    nextDiscoveryAt: null,
    resourceCount: 0,
    consecutiveFailures: 0,
    region: null,
    domains: {},
  };
}

/** Which account's discovery state was just written. */
export interface DiscoveryChangedEvent {
  platformId: string;
  accountId: string;
}

/** A7 — `changed` carries a checked payload; see the note on `ResourceStore`. */
export class DiscoveryStateStore
  extends EventEmitter<{ changed: [DiscoveryChangedEvent] }>
  implements DiscoveryStatePort
{
  private states = new Map<string, AccountDiscoveryState>();
  private loaded = false;

  constructor(private readonly filePath: string | null) {
    super();
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    if (this.filePath) {
      try {
        const raw = await fs.readFile(this.filePath, 'utf8');
        const list = JSON.parse(raw) as AccountDiscoveryState[];
        if (Array.isArray(list)) for (const s of list) if (s?.platformId) this.states.set(key(s.platformId, s.accountId), s);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') { /* corrupt → start empty */ }
      }
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    if (!this.filePath) return;
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify([...this.states.values()]), { mode: 0o600 });
    await fs.rename(tmp, this.filePath);
  }

  get(platformId: string, accountId: string): AccountDiscoveryState {
    return this.states.get(key(platformId, accountId)) ?? defaultState(platformId, accountId);
  }

  all(platformId?: string): AccountDiscoveryState[] {
    const list = [...this.states.values()];
    return platformId ? list.filter((s) => s.platformId === platformId) : list;
  }

  getCursor(platformId: string, accountId: string, collectorId: string): string | null {
    return this.get(platformId, accountId).domains[collectorId]?.cursor ?? null;
  }

  async setCursor(platformId: string, accountId: string, collectorId: string, cursor: string | null, at: string): Promise<void> {
    const k = key(platformId, accountId);
    const state = this.states.get(k) ?? defaultState(platformId, accountId);
    const prev = state.domains[collectorId];
    state.domains[collectorId] = { ...prev, cursor, lastDiscoveryAt: at };
    this.states.set(k, state);
    await this.persist();
  }

  async recordDomain(platformId: string, accountId: string, collectorId: string, patch: Partial<Omit<DomainCursorState, 'cursor'>>): Promise<void> {
    const k = key(platformId, accountId);
    const state = this.states.get(k) ?? defaultState(platformId, accountId);
    const prev = state.domains[collectorId] ?? { cursor: null, lastDiscoveryAt: null };
    state.domains[collectorId] = { ...prev, ...patch };
    this.states.set(k, state);
    await this.persist();
  }

  async recordRun(platformId: string, accountId: string, patch: Partial<Omit<AccountDiscoveryState, 'platformId' | 'accountId' | 'domains'>>): Promise<void> {
    const k = key(platformId, accountId);
    const state = this.states.get(k) ?? defaultState(platformId, accountId);
    Object.assign(state, patch);
    this.states.set(k, state);
    await this.persist();
    this.emit('changed', { platformId, accountId });
  }

  /** Crash reconciler — an account left `discovering` was interrupted; reset to `idle`. Returns how many. */
  async reconcile(): Promise<{ reset: number }> {
    let reset = 0;
    for (const s of this.states.values()) {
      if (s.status === 'discovering') {
        s.status = 'idle';
        reset += 1;
      }
    }
    if (reset > 0) await this.persist();
    return { reset };
  }
}
