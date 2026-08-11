/**
 * The Organization Exchange store: curated **packs** (bundles of knowledge,
 * workers, automations, or connectors) that organizations share across the
 * network. Seeded with community packs shared in from other organizations; the
 * local organization can publish its own packs and import shared ones.
 *
 * This is a single-tenant app, so the network is modeled honestly: the seeded
 * external organizations are fixtures, and "import" records the local
 * organization adopting a shared pack. Electron-free.
 */
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { ExchangePack, ExchangeStats, PackItem, PackKind } from '@neuropause/shared';
import { createLogger } from '../../logger';
import { demoSeedsEnabled } from '../../demoSeed';
import type { TenantScope } from '@neuropause/shared';
import { TenantOwnership } from '../../tenancy/tenantOwnedStore';
import { declareStoreScope } from '../../tenancy/storeScope';

/**
 * P13C ROUND 10 — THE RETENTION DECLARATION THIS FILE COULD NOT MAKE.
 *
 * The store satisfied the scope gate by holding a `TenantOwnership`, which takes
 * no retention argument. The answer is good and worth stating: nothing here is
 * capped, so the only way a pack disappears is its own publisher removing it.
 */
declareStoreScope({
  name: 'ecosystem-packs',
  scope: 'TENANT',
  persistence: 'file',
  authority: 'ORG_ROLE',
  classification: 'CUSTOMER_DERIVED',
  retentionScope: 'OWNER',
  retentionAuthority: 'OWNER',
  retention:
    'No cap, no TTL, no eviction: nothing is ever removed to make room, so no organization\'s ' +
    'publishing volume can reach another\'s packs. ONE removal, `remove(id)`, which resolves the ' +
    'pack through `mine(id)` — comparing `publisherOrgId` to the caller\'s tenant — and returns ' +
    'false for a foreign id. It was `packs.delete(id)` on a bare payload id: an unrecoverable ' +
    "cross-tenant HARD DELETE of another organization's published pack, and the sharpest write in " +
    'this file. `importPack` mutates a counter in place through the same resolver and removes nothing.',
  reason:
    "A pack bundles an organization's own knowledge, workers, automations or connector " +
    'configurations, and `list()`/`stats()` were reachable on `developer:read`. This store wore the ' +
    'most misleading shape a tenancy defect takes: `publish()` stamped `publisherOrgId: ' +
    'this.localOrgId` — the literal seeded ORG_ID — so every row LOOKED owned while the value was a ' +
    'constant nothing ever read back. The seeded org id is still accepted by the constructor and ' +
    'deliberately unused, so the evidence that it was once the publisher stamp is not erased. ' +
    'Binding is asserted by the TenantOwnership this class holds.',
});

const log = createLogger('ecosystem-exchange');

interface PackFile {
  packs: ExchangePack[];
  seeded: boolean;
}

export interface SeedPack {
  name: string;
  summary: string;
  kind: PackKind;
  publisherOrg: string;
  items: PackItem[];
}

const SEED_PACKS: SeedPack[] = [
  {
    name: 'Sales Enablement Knowledge Pack',
    summary: 'Battle cards, objection handling, and ICP definitions curated by a peer organization.',
    kind: 'knowledge',
    publisherOrg: 'Helios Commerce',
    items: [
      { kind: 'document', name: 'ICP & Personas', detail: '12 documents' },
      { kind: 'document', name: 'Objection Handling Playbook', detail: '1 playbook' },
      { kind: 'note', name: 'Competitive Battle Cards', detail: '8 cards' },
    ],
  },
  {
    name: 'Finance Operations Worker Pack',
    summary: 'A set of read-only finance workers for close, variance, and runway analysis.',
    kind: 'ai_worker',
    publisherOrg: 'Aperture Capital',
    items: [
      { kind: 'ai_worker', name: 'Close Analyst', detail: 'summarize · variance' },
      { kind: 'ai_worker', name: 'Runway Forecaster', detail: 'forecast' },
    ],
  },
  {
    name: 'Onboarding Automation Pack',
    summary: 'New-hire automations: account provisioning checklists and welcome sequences.',
    kind: 'automation',
    publisherOrg: 'Northwind Labs',
    items: [
      { kind: 'automation', name: 'New Hire Checklist', detail: 'trigger · notify' },
      { kind: 'automation', name: 'Welcome Sequence', detail: '3 steps' },
    ],
  },
  {
    name: 'Data Stack Connector Pack',
    summary: 'Pre-configured connectors for a modern data stack, with least-privilege scopes.',
    kind: 'connector',
    publisherOrg: 'Helios Commerce',
    items: [
      { kind: 'connector', name: 'Warehouse Sync', detail: 'read-only' },
      { kind: 'connector', name: 'BI Export', detail: 'export' },
    ],
  },
];

export class PacksStore extends EventEmitter {
  /**
   * P13C ROUND 4 — F9. THE TENANT BOUNDARY.
   *
   * This store had none, and it wore the most misleading shape a tenancy defect
   * takes: `publish()` stamped `publisherOrgId: this.localOrgId` — the literal
   * seeded `ORG_ID` — so every row LOOKED owned, and the value was a constant
   * that nothing ever read back.
   *
   *   list() / stats()   every organization's packs, on `developer:read`.
   *   importPack(id)     bare payload id, mutating another tenant's counters.
   *   remove(id)         `packs.delete(id)` on a bare payload id — a HARD
   *                      DELETE of another organization's published pack.
   *
   * It was also conspicuously absent from the binding block that binds its three
   * siblings in `ecosystem/index.ts`, while still being loaded beside them —
   * which is what an omission looks like when nothing enforces the list.
   */
  private readonly tenancy = new TenantOwnership('ecosystem-packs');

