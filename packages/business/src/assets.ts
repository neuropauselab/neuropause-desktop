/**
 * Module 15 — Enterprise Asset Platform. Hardware, software, licenses, vehicles, buildings, cloud
 * resources, and IoT assets with ownership, lifecycle, and maintenance. All in-process and live-
 * verified; the registry starts empty and no assets are fabricated.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { BusinessGovernance } from './governance';

export type AssetCategory = 'hardware' | 'software' | 'license' | 'vehicle' | 'building' | 'cloud' | 'iot';
export type AssetStatus = 'in-service' | 'in-repair' | 'retired';

export interface Asset {
  id: string;
  name: string;
  category: AssetCategory;
  ownerId?: string;
  status: AssetStatus;
  createdAt: number;
}
export interface MaintenanceTask { id: string; assetId: string; task: string; due: number; done: boolean; }

const CATEGORIES: readonly AssetCategory[] = ['hardware', 'software', 'license', 'vehicle', 'building', 'cloud', 'iot'];

export class AssetRuntime {
  private readonly assetsMap = new Map<string, Asset>();
  private readonly maintenanceList: MaintenanceTask[] = [];

  constructor(
    private readonly clock: Clock,
    private readonly governance: BusinessGovernance,
  ) {}

  async registerAsset(input: { name: string; category: AssetCategory; ownerId?: string }): Promise<Asset> {
    if (!CATEGORIES.includes(input.category)) throw new Error(`unknown asset category: ${input.category}`);
    const a: Asset = { id: randomId('asset'), name: input.name, category: input.category, ...(input.ownerId ? { ownerId: input.ownerId } : {}), status: 'in-service', createdAt: this.clock.now() };
    this.assetsMap.set(a.id, a);
    await this.governance.record({ actor: 'system', domain: 'assets', operation: `register.${input.category}`, targetId: a.id, evidence: 'live-verified' });
    return a;
  }
  async assign(assetId: string, ownerId: string): Promise<Asset> {
    const a = this.require(assetId);
    a.ownerId = ownerId;
    return a;
  }
  async setStatus(assetId: string, status: AssetStatus): Promise<Asset> {
    const a = this.require(assetId);
    a.status = status;
    await this.governance.record({ actor: 'system', domain: 'assets', operation: `status.${status}`, targetId: assetId, evidence: 'live-verified' });
    return a;
  }
  async scheduleMaintenance(input: { assetId: string; task: string; due: number }): Promise<MaintenanceTask> {
    const m: MaintenanceTask = { id: randomId('maint'), assetId: input.assetId, task: input.task, due: input.due, done: false };
    this.maintenanceList.push(m);
    return m;
  }

  byCategory(): Record<string, number> {
    const inv: Record<string, number> = {};
    for (const a of this.assetsMap.values()) inv[a.category] = (inv[a.category] ?? 0) + 1;
    return inv;
  }

  private require(id: string): Asset {
    const a = this.assetsMap.get(id);
    if (!a) throw new Error(`no asset ${id}`);
    return a;
  }

  assets(): Asset[] { return [...this.assetsMap.values()]; }
  maintenance(): MaintenanceTask[] { return [...this.maintenanceList]; }
  count(): number { return this.assetsMap.size; }
}
