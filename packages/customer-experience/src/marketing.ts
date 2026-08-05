/**
 * EPIC 12 — Marketing Assets. Registries for product screenshots, demo videos, release notes, feature
 * highlights, and product comparisons. Assets are REPRESENTED (registered with metadata) until they are
 * actually produced + published; a registry entry is never claimed as a published asset.
 */
import { randomId } from '@neuropause/cloud-core';
import { MARKETING_ASSETS, type MarketingAsset } from './constants';
import type { CustomerExperienceGovernance } from './governance';

export interface AssetRecord {
  id: string;
  kind: MarketingAsset;
  name: string;
  published: false; // represented until produced + published
}

export class MarketingAssets {
  private readonly assets = new Map<string, AssetRecord>();

  constructor(
    private readonly gov: CustomerExperienceGovernance,
    private readonly operator: string,
  ) {}

  kinds(): readonly MarketingAsset[] {
    return MARKETING_ASSETS;
  }

  async register(input: { kind: MarketingAsset; name: string }): Promise<AssetRecord> {
    if (!MARKETING_ASSETS.includes(input.kind)) throw new Error(`unknown asset kind: ${input.kind}`);
    const record: AssetRecord = { id: randomId('asset'), kind: input.kind, name: input.name, published: false };
    this.assets.set(record.id, record);
    await this.gov.record({ actor: this.operator, customer: '_marketing', organization: '_cx', epic: 'E12', operation: `register.${input.kind}`, targetId: input.name, evidence: 'live-verified', decision: 'represented (not published)' });
    return record;
  }

  list(kind?: MarketingAsset): AssetRecord[] {
    const all = [...this.assets.values()];
    return kind ? all.filter((a) => a.kind === kind) : all;
  }
}
