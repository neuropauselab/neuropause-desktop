/**
 * External enterprise-system adapters. Each is a DESCRIPTOR — an integration interface whose
 * shape is validated but which is NEVER executed (adapter-verified). Real execution against SAP,
 * Stripe, Epic, a MES, a bank rail, or a government tax portal is regulated-external / business-
 * data-pending and is never performed here.
 */
import { randomId } from '@neuropause/cloud-core';
import type { BusinessGovernance } from './governance';
import type { EvidenceLevel } from './types';

export type AdapterCategory = 'erp' | 'accounting' | 'hr-payroll' | 'payments' | 'healthcare' | 'manufacturing' | 'banking-rail' | 'tax-gov';

export interface AdapterDescriptor {
  id: string;
  name: string;
  system: string;
  category: AdapterCategory;
  evidence: EvidenceLevel;
  note: string;
}

/** The standard catalog of external systems this platform can represent (never execute). */
export const ADAPTER_CATALOG: Array<{ system: string; category: AdapterCategory }> = [
  { system: 'SAP', category: 'erp' },
  { system: 'Oracle ERP', category: 'erp' },
  { system: 'Microsoft Dynamics', category: 'erp' },
  { system: 'NetSuite', category: 'erp' },
  { system: 'QuickBooks', category: 'accounting' },
  { system: 'Xero', category: 'accounting' },
  { system: 'Workday', category: 'hr-payroll' },
  { system: 'ADP', category: 'hr-payroll' },
  { system: 'Stripe', category: 'payments' },
  { system: 'PayPal', category: 'payments' },
  { system: 'Razorpay', category: 'payments' },
  { system: 'Plaid', category: 'payments' },
  { system: 'Epic', category: 'healthcare' },
  { system: 'Cerner', category: 'healthcare' },
  { system: 'FHIR', category: 'healthcare' },
  { system: 'HL7', category: 'healthcare' },
  { system: 'MES', category: 'manufacturing' },
  { system: 'SCADA', category: 'manufacturing' },
  { system: 'SWIFT', category: 'banking-rail' },
  { system: 'ACH', category: 'banking-rail' },
  { system: 'UPI', category: 'banking-rail' },
  { system: 'Open Banking', category: 'banking-rail' },
  { system: 'Government Tax Portal', category: 'tax-gov' },
];

export class AdapterRegistry {
  private readonly adapters = new Map<string, AdapterDescriptor>();

  constructor(private readonly governance: BusinessGovernance) {}

  async register(system: string, category: AdapterCategory): Promise<AdapterDescriptor> {
    const adapter: AdapterDescriptor = {
      id: randomId('adapter'),
      name: `${system} adapter`,
      system,
      category,
      evidence: 'adapter-verified',
      note: `${system} integration shape registered — never executed (real ${category} execution is regulated-external / requires real credentials)`,
    };
    this.adapters.set(adapter.id, adapter);
    await this.governance.record({ actor: 'system', domain: 'adapters', operation: `register.${category}`, targetId: adapter.id, evidence: 'adapter-verified', detail: system });
    return adapter;
  }

  /** Load the standard external-system catalog as adapter descriptors. */
  async seed(): Promise<void> {
    for (const entry of ADAPTER_CATALOG) await this.register(entry.system, entry.category);
  }

  get(id: string): AdapterDescriptor | undefined {
    return this.adapters.get(id);
  }
  list(category?: AdapterCategory): AdapterDescriptor[] {
    const all = [...this.adapters.values()];
    return category ? all.filter((a) => a.category === category) : all;
  }
  systems(): string[] {
    return [...this.adapters.values()].map((a) => a.system);
  }
  count(): number {
    return this.adapters.size;
  }
}
