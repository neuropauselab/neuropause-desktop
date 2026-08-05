/**
 * EPIC 3 — Government & Public-Sector Deployment Templates. Reusable deployment PROFILE templates for
 * national ministries, state departments, municipal corporations, healthcare authorities, education
 * departments, public utilities, law enforcement, and smart cities. These are TEMPLATES ONLY: each
 * carries <code>deployed:false</code>. No deployment in any real government or public-sector body is ever
 * claimed — the template is a standardized operational model an organization can evaluate and adapt.
 */
import { GOVERNMENT_PROFILES, type GovernmentProfile } from './constants';
import type { DeploymentOrchestratorGovernance } from './governance';

export interface GovernmentTemplate {
  profile: GovernmentProfile;
  environments: string[];
  securityClassification: string;
  governanceModel: string[];
  deployed: false;
  note: string;
}

const PROFILE_SPEC: Record<GovernmentProfile, { classification: string; governance: string[] }> = {
  'National Ministry': { classification: 'restricted / national', governance: ['minister approval', 'national CISO sign-off', 'data-sovereignty review'] },
  'State Department': { classification: 'confidential / state', governance: ['department head approval', 'state audit', 'records retention'] },
  'Municipal Corporation': { classification: 'internal / municipal', governance: ['council approval', 'municipal audit', 'citizen-service SLA'] },
  'Healthcare Authority': { classification: 'restricted / PHI', governance: ['clinical governance', 'privacy impact assessment', 'BAA controls'] },
  'Education Department': { classification: 'confidential / student', governance: ['board approval', 'student-data protection', 'accessibility review'] },
  'Public Utility': { classification: 'confidential / critical-infra', governance: ['regulator approval', 'OT/IT separation', 'continuity plan'] },
  'Law Enforcement': { classification: 'restricted / CJIS-like', governance: ['command approval', 'chain-of-custody controls', 'access audit'] },
  'Smart City': { classification: 'internal / mixed', governance: ['city CTO approval', 'IoT security review', 'open-data policy'] },
};

export class GovernmentTemplates {
  private readonly templates = new Map<GovernmentProfile, GovernmentTemplate>();

  constructor(
    private readonly gov: DeploymentOrchestratorGovernance,
    private readonly operator: string,
  ) {}

  profiles(): readonly GovernmentProfile[] {
    return GOVERNMENT_PROFILES;
  }

  /** Build a reusable deployment profile TEMPLATE — never a real deployment. */
  async buildTemplate(profile: GovernmentProfile): Promise<GovernmentTemplate> {
    const spec = PROFILE_SPEC[profile];
    const template: GovernmentTemplate = {
      profile,
      environments: ['development', 'staging', 'pre-production', 'production-target'],
      securityClassification: spec.classification,
      governanceModel: spec.governance,
      deployed: false,
      note: 'template only — no deployment in any real government or public-sector body is claimed',
    };
    this.templates.set(profile, template);
    await this.gov.record({ operator: this.operator, organization: profile, environment: 'template', version: '1.0.0', epic: 'E3', operation: 'build-government-template', targetId: profile, evidence: 'live-verified', decision: 'template (not deployed)' });
    return template;
  }

  async buildAll(): Promise<GovernmentTemplate[]> {
    const out: GovernmentTemplate[] = [];
    for (const p of GOVERNMENT_PROFILES) out.push(await this.buildTemplate(p));
    return out;
  }

  template(profile: GovernmentProfile): GovernmentTemplate | undefined {
    return this.templates.get(profile);
  }
  templateCount(): number {
    return this.templates.size;
  }
}
