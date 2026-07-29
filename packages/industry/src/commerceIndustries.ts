/**
 * Commerce & services verticals (Industries 4, 12, 13, 19, 20). Compose on Wave 8 crm / sales /
 * accounting / inventory / assets / projects / hr — no core logic duplicated.
 */
import type { IndustrySolution } from './types';

export function defineRetail(): IndustrySolution {
  return {
    key: 'retail',
    name: 'Retail & E-Commerce (POS / Catalog / Orders / Fulfillment / Loyalty)',
    reusesDomains: ['crm', 'sales', 'inventory', 'accounting', 'ai', 'automation'],
    objects: [
      { name: 'CatalogItem', fields: [{ name: 'sku', type: 'text' }, { name: 'price', type: 'number' }], reusesDomain: 'sales' },
      { name: 'SalesOrder', fields: [{ name: 'customerId', type: 'reference' }, { name: 'total', type: 'number' }], reusesDomain: 'sales' },
    ],
    workflows: [{ name: 'OrderFulfillment', steps: ['order', 'pick', 'pack', 'ship'], requiresApproval: false }],
    kpis: [
      { name: 'customers', unit: 'count', compute: (c) => c.business?.crm().counts().accounts ?? 0 },
      { name: 'catalogProducts', unit: 'count', compute: (c) => c.business?.sales().products().length ?? 0 },
    ],
    compliancePacks: [{ pack: 'pci-dss' }, { pack: 'gdpr' }],
    connectors: [{ system: 'Shopify', category: 'commerce' }, { system: 'WooCommerce', category: 'commerce' }, { system: 'Stripe', category: 'payments' }],
    aiSkills: [{ name: 'MerchandisingAssistant', description: 'assist catalog and pricing' }, { name: 'OrderCopilot', description: 'answer order questions from real data' }],
    documentTemplates: [{ name: 'Invoice', format: 'pdf', sections: ['items', 'totals', 'tax'] }],
  };
}

export function defineHospitality(): IndustrySolution {
  return {
    key: 'hospitality',
    name: 'Hospitality (Hotels / Restaurants / Reservations / Events / Housekeeping)',
    reusesDomains: ['crm', 'sales', 'assets', 'hr', 'accounting', 'automation'],
    objects: [
      { name: 'Reservation', fields: [{ name: 'guestId', type: 'reference' }, { name: 'checkIn', type: 'date' }], reusesDomain: 'crm' },
      { name: 'Room', fields: [{ name: 'number', type: 'text' }, { name: 'status', type: 'text' }], reusesDomain: 'assets' },
    ],
    workflows: [{ name: 'GuestStay', steps: ['reserve', 'check-in', 'service', 'check-out'], requiresApproval: false }],
    kpis: [
      { name: 'guests', unit: 'count', compute: (c) => c.business?.crm().counts().accounts ?? 0 },
      { name: 'properties', unit: 'count', compute: (c) => c.business?.assets().count() ?? 0 },
    ],
    compliancePacks: [{ pack: 'gdpr' }, { pack: 'pci-dss' }],
    connectors: [{ system: 'Stripe', category: 'payments' }, { system: 'Salesforce', category: 'crm' }],
    aiSkills: [{ name: 'ConciergeCopilot', description: 'assist guest requests' }, { name: 'RevenueAssistant', description: 'assist rate planning' }],
    documentTemplates: [{ name: 'Folio', format: 'pdf', sections: ['charges', 'payments'] }],
  };
}

