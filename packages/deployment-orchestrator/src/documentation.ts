/**
 * EPIC 12 — Launch Documentation. Generates the deployment & launch guide set as structured OUTLINES
 * (title + section headings) — real, deterministic scaffolding a launch team fills in. It does not
 * fabricate customer case studies, testimonials, or deployment results.
 */
import { LAUNCH_GUIDES, type LaunchGuide } from './constants';
import type { DeploymentOrchestratorGovernance } from './governance';

export interface GeneratedGuide {
  guide: LaunchGuide;
  sections: string[];
  generated: true;
}

const SECTIONS: Record<LaunchGuide, string[]> = {
  'Enterprise Deployment Guide': ['Prerequisites', 'Environment setup', 'Rollout waves', 'Validation', 'Rollback'],
  'Government Deployment Guide': ['Classification & governance', 'Approval workflow', 'Data sovereignty', 'Operational model', 'Continuity'],
  'Public Sector Guide': ['Procurement model', 'Accessibility', 'Records retention', 'Citizen services', 'Audit'],
  'Partner Guide': ['Partner tiers', 'Enablement', 'Co-selling model', 'Marketplace listing (represented)', 'Support'],
  'Customer Success Guide': ['Onboarding', 'Adoption playbooks', 'Health scoring', 'EBRs', 'Renewals & expansion'],
  'Operations Handbook': ['Launch operations center', 'Runbooks', 'Escalation', 'Monitoring', 'Change management'],
  'Hypercare Handbook': ['Hypercare window', 'Severity handling', 'Daily standups', 'Exit criteria', 'Handover'],
  'Launch Playbook': ['GA go/no-go', 'Pilot to GA', 'Rollout waves', 'Communications', 'Readiness scoring'],
};

export class LaunchDocumentation {
  constructor(
    private readonly gov: DeploymentOrchestratorGovernance,
    private readonly operator: string,
  ) {}

  guides(): readonly LaunchGuide[] {
    return LAUNCH_GUIDES;
  }

  async generate(guide: LaunchGuide): Promise<GeneratedGuide> {
    const result: GeneratedGuide = { guide, sections: SECTIONS[guide], generated: true };
    await this.gov.record({ operator: this.operator, organization: '_docs', environment: 'docs', version: '1.0.0', epic: 'E12', operation: 'generate-guide', targetId: guide, evidence: 'live-verified', decision: `${result.sections.length} sections` });
    return result;
  }

  async generateAll(): Promise<GeneratedGuide[]> {
    const out: GeneratedGuide[] = [];
    for (const g of LAUNCH_GUIDES) out.push(await this.generate(g));
    return out;
  }
}
