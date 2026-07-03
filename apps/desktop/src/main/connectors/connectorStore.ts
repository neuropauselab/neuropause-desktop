/**
 * Durable, non-secret persistence of connected-account metadata.
 *
 * This is the companion to the encrypted vault: the vault holds tokens, this
 * holds everything else about a connection (label, status, granted scopes, sync
 * timestamps). Persisted as plain JSON in userData because it contains no
 * secrets — only what the Connectors UI renders.
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import type { ConnectedAccount, SyncState } from '@neuropause/shared';
import { createLogger } from '../logger';

const log = createLogger('connector-store');

function storePath(): string {
  return join(app.getPath('userData'), 'connectors.json');
}

class ConnectorStore {
  private accounts = new Map<string, ConnectedAccount>();
  private loaded = false;

  private key(connectorId: string, accountId: string): string {
    return `${connectorId}::${accountId}`;
  }

  /** Loads persisted accounts once. Safe to call repeatedly. */
  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await fs.readFile(storePath(), 'utf8');
      const list = JSON.parse(raw) as ConnectedAccount[];
      if (Array.isArray(list)) {
        for (const a of list) {
          if (a && a.id && a.connectorId) this.accounts.set(this.key(a.connectorId, a.id), a);
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.warn('Failed to read connectors store; starting empty', err);
      }
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    const tmp = `${storePath()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify([...this.accounts.values()], null, 2), { mode: 0o600 });
    await fs.rename(tmp, storePath());
  }

  /** All connected accounts across every connector. */
  all(): ConnectedAccount[] {
    return [...this.accounts.values()];
  }

  /** Accounts for one connector. */
  byConnector(connectorId: string): ConnectedAccount[] {
    return this.all().filter((a) => a.connectorId === connectorId);
  }

  get(connectorId: string, accountId: string): ConnectedAccount | null {
    return this.accounts.get(this.key(connectorId, accountId)) ?? null;
  }

  /** Inserts or replaces an account and persists. */
  async upsert(account: ConnectedAccount): Promise<ConnectedAccount> {
    this.accounts.set(this.key(account.connectorId, account.id), account);
    await this.persist();
    return account;
  }

  /** Applies a partial update to an existing account. */
  async patch(
    connectorId: string,
    accountId: string,
    patch: Partial<ConnectedAccount>,
  ): Promise<ConnectedAccount | null> {
    const existing = this.get(connectorId, accountId);
    if (!existing) return null;
    const next = { ...existing, ...patch };
    return this.upsert(next);
  }

  async setSync(
    connectorId: string,
    accountId: string,
    state: SyncState,
    at: string | null,
  ): Promise<ConnectedAccount | null> {
    return this.patch(connectorId, accountId, {
      lastSyncState: state,
      lastSyncAt: at ?? this.get(connectorId, accountId)?.lastSyncAt ?? null,
    });
  }

  async remove(connectorId: string, accountId: string): Promise<void> {
    if (this.accounts.delete(this.key(connectorId, accountId))) await this.persist();
  }
}

export const connectorStore = new ConnectorStore();
