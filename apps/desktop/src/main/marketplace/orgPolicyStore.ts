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
import type { TenantScope } from '@neuropause/shared';
import { TenantOwnership } from '../tenancy/tenantOwnedStore';

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
  /**
   * P13C ROUND 8 — FINDING 3. ONE POLICY PER ORGANIZATION, NOT ONE PER MACHINE.
   *
   * The type is called `OrgMarketplacePolicy` and the store held exactly ONE of
   * them. `requireApproval`, `blockedPublishers`, `requireSignature` and
   * `minPublisherTier` are governance decisions an organization makes about the
   * software ITS people may install — so the name was right and the storage was
   * wrong, which is the most persuasive kind of wrong.
   *
   * The consequence ran both ways: tenant A relaxing `requireApproval` relaxed it
   * for tenant B, and A's `blockedPublishers` list — which names vendors A has
   * decided not to trust, a commercially meaningful statement — was readable by
   * every other tenant.
   *
   * The round required the STORED STATE to have the right ownership model rather
   * than a filter over a shared record, so the file format is now a map keyed by
   * tenant. An unresolved caller reads the DEFAULT policy and cannot write: a
   * default is the strictest honest answer, and writing would have to invent an
   * owner.
   */
  private readonly tenancy = new TenantOwnership('marketplace-org-policy');

  /** Bind the tenant boundary. UNBOUND DENIES WRITES. Chainable. */
  bindScope(source: () => TenantScope | null): this {
    this.tenancy.bindScope(source);
    return this;
  }
  hasScope(): boolean {
    return this.tenancy.hasScope();
  }

  private byTenant = new Map<string, OrgMarketplacePolicy>();
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
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      /**
       * MIGRATION. The old format was a bare policy object; the new one is
       * `{ byTenant: { [tenantId]: policy } }`.
       *
       * A legacy file's single policy is NOT adopted by any tenant. It cannot be
       * — the data contains no evidence of who set it, and this program's rule is
       * that a migration must never invent provenance. Every organization
       * therefore starts from the DEFAULT, which is the stricter direction:
       * `requireApproval` defaults on, so an upgraded install does not silently
       * inherit a relaxation somebody else made.
       */
      if (parsed.byTenant !== undefined && typeof parsed.byTenant === 'object') {
        for (const [tenantId, policy] of Object.entries(parsed.byTenant as Record<string, unknown>)) {
          if (tenantId !== '') {
            this.byTenant.set(tenantId, { ...DEFAULT_ORG_POLICY, ...(policy as Partial<OrgMarketplacePolicy>) });
          }
        }
      }
    } catch {
      /* First run — default policy. */
    }
    this.loaded = true;
  }

  /** The CALLER'S policy, or the default. Never another organization's. */
  get(): OrgMarketplacePolicy {
    const tenantId = this.tenancy.scopeOrDeny()?.tenantId ?? null;
    if (tenantId === null) return { ...DEFAULT_ORG_POLICY };
    return this.byTenant.get(tenantId) ?? { ...DEFAULT_ORG_POLICY };
  }

  /**
   * Write the CALLER'S policy. Throws when unresolved.
   *
   * `requireTenant()` rather than a fallback: a marketplace governance rule filed
   * under the wrong organization either blocks software that org allows or admits
   * software it forbids, and both are worse than a refused write.
   */
  set(next: Omit<OrgMarketplacePolicy, 'updatedAt'>, now = new Date().toISOString()): OrgMarketplacePolicy {
    const tenantId = this.tenancy.requireTenant();
    const policy: OrgMarketplacePolicy = { ...next, updatedAt: now };
    this.byTenant.set(tenantId, policy);
    this.schedulePersist();
    this.emit('changed');
    return policy;
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
        await fs.writeFile(tmp, JSON.stringify({ byTenant: Object.fromEntries(this.byTenant) }), {
          mode: 0o600,
        });
        await fs.rename(tmp, this.filePath);
      }
    } catch (err) {
      log.error('Policy persist failed', { error: String(err) });
    } finally {
      this.persisting = false;
    }
  }
}
