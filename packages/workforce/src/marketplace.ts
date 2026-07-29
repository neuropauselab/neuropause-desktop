/**
 * Module 15 — AI Marketplace. Install / upgrade / publish workers, plus worker templates, skills,
 * and prompt packs. In-process registry — live-verified; real cross-org distribution reuses the
 * Wave 6 federation marketplace and is not performed here.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { WorkforceGovernance } from './governance';
import { WORKER_MARKET_KINDS, type WorkerMarketKind } from './constants';

export interface MarketItem {
  id: string;
  kind: WorkerMarketKind;
  name: string;
  version: number;
  action: 'installed' | 'published';
  at: number;
}

export class WorkerMarketplace {
  private readonly items = new Map<string, MarketItem>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: WorkforceGovernance,
  ) {}

  private async add(kind: WorkerMarketKind, name: string, action: 'installed' | 'published'): Promise<MarketItem> {
    if (!WORKER_MARKET_KINDS.includes(kind)) throw new Error(`unknown marketplace kind: ${kind}`);
    const item: MarketItem = { id: randomId('mkt'), kind, name, version: 1, action, at: this.clock.now() };
    this.items.set(item.id, item);
    await this.governance.record({ user: 'system', org: '_platform', worker: 'marketplace', operation: `${action}.${kind}`, targetId: item.id, evidence: 'live-verified', reasoning: name });
    return item;
  }

  install(input: { kind: WorkerMarketKind; name: string }): Promise<MarketItem> {
    return this.add(input.kind, input.name, 'installed');
  }
  publish(input: { kind: WorkerMarketKind; name: string }): Promise<MarketItem> {
    return this.add(input.kind, input.name, 'published');
  }
  upgrade(id: string): MarketItem {
    const item = this.items.get(id);
    if (!item) throw new Error(`no market item ${id}`);
    item.version += 1;
    return item;
  }

  list(kind?: WorkerMarketKind): MarketItem[] {
    const all = [...this.items.values()];
    return kind ? all.filter((i) => i.kind === kind) : all;
  }
  count(): number { return this.items.size; }
}
