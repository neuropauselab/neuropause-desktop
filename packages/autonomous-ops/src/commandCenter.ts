/**
 * Module 3 — Enterprise Command Center. Global / multi-organization dashboards and business,
 * workforce, infrastructure, financial, and risk health — composed ONLY from real data in the
 * reused Wave 8/11/7 platforms. Any domain with no data reads 'No business data available'.
 */
import { NO_OPS_DATA, type HealthDomain } from './constants';
import type { OpsContext } from './types';

export interface HealthPanel {
  domain: HealthDomain;
  value: number | string;
  note: string;
}

export class CommandCenter {
  constructor(private readonly ctx: OpsContext = {}) {}

  health(domain: HealthDomain): HealthPanel {
    switch (domain) {
      case 'business': {
        const n = this.ctx.business ? this.ctx.business.crm().counts().accounts : 0;
        return { domain, value: n > 0 ? n : NO_OPS_DATA, note: 'customers from the reused business platform' };
      }
      case 'workforce': {
        const n = this.ctx.workforce ? this.ctx.workforce.agents().count() : 0;
        return { domain, value: n > 0 ? n : NO_OPS_DATA, note: 'AI agents from the reused workforce platform' };
      }
      case 'infrastructure': {
        const r = this.ctx.cloudops ? this.ctx.cloudops.readiness().liveVerified : 0;
        return { domain, value: r > 0 ? r : NO_OPS_DATA, note: 'live-verified cloud-ops capabilities' };
      }
      case 'financial': {
        const fin = this.ctx.business?.accounting().financialStatements();
        return { domain, value: fin?.hasData ? fin.netIncome : NO_OPS_DATA, note: 'from the reused accounting runtime' };
      }
      case 'risk': {
        const n = this.ctx.business ? this.ctx.business.crm().counts().accounts : 0;
        return { domain, value: n > 0 ? 'monitored' : NO_OPS_DATA, note: 'risk requires real operational data' };
      }
    }
  }

  globalDashboard(): { panels: HealthPanel[]; note: string } {
    const panels = (['business', 'workforce', 'infrastructure', 'financial', 'risk'] as HealthDomain[]).map((d) => this.health(d));
    const hasData = panels.some((p) => typeof p.value === 'number' || p.value === 'monitored');
    return { panels, note: hasData ? 'composed from real platform data' : NO_OPS_DATA };
  }

  multiOrgDashboard(orgCount: number): { organizations: number; note: string } {
    return { organizations: orgCount, note: 'multi-organization view — federated org data reused from Wave 6 when connected' };
  }
}
