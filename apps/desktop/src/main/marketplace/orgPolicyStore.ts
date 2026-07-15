/**
 * P9 — Organization marketplace policy store.
 *
 * Persists a single `OrgMarketplacePolicy` (allowed/blocked publishers, blocked types,
 * minimum publisher tier, signature + approval requirements). This is enterprise CONFIG
 * DATA that the pure model EVALUATES — not a new governance engine. Mirrors the house
 * store pattern (electron-free, first-run tolerant, atomic temp+rename 0o600).
 */
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import type { OrgMarketplacePolicy } from '@neuropause/shared';
import { createLogger } from '../logger';

const log = createLogger('marketplace-policy');

export const DEFAULT_ORG_POLICY: OrgMarketplacePolicy = {
  requireApproval: false,
  allowedPublishers: [],
  blockedPublishers: [],
  blockedTypes: [],
  minPublisherTier: 'unverified',
  requireSignature: false,
  updatedAt: '',
};

export class OrgPolicyStore extends EventEmitter {
  private policy: OrgMarketplacePolicy = { ...DEFAULT_ORG_POLICY };
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
      this.policy = { ...DEFAULT_ORG_POLICY, ...(JSON.parse(raw) as Partial<OrgMarketplacePolicy>) };
    } catch {
      /* First run — default policy. */
    }
    this.loaded = true;
  }

  get(): OrgMarketplacePolicy {
    return this.policy;
  }

  set(next: Omit<OrgMarketplacePolicy, 'updatedAt'>, now = new Date().toISOString()): OrgMarketplacePolicy {
    this.policy = { ...next, updatedAt: now };
    this.schedulePersist();
    this.emit('changed');
    return this.policy;
  }

  async flush(): Promise<void> {
    while (this.persisting) await this.lastPersist;
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
        const tmp = `${this.filePath}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(this.policy), { mode: 0o600 });
        await fs.rename(tmp, this.filePath);
      }
    } catch (err) {
      log.error('Policy persist failed', { error: String(err) });
    } finally {
      this.persisting = false;
    }
  }
}
