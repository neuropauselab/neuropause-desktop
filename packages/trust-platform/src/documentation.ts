/**
 * EPIC 13 — Security Documentation. Generates the enterprise security guide set as structured OUTLINES
 * (title + section headings + capability references) — real, deterministic scaffolding a security team
 * fills in. It does not fabricate audit findings, penetration-test results, or certification language.
 */
import { SECURITY_GUIDES, type SecurityGuide } from './constants';
import type { TrustGovernance } from './governance';

export interface GeneratedGuide {
  guide: SecurityGuide;
  sections: string[];
  generated: true;
}

const SECTIONS: Record<SecurityGuide, string[]> = {
  'Security Architecture Guide': ['Trust boundaries', 'Zero Trust model', 'Data classification', 'Defense in depth', 'Reused platform composition'],
  'Administrator Security Guide': ['Roles & privileged access', 'JIT elevation', 'Break-glass procedure', 'Audit review', 'Policy administration'],
  'Identity Guide': ['Identity lifecycle', 'Federation', 'Service accounts', 'Session trust', 'Continuous verification'],
  'Encryption Guide': ['Envelope encryption', 'Key rotation & versioning', 'Certificate management', 'Secret references', 'External key stores (represented)'],
  'Disaster Recovery Guide': ['Recovery objectives (RTO/RPO)', 'Backup catalog', 'Recovery validation drills', 'Failover (infrastructure-pending)', 'Business continuity'],
  'Incident Response Guide': ['Incident lifecycle', 'Severity classification', 'Response playbooks', 'Forensics & chain of custody', 'Post-incident review'],
  'Secure Deployment Guide': ['Supply-chain provenance', 'SBOM', 'Release verification', 'Runtime & container policy', 'Secrets at deploy time'],
  'Compliance Readiness Guide': ['Control registry', 'Framework mapping (ISO 27001 / SOC 2 / GDPR / HIPAA / NIST CSF)', 'Gap analysis', 'Evidence collection', 'Audit engagement (infrastructure-pending)'],
};

export class SecurityDocumentation {
  constructor(
    private readonly gov: TrustGovernance,
    private readonly operator: string,
  ) {}

  guides(): readonly SecurityGuide[] {
    return SECURITY_GUIDES;
  }

  async generate(guide: SecurityGuide): Promise<GeneratedGuide> {
    const result: GeneratedGuide = { guide, sections: SECTIONS[guide], generated: true };
    await this.gov.record({ actor: this.operator, environment: '_docs', resource: guide, policy: 'security-documentation', epic: 'E13', operation: 'generate-guide', targetId: guide, evidence: 'live-verified', decision: `${result.sections.length} sections` });
    return result;
  }

  async generateAll(): Promise<GeneratedGuide[]> {
    const out: GeneratedGuide[] = [];
    for (const g of SECURITY_GUIDES) out.push(await this.generate(g));
    return out;
  }
}
