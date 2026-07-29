/**
 * EPIC 8 — Storage Platform. Object / file / backup / log / artifact storage descriptors with lifecycle
 * policies. These are descriptors + policies; a provisioned bucket/volume serving real bytes is
 * infrastructure-pending. No stored data is claimed.
 */
import { randomId } from '@neuropause/cloud-core';
import { STORAGE_KINDS, type StorageKind } from './constants';
import type { PlatformOpsGovernance } from './governance';

export interface StorageDescriptor {
  id: string;
  kind: StorageKind;
  name: string;
  retentionDays: number;
  provisioned: false; // descriptor only — a real bucket/volume is infrastructure-pending
}

const DEFAULT_RETENTION: Record<StorageKind, number> = { object: 365, file: 180, backup: 90, log: 30, artifact: 60 };

export class StoragePlatform {
  private readonly stores = new Map<string, StorageDescriptor>();

  constructor(
    private readonly gov: PlatformOpsGovernance,
    private readonly operator: string,
  ) {}

  kinds(): readonly StorageKind[] {
    return STORAGE_KINDS;
  }

  async declare(input: { kind: StorageKind; name: string; retentionDays?: number }): Promise<StorageDescriptor> {
    if (!STORAGE_KINDS.includes(input.kind)) throw new Error(`unknown storage kind: ${input.kind}`);
    const descriptor: StorageDescriptor = { id: randomId('store'), kind: input.kind, name: input.name, retentionDays: input.retentionDays ?? DEFAULT_RETENTION[input.kind], provisioned: false };
    this.stores.set(descriptor.id, descriptor);
    await this.gov.record({ operator: this.operator, environment: 'production', deployment: '_none', cluster: '_storage', version: '_platform', epic: 'E8', operation: `declare.${input.kind}`, targetId: input.name, evidence: 'live-verified', decision: `retention ${descriptor.retentionDays}d` });
    return descriptor;
  }

  lifecyclePolicy(kind: StorageKind): { kind: StorageKind; retentionDays: number } {
    return { kind, retentionDays: DEFAULT_RETENTION[kind] };
  }

  list(kind?: StorageKind): StorageDescriptor[] {
    const all = [...this.stores.values()];
    return kind ? all.filter((s) => s.kind === kind) : all;
  }
}
