/**
 * Module 19 — Executive Intelligence. CEO / COO / CFO / CRO / CHRO / CIO / CTO / Board dashboards
 * composed ONLY from real runtime objects. Any panel whose domain has no data shows
 * 'No business data available' — KPIs are never fabricated.
 */
import { NO_BUSINESS_DATA, type ExecutiveRole } from './constants';
import { businessReadiness, type BusinessReadiness } from './evidence';
import type { CrmRuntime } from './crm';
import type { SalesRuntime } from './sales';
import type { AccountingRuntime } from './accounting';
import type { HrRuntime } from './hr';
import type { ProcurementRuntime } from './procurement';
import type { ProjectRuntime } from './projects';
import type { AssetRuntime } from './assets';
import type { ComplianceRuntime } from './compliance';

export interface ExecutiveDashboard {
  role: ExecutiveRole;
  panels: Record<string, number | string>;
  readiness: BusinessReadiness;
  note: string;
}

export interface ExecutiveDeps {
  crm: CrmRuntime;
  sales: SalesRuntime;
  accounting: AccountingRuntime;
  hr: HrRuntime;
  procurement: ProcurementRuntime;
  projects: ProjectRuntime;
  assets: AssetRuntime;
  compliance: ComplianceRuntime;
}

/** The core honesty helper: a real value when the domain has data, else 'No business data available'. */
const orNoData = (count: number, value: number): number | string => (count > 0 ? value : NO_BUSINESS_DATA);

export class ExecutiveDashboards {
  constructor(private readonly deps: ExecutiveDeps) {}

  build(role: ExecutiveRole): ExecutiveDashboard {
    const crm = this.deps.crm.counts();
    const fin = this.deps.accounting.financialStatements();
    const pipeline = this.deps.sales.pipeline();
    const panels: Record<string, number | string> = {};
    switch (role) {
      case 'CEO':
        panels['customers'] = orNoData(crm.accounts, crm.accounts);
        panels['pipeline'] = orNoData(pipeline.count, pipeline.openValue);
        panels['headcount'] = orNoData(this.deps.hr.count(), this.deps.hr.count());
        panels['projects'] = orNoData(this.deps.projects.count(), this.deps.projects.count());
        break;
      case 'COO':
        panels['suppliers'] = orNoData(this.deps.procurement.suppliers().length, this.deps.procurement.suppliers().length);
        panels['purchaseOrders'] = orNoData(this.deps.procurement.count(), this.deps.procurement.count());
        panels['assets'] = orNoData(this.deps.assets.count(), this.deps.assets.count());
        break;
      case 'CFO':
        panels['netIncome'] = fin.hasData ? fin.netIncome : NO_BUSINESS_DATA;
        panels['receivables'] = orNoData(this.deps.accounting.count(), this.deps.accounting.receivablesOutstanding());
        panels['payables'] = orNoData(this.deps.accounting.count(), this.deps.accounting.payablesOutstanding());
        break;
      case 'CRO': {
        panels['pipeline'] = orNoData(pipeline.count, pipeline.openValue);
        panels['forecast'] = orNoData(pipeline.count, this.deps.sales.forecast().weighted);
        const wl = this.deps.sales.winLoss();
        panels['winRate'] = wl.winRate ?? NO_BUSINESS_DATA;
        break;
      }
      case 'CHRO':
        panels['headcount'] = orNoData(this.deps.hr.count(), this.deps.hr.count());
        panels['openRequisitions'] = orNoData(this.deps.hr.requisitions().length, this.deps.hr.requisitions().length);
        break;
      case 'CIO':
      case 'CTO':
        panels['assets'] = orNoData(this.deps.assets.count(), this.deps.assets.count());
        panels['projects'] = orNoData(this.deps.projects.count(), this.deps.projects.count());
        break;
      case 'Board':
        panels['customers'] = orNoData(crm.accounts, crm.accounts);
        panels['netIncome'] = fin.hasData ? fin.netIncome : NO_BUSINESS_DATA;
        panels['complianceFrameworks'] = orNoData(this.deps.compliance.count(), this.deps.compliance.count());
        break;
    }
    return { role, panels, readiness: businessReadiness(), note: 'panels reflect real in-process objects only; empty domains show "No business data available"' };
  }
}
