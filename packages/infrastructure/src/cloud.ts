/**
 * EPIC 3 — Cloud Platform Activation. Cloud/account/region registries, availability zones, virtual
 * networks, subnets, IAM references, and service/infrastructure inventory for AWS, Azure, GCP,
 * DigitalOcean, Hetzner, VMware, on-prem, and hybrid. Infrastructure is REPRESENTED until
 * provisioned — accounts and networks are descriptors, not created resources. REUSES the cloud-ops
 * cloud registry (read) and the provider adapter registry.
 */
import { randomId } from '@neuropause/cloud-core';
import type { InfraGovernance } from './governance';
import type { InfraContext } from './types';
import type { ProviderAdapterRegistry } from './adapters';
import { CLOUD_PROVIDERS, type CloudProvider } from './constants';

export interface CloudAccount {
  id: string;
  provider: CloudProvider;
  name: string;
  regions: string[];
  availabilityZones: string[];
  vnets: string[];
  subnets: string[];
  iamRefs: string[];
  reusedCloudOps: boolean;
  note: string;
}

export class CloudPlatformActivation {
  private readonly accounts = new Map<string, CloudAccount>();

  constructor(
    private readonly governance: InfraGovernance,
    private readonly ctx: InfraContext,
    private readonly adapters: ProviderAdapterRegistry,
  ) {}

  async registerAccount(input: { provider: CloudProvider; name: string; org?: string }): Promise<CloudAccount> {
    if (!CLOUD_PROVIDERS.includes(input.provider)) throw new Error(`unknown provider: ${input.provider}`);
    const acct: CloudAccount = {
      id: randomId('cloud'),
      provider: input.provider,
      name: input.name,
      regions: [],
      availabilityZones: [],
      vnets: [],
      subnets: [],
      iamRefs: [],
      reusedCloudOps: !!this.ctx.cloudops,
      note: 'cloud account represented — no resource is provisioned until the operator applies IaC',
    };
    this.accounts.set(acct.id, acct);
    await this.governance.record({ operator: 'system', org: input.org ?? '_ops', environment: '_platform', epic: 'E3', operation: `cloud.account.${input.provider}`, targetId: acct.id, evidence: 'adapter-verified' });
    return acct;
  }

  addRegion(accountId: string, region: string, zones: string[] = []): CloudAccount {
    const acct = this.require(accountId);
    acct.regions.push(region);
    acct.availabilityZones.push(...zones);
    return acct;
  }
  addNetwork(accountId: string, vnet: string, subnets: string[] = []): CloudAccount {
    const acct = this.require(accountId);
    acct.vnets.push(vnet);
    acct.subnets.push(...subnets);
    return acct;
  }
  addIamRef(accountId: string, ref: string): CloudAccount {
    const acct = this.require(accountId);
    acct.iamRefs.push(ref);
    return acct;
  }

  /** Real cloud provider inventory from the reused cloud-ops registry, plus represented adapters. */
  inventory(): { representedAccounts: number; cloudOpsProviders: number; adapterProviders: string[] } {
    return {
      representedAccounts: this.accounts.size,
      cloudOpsProviders: this.ctx.cloudops ? this.ctx.cloudops.cloud().providers().length : 0,
      adapterProviders: this.adapters.list('cloud').map((a) => a.system),
    };
  }

  private require(id: string): CloudAccount {
    const a = this.accounts.get(id);
    if (!a) throw new Error(`no cloud account ${id}`);
    return a;
  }

  get(id: string): CloudAccount | undefined { return this.accounts.get(id); }
  list(): CloudAccount[] { return [...this.accounts.values()]; }
  count(): number { return this.accounts.size; }
}
