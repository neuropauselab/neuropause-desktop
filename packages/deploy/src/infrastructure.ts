/**
 * EPIC 5 — Infrastructure as Code. Terraform/descriptor templates for AWS, Azure, GCP, DigitalOcean,
 * Hetzner, VMware, and on-prem. REPRESENTS infrastructure — it never claims resources are created.
 * Real clusters and cloud resources are INFRASTRUCTURE-PENDING; provider connections go through the
 * reused adapter registry (adapter-verified until configured).
 */
import { randomId } from '@neuropause/cloud-core';
import type { DeployGovernance } from './governance';
import type { AssetCatalog } from './assets';
import type { InfraAdapterRegistry } from './adapters';
import { CLOUD_PROVIDERS, type CloudProvider } from './constants';

export interface InfraRepresentation {
  id: string;
  provider: CloudProvider;
  templatePath: string | null;
  note: string;
}

export class InfrastructurePlatform {
  private readonly representations = new Map<string, InfraRepresentation>();

  constructor(
    private readonly governance: DeployGovernance,
    private readonly catalog: AssetCatalog,
    private readonly adapters: InfraAdapterRegistry,
  ) {}

  providers(): readonly CloudProvider[] { return CLOUD_PROVIDERS; }
  templates(): string[] { return this.catalog.list('iac-template').map((a) => a.path); }
  adapterRegistry(): InfraAdapterRegistry { return this.adapters; }

  /** Represent a provider's infrastructure — recorded as infrastructure-pending, never created. */
  async represent(provider: CloudProvider, org?: string): Promise<InfraRepresentation> {
    if (!CLOUD_PROVIDERS.includes(provider)) throw new Error(`unknown provider: ${provider}`);
    const template = this.catalog.list('iac-template').find((a) => a.path.startsWith(`iac/${provider}/`));
    const rep: InfraRepresentation = {
      id: randomId('infra'),
      provider,
      templatePath: template ? template.path : null,
      note: 'infrastructure represented via a validated descriptor — no resource is created until the operator runs terraform apply',
    };
    this.representations.set(rep.id, rep);
    await this.governance.record({ operator: 'system', org: org ?? '_ops', environment: '_platform', epic: 'E5', operation: `infra.represent.${provider}`, targetId: rep.id, evidence: 'infrastructure-pending' });
    return rep;
  }

  list(): InfraRepresentation[] { return [...this.representations.values()]; }
  count(): number { return this.representations.size; }
}