  private packs = new Map<string, ExchangePack>();
  private loaded = false;
  private persisting = false;
  private dirty = false;
  private lastPersist: Promise<void> = Promise.resolve();

  /**
   * The seeded organization id is accepted and DELIBERATELY UNUSED.
   *
   * It is kept in the signature so the call site stays stable and so this line
   * records that the value exists and is not an authority. Removing the
   * parameter would erase the evidence that it was once the publisher stamp.
   */
  constructor(private readonly filePath: string, _seedOrgId: string, private readonly localOrgName: string) {
    super();
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const data = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as Partial<PackFile>;
      for (const p of data.packs ?? []) if (p?.id) this.packs.set(p.id, p);
      if (!data.seeded || this.packs.size === 0) this.applySeed();
    } catch {
      this.applySeed();
    }
    this.loaded = true;
    log.info('Organization exchange ready', { packs: this.packs.size });
  }

  private applySeed(): void {
    // The seeded packs are community fixtures published by external organizations, with Math.random-derived
    // install counts; none are first-party. A production install shows an empty exchange until real packs are
    // published or imported, so gate the fixtures behind the demo-seed flag (persist the empty seeded state).
    if (!demoSeedsEnabled()) {
      this.schedulePersist();
      return;
    }
    for (const s of SEED_PACKS) {
      if ([...this.packs.values()].some((p) => p.name === s.name)) continue;
      const pack: ExchangePack = {
        id: `pack_${randomUUID()}`,
        name: s.name,
        summary: s.summary,
        kind: s.kind,
        publisherOrg: s.publisherOrg,
        publisherOrgId: `org-${s.publisherOrg.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        isLocal: false,
        items: s.items,
        installs: Math.floor(Math.random() * 40) + 5,
        installed: false,
        createdAt: new Date(Date.now() - Math.floor(Math.random() * 60) * 86_400_000).toISOString(),
      };
      this.packs.set(pack.id, pack);
    }
    this.schedulePersist();
  }

  private async persist(): Promise<void> {
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ packs: [...this.packs.values()], seeded: true } satisfies PackFile), { mode: 0o600 });
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
      log.error('Exchange persist failed', { error: String(err) });
    } finally {
      this.persisting = false;
    }
  }
  async flush(): Promise<void> {
    while (this.persisting) await this.lastPersist;
  }

  /** Bind the tenant boundary. UNBOUND DENIES. Chainable. */
  bindScope(source: () => TenantScope | null): this {
    this.tenancy.bindScope(source);
    return this;
  }
  hasScope(): boolean {
    return this.tenancy.hasScope();
  }
  /** Unscoped ownership counts, for the migration inventory. */
  ownershipCounts(): { total: number; assigned: number; unresolved: number } {
    return this.tenancy.countOwnership(
      [...this.packs.values()].map((p) => ({ tenantId: p.publisherOrgId })),
    );
  }

  /** One of the CALLER'S packs by id, or null. The single ownership resolve. */
  private mine(id: string): ExchangePack | null {
    const p = this.packs.get(id) ?? null;
    if (p === null) return null;
    const scope = this.tenancy.scopeOrDeny();
    if (scope === null || !scope.tenantId) return null;
    return p.publisherOrgId === scope.tenantId ? p : null;
  }

  /** The CALLER'S packs. Was every organization's. */
  list(): ExchangePack[] {
    return this.visible().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private visible(): ExchangePack[] {
    const scope = this.tenancy.scopeOrDeny();
    if (scope === null || !scope.tenantId) return [];
    return [...this.packs.values()].filter((p) => p.publisherOrgId === scope.tenantId);
  }

  stats(): ExchangeStats {
    const all = this.visible();
    const byKind: Record<string, number> = {};
    for (const p of all) byKind[p.kind] = (byKind[p.kind] ?? 0) + 1;
    return {
      total: all.length,
      published: all.filter((p) => p.isLocal).length,
      imported: all.filter((p) => p.installed).length,
      byKind,
    };
  }

  publish(input: { name: string; summary: string; kind: PackKind; items: PackItem[] }): ExchangePack {
    const pack: ExchangePack = {
      id: `pack_${randomUUID()}`,
      name: input.name,
      summary: input.summary,
      kind: input.kind,
      publisherOrg: this.localOrgName,
      // The CALLER, not the seeded organization.
      publisherOrgId: this.tenancy.requireTenant(),
      isLocal: true,
      items: input.items,
      installs: 0,
      installed: true,
      createdAt: new Date().toISOString(),
    };
    this.packs.set(pack.id, pack);
    this.schedulePersist();
    this.emit('changed');
    return pack;
  }

  /** Import one of the CALLER'S packs. Was a bare payload id. */
  importPack(id: string): ExchangePack | null {
    const p = this.mine(id);
    if (!p || p.installed) return p ?? null;
    const next: ExchangePack = { ...p, installed: true, installs: p.installs + 1 };
    this.packs.set(id, next);
    this.schedulePersist();
    this.emit('changed');
    return next;
  }

  /**
   * Delete one of the CALLER'S packs.
   *
   * Was `packs.delete(id)` on a bare id — an unrecoverable cross-tenant delete,
   * the sharpest write in this file.
   */
  remove(id: string): boolean {
    if (this.mine(id) === null) return false;
    const ok = this.packs.delete(id);
    if (ok) {
      this.schedulePersist();
      this.emit('changed');
    }
    return ok;
  }
}