export function defineRealEstate(): IndustrySolution {
  return {
    key: 'real-estate',
    name: 'Real Estate (Properties / Leasing / Facilities / Tenants)',
    reusesDomains: ['assets', 'crm', 'accounting', 'projects', 'automation'],
    objects: [
      { name: 'Property', fields: [{ name: 'address', type: 'text' }, { name: 'units', type: 'number' }], reusesDomain: 'assets' },
      { name: 'Lease', fields: [{ name: 'tenantId', type: 'reference' }, { name: 'rent', type: 'number' }], reusesDomain: 'accounting' },
    ],
    workflows: [{ name: 'Leasing', steps: ['list', 'apply', 'approve', 'sign'], requiresApproval: true }],
    kpis: [
      { name: 'properties', unit: 'count', compute: (c) => c.business?.assets().count() ?? 0 },
      { name: 'tenants', unit: 'count', compute: (c) => c.business?.crm().counts().accounts ?? 0 },
    ],
    compliancePacks: [{ pack: 'gdpr' }],
    connectors: [{ system: 'Xero', category: 'accounting' }],
    aiSkills: [{ name: 'LeaseAssistant', description: 'assist lease drafting' }, { name: 'FacilitiesCopilot', description: 'assist maintenance triage' }],
    documentTemplates: [{ name: 'LeaseAgreement', format: 'pdf', sections: ['premises', 'term', 'rent'] }],
  };
}

export function defineMedia(): IndustrySolution {
  return {
    key: 'media',
    name: 'Media & Entertainment (Content / Production / Licensing / Advertising)',
    reusesDomains: ['projects', 'crm', 'accounting', 'assets', 'ai'],
    objects: [
      { name: 'ContentAsset', fields: [{ name: 'title', type: 'text' }, { name: 'rights', type: 'text' }], reusesDomain: 'assets' },
      { name: 'Production', fields: [{ name: 'title', type: 'text' }, { name: 'budget', type: 'number' }], reusesDomain: 'projects' },
    ],
    workflows: [{ name: 'ContentLifecycle', steps: ['develop', 'produce', 'license', 'distribute'], requiresApproval: false }],
    kpis: [
      { name: 'productions', unit: 'count', compute: (c) => c.business?.projects().count() ?? 0 },
      { name: 'contentAssets', unit: 'count', compute: (c) => c.business?.assets().count() ?? 0 },
    ],
    compliancePacks: [{ pack: 'gdpr' }],
    connectors: [{ system: 'Salesforce', category: 'crm' }],
    aiSkills: [{ name: 'RightsAssistant', description: 'assist licensing terms' }, { name: 'ContentCopilot', description: 'summarize content metadata' }],
    documentTemplates: [{ name: 'LicenseAgreement', format: 'pdf', sections: ['grant', 'territory', 'term'] }],
  };
}

export function defineProfessionalServices(): IndustrySolution {
  return {
    key: 'professional-services',
    name: 'Professional Services (Consulting / Legal / Accounting / Auditing)',
    reusesDomains: ['projects', 'crm', 'accounting', 'hr', 'ai', 'automation'],
    objects: [
      { name: 'Engagement', fields: [{ name: 'clientId', type: 'reference' }, { name: 'fee', type: 'number' }], reusesDomain: 'projects' },
      { name: 'Timesheet', fields: [{ name: 'consultantId', type: 'reference' }, { name: 'hours', type: 'number' }], reusesDomain: 'hr' },
    ],
    workflows: [{ name: 'ClientEngagement', steps: ['propose', 'deliver', 'invoice'], requiresApproval: false }],
    kpis: [
      { name: 'engagements', unit: 'count', compute: (c) => c.business?.projects().count() ?? 0 },
      { name: 'consultants', unit: 'count', compute: (c) => c.business?.hr().count() ?? 0 },
    ],
    compliancePacks: [{ pack: 'iso-9001' }, { pack: 'soc2' }],
    connectors: [{ system: 'Workday', category: 'hr-payroll' }, { system: 'QuickBooks', category: 'accounting' }],
    aiSkills: [{ name: 'ProposalAssistant', description: 'draft engagement proposals' }, { name: 'UtilizationCopilot', description: 'assist capacity planning' }],
    documentTemplates: [{ name: 'StatementOfWork', format: 'pdf', sections: ['scope', 'deliverables', 'fees'] }],
  };
}
