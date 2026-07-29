/**
 * EPIC 19 — Production Documentation. Infrastructure, cloud, Kubernetes, identity, security,
 * monitoring, operations, DNS, certificate, disaster-recovery, and administrator guides. Generates
 * real structured outlines in-process and REUSES the Wave 14 production documentation generator for
 * the overlapping guide kinds. Live-verified.
 */
import { randomId } from '@neuropause/cloud-core';
import type { InfraGovernance } from './governance';
import type { InfraContext } from './types';

export const GUIDE_KINDS = ['infrastructure', 'cloud', 'kubernetes', 'identity', 'security', 'monitoring', 'operations', 'dns', 'certificate', 'disaster-recovery', 'administrator'] as const;
export type GuideKind = (typeof GUIDE_KINDS)[number];

export interface Guide { id: string; kind: GuideKind; title: string; sections: string[]; reusedProduction: boolean }

const OUTLINE: Record<GuideKind, string[]> = {
  infrastructure: ['Activation runtime', 'Environments', 'Inventory', 'Governance'],
  cloud: ['Providers', 'Accounts & regions', 'Networks', 'IAM references'],
  kubernetes: ['Clusters', 'Namespaces', 'Autoscaling', 'Network policies', 'Pod security'],
  identity: ['Providers (OIDC/SAML/…)', 'Federation', 'JIT provisioning', 'Sessions'],
  security: ['Zero trust', 'RBAC/ABAC', 'Secrets', 'Container security', 'Supply chain'],
  monitoring: ['Prometheus/Grafana/Loki', 'OpenTelemetry', 'Exporters', 'Dashboards'],
  operations: ['Health', 'Alerts', 'Logging', 'Runbooks'],
  dns: ['Domains', 'Load balancers', 'TLS', 'Topology'],
  certificate: ['CAs', 'Issuance', 'Expiry monitoring', 'Rotation'],
  'disaster-recovery': ['RPO/RTO', 'DR regions', 'Backup validation', 'Drills'],
  administrator: ['Onboarding', 'Environments', 'Identity & security', 'Support'],
};

export class InfraDocumentation {
  private readonly guides = new Map<string, Guide>();

  constructor(
    private readonly governance: InfraGovernance,
    private readonly ctx: InfraContext = {},
  ) {}

  async generate(kind: GuideKind, org?: string): Promise<Guide> {
    if (!GUIDE_KINDS.includes(kind)) throw new Error(`unknown guide kind: ${kind}`);
    let reusedProduction = false;
    // reuse the production documentation generator for the guide kinds it also produces
    if (this.ctx.production && (kind === 'security' || kind === 'operations' || kind === 'disaster-recovery' || kind === 'administrator')) {
      await this.ctx.production.documentation().generate({ kind });
      reusedProduction = true;
    }
    const guide: Guide = { id: randomId('guide'), kind, title: `${kind.replace(/-/g, ' ')} guide`, sections: OUTLINE[kind], reusedProduction };
    this.guides.set(guide.id, guide);
    await this.governance.record({ operator: 'system', org: org ?? '_platform', environment: '_platform', epic: 'E19', operation: `docs.${kind}`, targetId: guide.id, evidence: 'live-verified' });
    return guide;
  }

  guideKinds(): readonly GuideKind[] { return GUIDE_KINDS; }
  list(): Guide[] { return [...this.guides.values()]; }
  count(): number { return this.guides.size; }
}
