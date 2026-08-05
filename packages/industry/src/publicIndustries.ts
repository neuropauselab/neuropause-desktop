/**
 * Public-sector & connected-services verticals (Industries 10, 11, 15). Compose on Wave 8 crm /
 * projects / hr / accounting / assets — no core logic duplicated. Government approvals and permit
 * issuance are regulated-external.
 */
import type { IndustrySolution } from './types';

export function defineGovernment(): IndustrySolution {
  return {
    key: 'government',
    name: 'Government (Citizen Services / Permits / Cases / Benefits / Public Projects)',
    reusesDomains: ['crm', 'projects', 'accounting', 'compliance', 'ai', 'automation'],
    objects: [
      { name: 'Case', fields: [{ name: 'citizenId', type: 'reference' }, { name: 'type', type: 'text' }], reusesDomain: 'projects' },
      { name: 'PermitApplication', fields: [{ name: 'citizenId', type: 'reference' }, { name: 'status', type: 'text' }], reusesDomain: 'compliance' },
    ],
    workflows: [{ name: 'PermitProcessing', steps: ['submit', 'review', 'decision'], requiresApproval: true }],
    kpis: [
      { name: 'citizens', unit: 'count', compute: (c) => c.business?.crm().counts().accounts ?? 0 },
      { name: 'cases', unit: 'count', compute: (c) => c.business?.projects().count() ?? 0 },
    ],
    compliancePacks: [{ pack: 'gdpr' }, { pack: 'soc2' }],
    connectors: [{ system: 'Oracle', category: 'erp' }],
    aiSkills: [{ name: 'CaseCopilot', description: 'assist case handling from real records' }, { name: 'BenefitsAssistant', description: 'assist benefits eligibility (issuance is regulated-external)' }],
    documentTemplates: [{ name: 'Permit', format: 'pdf', sections: ['applicant', 'decision', 'conditions'] }],
  };
}

export function defineEducation(): IndustrySolution {
  return {
    key: 'education',
    name: 'Education (Students / Faculty / Admissions / Learning / Exams / Certificates)',
    reusesDomains: ['crm', 'hr', 'projects', 'accounting', 'ai', 'automation'],
    objects: [
      { name: 'Student', fields: [{ name: 'name', type: 'text' }, { name: 'program', type: 'text' }], reusesDomain: 'crm' },
      { name: 'Course', fields: [{ name: 'title', type: 'text' }, { name: 'credits', type: 'number' }], reusesDomain: 'projects' },
    ],
    workflows: [{ name: 'Admissions', steps: ['apply', 'review', 'offer', 'enroll'], requiresApproval: true }],
    kpis: [
      { name: 'students', unit: 'count', compute: (c) => c.business?.crm().counts().accounts ?? 0 },
      { name: 'faculty', unit: 'count', compute: (c) => c.business?.hr().count() ?? 0 },
    ],
    compliancePacks: [{ pack: 'gdpr' }],
    connectors: [{ system: 'Workday', category: 'hr-payroll' }, { system: 'Salesforce', category: 'crm' }],
    aiSkills: [{ name: 'AdmissionsCopilot', description: 'assist admissions review' }, { name: 'CurriculumAssistant', description: 'assist curriculum planning' }],
    documentTemplates: [{ name: 'Transcript', format: 'pdf', sections: ['student', 'courses', 'grades'] }],
  };
}

export function defineTelecom(): IndustrySolution {
  return {
    key: 'telecom',
    name: 'Telecommunications (Subscribers / Billing / Network Assets / Tickets / Service Orders)',
    reusesDomains: ['crm', 'accounting', 'assets', 'projects', 'automation'],
    objects: [
      { name: 'Subscriber', fields: [{ name: 'msisdn', type: 'text' }, { name: 'plan', type: 'text' }], reusesDomain: 'crm' },
      { name: 'NetworkAsset', fields: [{ name: 'type', type: 'text' }, { name: 'site', type: 'text' }], reusesDomain: 'assets' },
    ],
    workflows: [{ name: 'ServiceOrder', steps: ['order', 'provision', 'activate'], requiresApproval: false }],
    kpis: [
      { name: 'subscribers', unit: 'count', compute: (c) => c.business?.crm().counts().accounts ?? 0 },
      { name: 'networkAssets', unit: 'count', compute: (c) => c.business?.assets().count() ?? 0 },
    ],
    compliancePacks: [{ pack: 'gdpr' }, { pack: 'soc2' }],
    connectors: [{ system: 'SAP', category: 'erp' }, { system: 'Salesforce', category: 'crm' }],
    aiSkills: [{ name: 'TicketCopilot', description: 'assist ticket triage from real records' }, { name: 'BillingAssistant', description: 'assist billing queries' }],
    documentTemplates: [{ name: 'ServiceContract', format: 'pdf', sections: ['subscriber', 'plan', 'terms'] }],
  };
}
