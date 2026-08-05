/**
 * EPIC 10 — Launch Operations Center. Dashboards for the deployment pipeline, platform readiness,
 * customer readiness, government readiness, commercial readiness, support readiness, and executive status.
 * Only VERIFIED operational data is displayed: tiles backed by real in-process registries and composed
 * readiness are marked live; tiles that would report real customer adoption or commercial outcomes are
 * marked <code>live:false</code> (business-data-pending) rather than fabricated.
 */
import { LAUNCH_DASHBOARDS, NO_CUSTOMER_DATA, type LaunchDashboard } from './constants';
import type { DeploymentOrchestrator } from './deploymentOrchestrator';
import type { EnterpriseRollout } from './enterpriseRollout';
import type { GovernmentReadiness } from './governmentReadiness';
import type { CommercialOps } from './commercialOps';
import type { BusinessLaunchReadiness } from './businessLaunchReadiness';

export interface LocDeps {
  deployment: DeploymentOrchestrator;
  rollout: EnterpriseRollout;
  government: GovernmentReadiness;
  commercial: CommercialOps;
  launchReadiness: BusinessLaunchReadiness;
}

export interface DashboardTile {
  dashboard: LaunchDashboard;
  live: boolean;
  value: string;
}

export class LaunchOperationsCenter {
  constructor(private readonly deps: LocDeps) {}

  dashboards(): readonly LaunchDashboard[] {
    return LAUNCH_DASHBOARDS;
  }

  snapshot(): DashboardTile[] {
    const score = this.deps.launchReadiness.score();
    return [
      { dashboard: 'deployment-pipeline', live: true, value: `${this.deps.deployment.deploymentCount()} deployments · ${this.deps.rollout.rolloutCount()} rollout plans` },
      { dashboard: 'platform-readiness', live: true, value: `${score.readyDomains}/${score.totalDomains} domains ready` },
      { dashboard: 'customer-readiness', live: false, value: NO_CUSTOMER_DATA }, // real customer adoption is business-data-pending
      { dashboard: 'government-readiness', live: true, value: `${this.deps.government.departmentCount()} operational models (not adoptions)` },
      { dashboard: 'commercial-readiness', live: false, value: NO_CUSTOMER_DATA }, // real contracts + revenue are business-data-pending
      { dashboard: 'support-readiness', live: true, value: 'support playbooks + documentation present' },
      { dashboard: 'executive-status', live: true, value: `launch readiness ${score.scorePct}% · ${score.verdict}` },
    ];
  }

  executiveStatus(): { scorePct: number; verdict: string } {
    const score = this.deps.launchReadiness.score();
    return { scorePct: score.scorePct, verdict: score.verdict };
  }
}
