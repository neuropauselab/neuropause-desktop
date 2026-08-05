/**
 * Module 1 — Cloud Registry. Registers cloud provider DESCRIPTORS (Kubernetes / AWS / Azure /
 * GCP / on-prem) and inventories them. A descriptor is a labelled target — an account/
 * subscription/project reference — never a live connection. Real accounts are infra-pending.
 */
import { randomId } from '@neuropause/cloud-core';
import type { CloudOpsGovernance } from './governance';
import type { CloudDescriptor } from './types';
import { CLOUD_PROVIDERS, type CloudProvider } from './constants';

export interface RegisterCloudInput {
  provider: CloudProvider;
  name: string;
  reference?: string;
  metadata?: Record<string, unknown>;
}

const CONNECTABLE: readonly CloudProvider[] = ['kubernetes', 'aws', 'azure', 'gcp'];

export class CloudRegistry {
  private readonly clouds = new Map<string, CloudDescriptor>();

  constructor(private readonly governance: CloudOpsGovernance) {}

  async register(input: RegisterCloudInput): Promise<CloudDescriptor> {
    if (!CLOUD_PROVIDERS.includes(input.provider)) throw new Error(`unknown cloud provider: ${input.provider}`);
    const connectable = CONNECTABLE.includes(input.provider);
    const cloud: CloudDescriptor = {
      id: randomId('cloud'),
      provider: input.provider,
      name: input.name,
      reference: input.reference ?? `${input.provider}-ref`,
      metadata: input.metadata ?? {},
      evidence: 'adapter-verified',
      note: connectable
        ? `${input.provider} provider descriptor registered — no account connected; real connection is INFRA-PENDING`
        : `${input.provider} descriptor registered — inventory metadata only`,
    };
    this.clouds.set(cloud.id, cloud);
    await this.governance.record({ actor: 'system', operation: `cloud.register.${input.provider}`, targetId: cloud.id, evidence: 'adapter-verified', detail: cloud.note });
    return cloud;
  }

  get(id: string): CloudDescriptor | undefined {
    return this.clouds.get(id);
  }
  list(provider?: CloudProvider): CloudDescriptor[] {
    const all = [...this.clouds.values()];
    return provider ? all.filter((c) => c.provider === provider) : all;
  }
  providers(): CloudProvider[] {
    return [...new Set([...this.clouds.values()].map((c) => c.provider))];
  }
  inventory(): Record<string, number> {
    const inv: Record<string, number> = {};
    for (const c of this.clouds.values()) inv[c.provider] = (inv[c.provider] ?? 0) + 1;
    return inv;
  }
  count(): number {
    return this.clouds.size;
  }
}
