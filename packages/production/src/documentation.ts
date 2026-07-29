/**
 * Module 17 — Enterprise Documentation. Generates administrator, user, API, SDK, deployment,
 * disaster-recovery, security, and operations guides as structured outlines. The generated content
 * (title + section outline) is real; it is a documentation scaffold, not a claim of coverage.
 * In-process — live-verified; starts empty.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { ProductionGovernance } from './governance';
import { DOC_KINDS, type DocKind } from './constants';

export interface GuideDoc {
  id: string;
  kind: DocKind;
  title: string;
  sections: string[];
  version: string;
  at: number;
}

const outline = (kind: DocKind): { title: string; sections: string[] } => {
  const map: Record<DocKind, { title: string; sections: string[] }> = {
    administrator: { title: 'Administrator Guide', sections: ['Provisioning', 'Tenant administration', 'Roles & security', 'Backups', 'Upgrades'] },
    user: { title: 'User Guide', sections: ['Getting started', 'Workspaces', 'AI workers', 'Everyday tasks'] },
    api: { title: 'API Guide', sections: ['Authentication', 'Resources', 'Pagination', 'Errors', 'Webhooks'] },
    sdk: { title: 'SDK Guide', sections: ['Installation', 'Extensions', 'Providers', 'Testing'] },
    deployment: { title: 'Deployment Guide', sections: ['Topologies', 'Kubernetes', 'Cloud & on-prem', 'Hybrid', 'Validation'] },
    'disaster-recovery': { title: 'Disaster Recovery Guide', sections: ['RPO/RTO', 'DR regions', 'Failover', 'Drills', 'Reports'] },
    security: { title: 'Security Guide', sections: ['Hardening', 'Secret rotation', 'Certificates', 'Sessions', 'Audits'] },
    operations: { title: 'Operations Manual', sections: ['Monitoring', 'Alerts', 'Incidents', 'Runbooks', 'Health checks'] },
  };
  return map[kind];
};

export class EnterpriseDocumentation {
  private readonly docs = new Map<string, GuideDoc>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: ProductionGovernance,
  ) {}

  async generate(input: { kind: DocKind; version?: string; org?: string }): Promise<GuideDoc> {
    if (!DOC_KINDS.includes(input.kind)) throw new Error(`unknown documentation kind: ${input.kind}`);
    const o = outline(input.kind);
    const doc: GuideDoc = { id: randomId('doc'), kind: input.kind, title: o.title, sections: o.sections, version: input.version ?? '0.0.0-preview.1', at: this.clock.now() };
    this.docs.set(doc.id, doc);
    await this.governance.record({ operator: 'system', org: input.org ?? '_platform', environment: '_platform', operation: `docs.${input.kind}`, targetId: doc.id, evidence: 'live-verified' });
    return doc;
  }

  get(id: string): GuideDoc | undefined { return this.docs.get(id); }
  list(kind?: DocKind): GuideDoc[] {
    const all = [...this.docs.values()];
    return kind ? all.filter((d) => d.kind === kind) : all;
  }
  count(): number { return this.docs.size; }
}
