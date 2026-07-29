/**
 * EPIC 6 — Customer Operations Platform. A customer registry with health, deployment inventory, license
 * inventory, usage overview, and renewal tracking. Deployment inventory REUSES the Sprint-5 customer-
 * deployment runtime; license inventory REUSES the commercial licensing platform. Usage/renewal figures
 * require real production data and are reported as business-data-pending — never fabricated.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import { NO_RELEASE_DATA } from './constants';
import type { ReleaseContext } from './types';
import type { ReleaseGovernance } from './governance';

export interface CustomerRecord {
  id: string;
  name: string;
  tenantId: string;
  createdAt: number;
}

export class CustomerOperations {
  private readonly customers = new Map<string, CustomerRecord>();

  constructor(
    private readonly clock: Clock,
    private readonly ctx: ReleaseContext,
    private readonly gov: ReleaseGovernance,
    private readonly operator: string,
  ) {}

  async registerCustomer(input: { name: string; tenantId: string }): Promise<CustomerRecord> {
    const record: CustomerRecord = { id: randomId('custop'), name: input.name, tenantId: input.tenantId, createdAt: this.clock.now() };
    this.customers.set(record.id, record);
    await this.gov.record({ operator: this.operator, version: '_ops', environment: '_operations', customerScope: input.name, epic: 'E6', operation: 'register-customer', targetId: record.id, evidence: 'live-verified' });
    return record;
  }

  customerList(): CustomerRecord[] {
    return [...this.customers.values()];
  }

  /** Deployment inventory reuses the Sprint-5 customer-deployment runtime when wired in. */
  deploymentInventory(): { count: number; reusedCustomerDeployment: boolean } {
    if (this.ctx.customerDeployment) {
      return { count: this.ctx.customerDeployment.runtime().listDeployments().length, reusedCustomerDeployment: true };
    }
    return { count: 0, reusedCustomerDeployment: false };
  }

  /** License inventory reuses the commercial licensing platform when wired in. */
  licenseInventory(): { count: number; reusedCommercial: boolean } {
    if (this.ctx.commercial) {
      return { count: this.ctx.commercial.licenses().count(), reusedCommercial: true };
    }
    return { count: 0, reusedCommercial: false };
  }

  /** Usage/renewal require real production data — reported as pending, never fabricated. */
  usageOverview(): { live: boolean; value: string } {
    return { live: false, value: NO_RELEASE_DATA };
  }
  renewalTracking(): { live: boolean; value: string } {
    return { live: false, value: NO_RELEASE_DATA };
  }
}
