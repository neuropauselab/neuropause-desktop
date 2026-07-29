/**
 * Module 13 — Health Monitoring. Platform, tenant, AI-workforce, workspace, business, and
 * infrastructure health — composed ONLY from real data in the reused platforms. REUSES the Wave 12
 * mission control (operational health) for platform health when connected, and the operations,
 * workforce, workplace, business, cloud-ops, and commercial platforms for the rest. Any domain with
 * no real data reads 'No production data available' — no health score is fabricated.
 */
import { NO_PRODUCTION_DATA, type HealthDomain } from './constants';
import type { ProductionContext } from './types';

export interface HealthPanel {
  domain: HealthDomain;
  value: number | string;
  source: string;
}

export class HealthMonitoring {
  constructor(private readonly ctx: ProductionContext = {}) {}

  health(domain: HealthDomain, orgId?: string): HealthPanel {
    switch (domain) {
      case 'platform': {
        if (this.ctx.autonomousOps && orgId) {
          const h = this.ctx.autonomousOps.missionControl().operationalHealth(orgId);
          return { domain, value: h, source: 'reused Wave 12 mission control' };
        }
        if (this.ctx.operations) return { domain, value: this.ctx.operations.health().liveness().status, source: 'reused operations health registry' };
        return { domain, value: NO_PRODUCTION_DATA, source: 'none' };
      }
      case 'tenant': {
        const n = this.ctx.commercial ? this.ctx.commercial.runtime().tenantCount() : 0;
        return { domain, value: n > 0 ? n : NO_PRODUCTION_DATA, source: 'reused commercial runtime' };
      }
      case 'ai-workforce': {
        const n = this.ctx.workforce ? this.ctx.workforce.agents().count() : 0;
        return { domain, value: n > 0 ? n : NO_PRODUCTION_DATA, source: 'reused workforce' };
      }
      case 'workspace': {
        const n = this.ctx.workplace ? this.ctx.workplace.workspaces().count() : 0;
        return { domain, value: n > 0 ? n : NO_PRODUCTION_DATA, source: 'reused workplace' };
      }
      case 'business': {
        const n = this.ctx.business ? this.ctx.business.crm().counts().accounts : 0;
        return { domain, value: n > 0 ? n : NO_PRODUCTION_DATA, source: 'reused business' };
      }
      case 'infrastructure': {
        const n = this.ctx.cloudops ? this.ctx.cloudops.readiness().liveVerified : 0;
        return { domain, value: n > 0 ? n : NO_PRODUCTION_DATA, source: 'reused cloud-ops readiness' };
      }
    }
  }

  overview(orgId?: string): { panels: HealthPanel[]; hasData: boolean } {
    const panels = (['platform', 'tenant', 'ai-workforce', 'workspace', 'business', 'infrastructure'] as HealthDomain[]).map((d) => this.health(d, orgId));
    return { panels, hasData: panels.some((p) => typeof p.value === 'number') };
  }
}
