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
  private packs = new Map<string, ExchangePack>();
  private loaded = false;
  private persisting = false;
  private dirty = false;
  private lastPersist: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string, private readonly localOrgId: string, private readonly localOrgName: string) {
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

  list(): ExchangePack[] {
    return [...this.packs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  stats(): ExchangeStats {
    const all = [...this.packs.values()];
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
      publisherOrgId: this.localOrgId,
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

  importPack(id: string): ExchangePack | null {
    const p = this.packs.get(id);
    if (!p || p.installed) return p ?? null;
    const next: ExchangePack = { ...p, installed: true, installs: p.installs + 1 };
    this.packs.set(id, next);
    this.schedulePersist();
    this.emit('changed');
    return next;
  }

  remove(id: string): boolean {
    const ok = this.packs.delete(id);
    if (ok) {
      this.schedulePersist();
      this.emit('changed');
    }
    return ok;
  }
}
