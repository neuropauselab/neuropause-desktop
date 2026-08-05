/**
 * Financial-services verticals (Industries 5-6). Compose on Wave 8 banking / crm / accounting /
 * compliance — no core logic duplicated. AML/KYC and settlement remain regulated-external.
 */
import type { IndustrySolution } from './types';

export function defineBanking(): IndustrySolution {
  return {
    key: 'banking',
    name: 'Banking & Financial Services (Lending / Deposits / Treasury / AML / KYC)',
    reusesDomains: ['banking', 'crm', 'accounting', 'compliance', 'ai', 'automation'],
    objects: [
      { name: 'LoanApplication', fields: [{ name: 'customerId', type: 'reference' }, { name: 'amount', type: 'number' }], reusesDomain: 'banking' },
      { name: 'KycCase', fields: [{ name: 'customerId', type: 'reference' }, { name: 'status', type: 'text' }], reusesDomain: 'compliance' },
    ],
    workflows: [{ name: 'LoanOrigination', steps: ['apply', 'kyc', 'underwrite', 'approve'], requiresApproval: true }],
    kpis: [
      { name: 'customers', unit: 'count', compute: (c) => c.business?.crm().counts().accounts ?? 0 },
      { name: 'bankAccounts', unit: 'count', compute: (c) => c.business?.banking().count() ?? 0 },
    ],
    compliancePacks: [{ pack: 'soc2' }, { pack: 'pci-dss' }, { pack: 'gdpr' }],
    connectors: [{ system: 'SAP', category: 'erp' }, { system: 'Stripe', category: 'payments' }],
    aiSkills: [{ name: 'Customer360', description: 'assemble a customer 360 from real records' }, { name: 'AmlAssistant', description: 'assist AML review (screening is regulated-external)' }],
    documentTemplates: [{ name: 'LoanAgreement', format: 'pdf', sections: ['parties', 'terms', 'schedule'] }],
  };
}

export function defineInsurance(): IndustrySolution {
  return {
    key: 'insurance',
    name: 'Insurance (Policies / Claims / Underwriting / Broker Network)',
    reusesDomains: ['crm', 'accounting', 'banking', 'compliance', 'ai', 'automation'],
    objects: [
      { name: 'Policy', fields: [{ name: 'holderId', type: 'reference' }, { name: 'premium', type: 'number' }], reusesDomain: 'accounting' },
      { name: 'Claim', fields: [{ name: 'policyId', type: 'reference' }, { name: 'amount', type: 'number' }], reusesDomain: 'accounting' },
    ],
    workflows: [{ name: 'ClaimsHandling', steps: ['fnol', 'assess', 'adjust', 'settle'], requiresApproval: true }],
    kpis: [
      { name: 'policyHolders', unit: 'count', compute: (c) => c.business?.crm().counts().accounts ?? 0 },
      { name: 'invoices', unit: 'count', compute: (c) => c.business?.accounting().count() ?? 0 },
    ],
    compliancePacks: [{ pack: 'soc2' }, { pack: 'gdpr' }],
    connectors: [{ system: 'Salesforce', category: 'crm' }, { system: 'QuickBooks', category: 'accounting' }],
    aiSkills: [{ name: 'UnderwritingAssistant', description: 'assist risk assessment' }, { name: 'ClaimSummary', description: 'summarize a claim from real records' }],
    documentTemplates: [{ name: 'PolicyDocument', format: 'pdf', sections: ['coverage', 'exclusions', 'premium'] }],
  };
}
