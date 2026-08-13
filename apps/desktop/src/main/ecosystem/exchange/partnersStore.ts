/**
 * The Partner Platform directory: technology partners, consulting partners,
 * system integrators, and managed service providers in the NeuroPause ecosystem.
 * Seeded on first run with a representative directory and persisted so it stays
 * stable. Electron-free.
 */
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Partner, PartnerStats, PartnerTier, PartnerType } from '@neuropause/shared';
import { createLogger } from '../../logger';
import { demoSeedsEnabled } from '../../demoSeed';
import { declareStoreScope } from '../../tenancy/storeScope';

/** P13C ROUND 8 — the structural scope declaration. See tenancy/storeScope.ts. */
declareStoreScope({
  name: 'ecosystem-partner-directory',
  scope: 'INSTALL_GLOBAL',
  persistence: 'file',
  authority: 'SYSTEM',
  classification: 'INSTALL_METADATA',
  retention: 'No cap and no delete path. Rows are seeded and never customer-written.',
  reason: 'WHY GLOBAL: rows are third-party partner companies (name, tier, website, regions) with no tenant field and NO mutating channel — the only handlers are list and stats. WHO ACCESSES: any signed-in member. WHO MODIFIES: nobody at runtime. WHY IT CANNOT DISCLOSE TENANT DATA: nothing in a row originates from a customer. CROSS-TENANT COST: none.',
});

const log = createLogger('ecosystem-partners');

interface PartnerFile {
  partners: Partner[];
  seeded: boolean;
}

interface SeedPartner {
  name: string;
  type: PartnerType;
  tier: PartnerTier;
  description: string;
  website: string;
  regions: string[];
  specializations: string[];
  listings: number;
  certified: boolean;
}

const SEED_PARTNERS: SeedPartner[] = [
  {
    name: 'Helios Commerce',
    type: 'technology',
    tier: 'premier',
    description: 'Commerce data platform with certified connectors for orders, catalog, and fulfillment.',
    website: 'https://helios.example',
    regions: ['North America', 'EMEA'],
    specializations: ['Connectors', 'Data Sync', 'Retail'],
    listings: 6,
    certified: true,
  },
  {
    name: 'Aperture Capital Advisory',
    type: 'consulting',
    tier: 'select',
    description: 'Boutique consultancy specializing in finance-ops AI worker design and governance.',
    website: 'https://aperture.example',
    regions: ['North America'],
    specializations: ['AI Workers', 'Finance', 'Governance'],
    listings: 3,
    certified: true,
  },
  {
    name: 'Northwind Integrations',
    type: 'system_integrator',
    tier: 'premier',
    description: 'Enterprise SI delivering large-scale NeuroPause rollouts and custom enterprise templates.',
    website: 'https://northwind.example',
    regions: ['North America', 'EMEA', 'APAC'],
    specializations: ['Enterprise Templates', 'Rollouts', 'Change Management'],
    listings: 9,
    certified: true,
  },
  {
    name: 'Meridian Managed Services',
    type: 'msp',
    tier: 'select',
    description: 'Managed service provider operating NeuroPause workforces for mid-market customers.',
    website: 'https://meridian.example',
    regions: ['EMEA'],
    specializations: ['Managed Workforce', 'Operations', 'Support'],
    listings: 2,
    certified: false,
  },
  {
    name: 'Vega Analytics',
    type: 'technology',
    tier: 'registered',
    description: 'Analytics and dashboard templates for executive reporting.',
    website: 'https://vega.example',
    regions: ['APAC'],
    specializations: ['Dashboards', 'Analytics'],
    listings: 4,
    certified: false,
  },
  {
    name: 'Atlas Advisory Group',
    type: 'consulting',
    tier: 'premier',
    description: 'Industry-template specialists for healthcare, finance, and the public sector.',
    website: 'https://atlas.example',
    regions: ['North America', 'EMEA'],
    specializations: ['Industry Templates', 'Compliance', 'Strategy'],
    listings: 7,
    certified: true,
  },
];

export class PartnersStore extends EventEmitter {
  private partners = new Map<string, Partner>();
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
      const data = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as Partial<PartnerFile>;
      for (const p of data.partners ?? []) if (p?.id) this.partners.set(p.id, p);
      if (!data.seeded || this.partners.size === 0) this.applySeed();
    } catch {
      this.applySeed();
    }
    this.loaded = true;
    log.info('Partner directory ready', { partners: this.partners.size });
  }

  private applySeed(): void {
    // The partner directory below is a fabricated fixture (hardcoded listing counts, certifications, random
    // join dates). A production install starts with an empty directory and fills it from real partners, so gate
    // the fixtures behind the demo-seed flag (persist the empty seeded state).
    if (!demoSeedsEnabled()) {
      this.schedulePersist();
      return;
    }
    for (const s of SEED_PARTNERS) {
      if ([...this.partners.values()].some((p) => p.name === s.name)) continue;
      const id = `prt_${randomUUID()}`;
      this.partners.set(id, {
        id,
        ...s,
        joinedAt: new Date(Date.now() - Math.floor(Math.random() * 300) * 86_400_000).toISOString(),
      });
    }
    this.schedulePersist();
  }

  private async persist(): Promise<void> {
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ partners: [...this.partners.values()], seeded: true } satisfies PartnerFile), { mode: 0o600 });
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
      log.error('Partners persist failed', { error: String(err) });
    } finally {
      this.persisting = false;
    }
  }
  async flush(): Promise<void> {
    while (this.persisting) await this.lastPersist;
  }

  list(): Partner[] {
    const order: Record<PartnerTier, number> = { premier: 0, select: 1, registered: 2 };
    return [...this.partners.values()].sort((a, b) => order[a.tier] - order[b.tier] || a.name.localeCompare(b.name));
  }

  stats(): PartnerStats {
    const all = [...this.partners.values()];
    const byType: Record<string, number> = {};
    for (const p of all) byType[p.type] = (byType[p.type] ?? 0) + 1;
    return {
      total: all.length,
      byType,
      premier: all.filter((p) => p.tier === 'premier').length,
      certified: all.filter((p) => p.certified).length,
    };
  }
}
