/**
 * Business Analytics. Cross-domain counts over the REAL in-process registries only — plus the
 * reused Wave 5 execution connector count when an execution platform is supplied. Never fabricates
 * a metric; every number is a count of real objects.
 */
import type { ExecutionPlatform } from '@neuropause/execution';
import type { CrmRuntime } from './crm';
import type { SalesRuntime } from './sales';
import type { AccountingRuntime } from './accounting';
import type { HrRuntime } from './hr';
import type { ProcurementRuntime } from './procurement';
import type { ProjectRuntime } from './projects';
import type { AssetRuntime } from './assets';

export interface BusinessAnalyticsDeps {
  crm: CrmRuntime;
  sales: SalesRuntime;
  accounting: AccountingRuntime;
  hr: HrRuntime;
  procurement: ProcurementRuntime;
  projects: ProjectRuntime;
  assets: AssetRuntime;
  execution?: ExecutionPlatform;
}

export class BusinessAnalytics {
  constructor(private readonly deps: BusinessAnalyticsDeps) {}

  overview(): {
    customers: number; opportunities: number; pipelineValue: number; forecast: number;
    invoices: number; employees: number; suppliers: number; projects: number; assets: number;
    reusedConnectors: number; note: string;
  } {
    const crm = this.deps.crm.counts();
    return {
      customers: crm.accounts,
      opportunities: crm.opportunities,
      pipelineValue: this.deps.sales.pipeline().openValue,
      forecast: this.deps.sales.forecast().weighted,
      invoices: this.deps.accounting.count(),
      employees: this.deps.hr.count(),
      suppliers: this.deps.procurement.suppliers().length,
      projects: this.deps.projects.count(),
      assets: this.deps.assets.count(),
      reusedConnectors: this.deps.execution ? this.deps.execution.connectors().count() : 0,
      note: 'counts over real in-process registries only',
    };
  }
}
