/**
 * P4.1 — durable operator control flags for connectors.
 *
 * Companion to `connectorStore` (account metadata) and `connectorVault` (tokens): this holds the
 * two operator flags the Runtime Supervisor projects into `paused` / `disabled` runtime states —
 * `paused` per account (sync suspended, session kept) and `disabled` per connector (whole connector
 * off). No secrets; plain JSON in userData, atomic write, same discipline as `connectorStore`.
 * Additive and self-contained: nothing else changes shape.
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { DEFAULT_CONTROL_STATE, type ConnectorControlState } from '@neuropause/shared';
import { createLogger } from '../logger';

const log = createLogger('connector-controls');

interface ControlsFile {
  /** `connectorId::accountId` keys of paused accounts. */
  pausedAccounts: string[];
  /** connectorId keys of disabled connectors. */
  disabledConnectors: string[];
}

function storePath(): string {
  return join(app.getPath('userData'), 'connector-controls.json');
}

export class ConnectorControlStore {
  private paused = new Set<string>();
  private disabled = new Set<string>();
  private loaded = false;

  private key(connectorId: string, accountId: string): string {
    return `${connectorId}::${accountId}`;
  }

  /** Loads persisted flags once. Safe to call repeatedly. */
  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await fs.readFile(storePath(), 'utf8');
      const parsed = JSON.parse(raw) as Partial<ControlsFile>;
      if (Array.isArray(parsed.pausedAccounts)) this.paused = new Set(parsed.pausedAccounts.filter((s) => typeof s === 'string'));
      if (Array.isArray(parsed.disabledConnectors)) this.disabled = new Set(parsed.disabledConnectors.filter((s) => typeof s === 'string'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.warn('Failed to read connector controls; starting empty', err);
      }
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    const data: ControlsFile = { pausedAccounts: [...this.paused], disabledConnectors: [...this.disabled] };
    const tmp = `${storePath()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    await fs.rename(tmp, storePath());
  }

  /** The effective control state for an account (disabled is connector-wide). */
  controlFor(connectorId: string, accountId: string): ConnectorControlState {
    if (!this.loaded) return DEFAULT_CONTROL_STATE;
    return {
      paused: this.paused.has(this.key(connectorId, accountId)),
      disabled: this.disabled.has(connectorId),
    };
  }

  isDisabled(connectorId: string): boolean {
    return this.disabled.has(connectorId);
  }

  /** True when sync must be suppressed for this account (paused OR its connector disabled). */
  isSuppressed(connectorId: string, accountId: string): boolean {
    const c = this.controlFor(connectorId, accountId);
    return c.paused || c.disabled;
  }

  async setPaused(connectorId: string, accountId: string, paused: boolean): Promise<void> {
    const k = this.key(connectorId, accountId);
    const changed = paused ? !this.paused.has(k) : this.paused.has(k);
    if (!changed) return;
    if (paused) this.paused.add(k);
    else this.paused.delete(k);
    await this.persist();
  }

  async setDisabled(connectorId: string, disabled: boolean): Promise<void> {
    const changed = disabled ? !this.disabled.has(connectorId) : this.disabled.has(connectorId);
    if (!changed) return;
    if (disabled) this.disabled.add(connectorId);
    else this.disabled.delete(connectorId);
    await this.persist();
  }
}

export const connectorControlStore = new ConnectorControlStore();
