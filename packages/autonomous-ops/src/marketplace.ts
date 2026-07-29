/**
 * Module 18 — Operations Marketplace. Publish / install mission packs, industry-ops packs,
 * dashboards, simulations, and AI coordinators. A listing is a real in-process descriptor
 * (live-verified that it is listed); it is NOT executed until installed, and real cross-org
 * distribution reuses the Wave 6 federation marketplace and is not performed here. Starts empty.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { OperationsGovernance } from './governance';
import { OPS_MARKET_KINDS, type OpsMarketKind } from './constants';

export interface OpsMarketItem {
  id: string;
  kind: OpsMarketKind;
  name: string;
  provider: string;
  installed: boolean;
  at: number;
}

export class OperationsMarketplace {
  private readonly items = new Map<string, OpsMarketItem>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: OperationsGovernance,
  ) {}

  async publish(input: { kind: OpsMarketKind; name: string; provider: string }): Promise<OpsMarketItem> {
    if (!OPS_MARKET_KINDS.includes(input.kind)) throw new Error(`unknown marketplace kind: ${input.kind}`);
    const item: OpsMarketItem = { id: randomId('opsmkt'), kind: input.kind, name: input.name, provider: input.provider, installed: false, at: this.clock.now() };
    this.items.set(item.id, item);
    await this.governance.record({ user: 'system', org: '_platform', mission: '_marketplace', operation: `marketplace.publish.${input.kind}`, targetId: item.id, evidence: 'live-verified', decision: input.provider });
    return item;
  }

  async install(id: string): Promise<OpsMarketItem> {
    const item = this.items.get(id);
    if (!item) throw new Error(`no marketplace item ${id}`);
    item.installed = true;
    await this.governance.record({ user: 'system', org: '_platform', mission: '_marketplace', operation: `marketplace.install.${item.kind}`, targetId: item.id, evidence: 'live-verified' });
    return item;
  }

  list(kind?: OpsMarketKind): OpsMarketItem[] {
    const all = [...this.items.values()];
    return kind ? all.filter((i) => i.kind === kind) : all;
  }
  count(): number { return this.items.size; }
}
