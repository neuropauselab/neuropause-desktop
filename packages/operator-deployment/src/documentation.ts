/**
 * Build item 8 — Documentation. Generates the operator guide set (Operator Deployment Guide, Production
 * Checklist, Troubleshooting Guide, Rollback Guide, Validation Guide, Evidence Guide) as structured
 * outlines an operator fills in. It does not fabricate deployment results.
 */
import { DOC_GUIDES, type DocGuide } from './constants';
import type { OperatorDeploymentGovernance } from './governance';

export interface GeneratedGuide {
  guide: DocGuide;
  sections: string[];
  generated: true;
}

const SECTIONS: Record<DocGuide, string[]> = {
  'Operator Deployment Guide': ['Prerequisites', 'Wizard configuration', 'Environment validation', 'Approval', 'Execute (apply)', 'Live validation', 'Evidence collection'],
  'Production Checklist': ['Credentials verified', 'Cluster reachable', 'DNS + TLS ready', 'Registry + storage reachable', 'Approval recorded', 'Rollback plan ready'],
  'Troubleshooting Guide': ['Rollout stuck', 'Failed pods / CrashLoopBackOff', 'Image pull errors', 'Migration failures', 'TLS not issued', 'DNS not resolving'],
  'Rollback Guide': ['Triggers', 'helm rollback / kubectl rollout undo', 'Database restore (never delete)', 'DNS revert', 'Verify after rollback'],
  'Validation Guide': ['kubectl rollout status', 'API health', 'DB + Redis health', 'TLS chain', 'Monitoring targets up', 'Logging query'],
  'Evidence Guide': ['Terraform output', 'Rollout logs', 'Pod status', 'Certificate fingerprints', 'Backup verification', 'Promotion (human decision)'],
};

export class OperatorDocumentation {
  constructor(
    private readonly gov: OperatorDeploymentGovernance,
    private readonly operator: string,
  ) {}

  guides(): readonly DocGuide[] {
    return DOC_GUIDES;
  }

  async generate(guide: DocGuide): Promise<GeneratedGuide> {
    const result: GeneratedGuide = { guide, sections: SECTIONS[guide], generated: true };
    await this.gov.record({ operator: this.operator, environment: 'production', target: 'docs', operation: 'generate-guide', result: guide, evidence: 'live-verified' });
    return result;
  }

  async generateAll(): Promise<GeneratedGuide[]> {
    const out: GeneratedGuide[] = [];
    for (const g of DOC_GUIDES) out.push(await this.generate(g));
    return out;
  }
}
