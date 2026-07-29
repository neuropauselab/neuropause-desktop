/**
 * Wave 9 constants. Isolated module (no imports).
 */
export const INDUSTRY_VERSION = '0.0.0-preview.1';

/** The one honest answer analytics gives when no real customer data exists. */
export const NO_INDUSTRY_DATA = 'No business data available';

/** The 20 vertical solution packs. */
export const INDUSTRY_KEYS = [
  'healthcare',
  'medical-device',
  'pharmaceutical',
  'retail',
  'banking',
  'insurance',
  'manufacturing',
  'logistics',
  'construction',
  'education',
  'government',
  'hospitality',
  'real-estate',
  'energy',
  'telecom',
  'agriculture',
  'automotive',
  'aviation',
  'media',
  'professional-services',
] as const;
export type IndustryKey = (typeof INDUSTRY_KEYS)[number];

/** Reusable compliance packs — represented as frameworks only; certification is never claimed. */
export const COMPLIANCE_PACKS = ['iso-9001', 'iso-13485', 'hipaa', 'gdpr', 'soc2', 'pci-dss', 'fda', 'gmp', 'glp'] as const;
export type CompliancePackKey = (typeof COMPLIANCE_PACKS)[number];

/** Connector marketplace — external systems, adapter-verified until configured. */
export const CONNECTOR_CATALOG: Array<{ system: string; category: string }> = [
  { system: 'SAP', category: 'erp' },
  { system: 'Oracle', category: 'erp' },
  { system: 'Microsoft Dynamics', category: 'erp' },
  { system: 'Salesforce', category: 'crm' },
  { system: 'Epic', category: 'healthcare' },
  { system: 'Cerner', category: 'healthcare' },
  { system: 'Shopify', category: 'commerce' },
  { system: 'WooCommerce', category: 'commerce' },
  { system: 'Stripe', category: 'payments' },
  { system: 'Razorpay', category: 'payments' },
  { system: 'QuickBooks', category: 'accounting' },
  { system: 'Xero', category: 'accounting' },
  { system: 'Workday', category: 'hr-payroll' },
  { system: 'ADP', category: 'hr-payroll' },
];

/** Low-code artifact kinds. */
export const LOWCODE_ARTIFACTS = ['object', 'form', 'workflow', 'report', 'dashboard', 'automation', 'document'] as const;
export type LowCodeArtifact = (typeof LOWCODE_ARTIFACTS)[number];

export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];
