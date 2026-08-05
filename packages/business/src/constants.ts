/**
 * Wave 8 constants. Isolated module (no imports).
 */
export const BUSINESS_VERSION = '0.0.0-preview.1';

/** The one honest answer a dashboard gives when no real business data exists. */
export const NO_BUSINESS_DATA = 'No business data available';

// Module 1 — CRM
export const LEAD_STAGES = ['new', 'contacted', 'qualified', 'unqualified', 'converted'] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];
export const OPPORTUNITY_STAGES = ['prospecting', 'qualification', 'proposal', 'negotiation', 'closed-won', 'closed-lost'] as const;
export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number];

// Module 2 — Sales
export const QUOTE_STATES = ['draft', 'sent', 'accepted', 'rejected', 'expired'] as const;
export type QuoteState = (typeof QUOTE_STATES)[number];

// Module 4 — ERP: account classes and their normal balance
export const ACCOUNT_CLASSES = ['asset', 'liability', 'equity', 'revenue', 'expense'] as const;
export type AccountClass = (typeof ACCOUNT_CLASSES)[number];

// Module 6 — Payroll
export const PAY_COMPONENT_KINDS = ['earning', 'allowance', 'deduction', 'benefit'] as const;
export type PayComponentKind = (typeof PAY_COMPONENT_KINDS)[number];

// Module 7 — Banking rails (adapter shapes; no money movement)
export const PAYMENT_RAILS = ['swift', 'ach', 'sepa', 'upi', 'card', 'open-banking'] as const;
export type PaymentRail = (typeof PAYMENT_RAILS)[number];

// Module 8 — Tax
export const TAX_TYPES = ['gst', 'vat', 'sales-tax', 'corporate', 'withholding'] as const;
export type TaxType = (typeof TAX_TYPES)[number];

// Module 9 — Procurement
export const PO_STATES = ['draft', 'requested', 'approved', 'ordered', 'received', 'closed'] as const;
export type PurchaseOrderState = (typeof PO_STATES)[number];

// Module 10 — Inventory
export const MOVEMENT_KINDS = ['receipt', 'issue', 'transfer', 'adjustment'] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

// Module 11 — Manufacturing
export const PRODUCTION_STATES = ['planned', 'released', 'in-progress-descriptor', 'complete-descriptor'] as const;
export type ProductionState = (typeof PRODUCTION_STATES)[number];

// Module 12 — Healthcare (FHIR resource model kinds — structural only)
export const FHIR_RESOURCES = ['Patient', 'Practitioner', 'Encounter', 'Observation', 'MedicationRequest', 'DiagnosticReport', 'CarePlan'] as const;
export type FhirResource = (typeof FHIR_RESOURCES)[number];

// Module 16 — Compliance frameworks
export const COMPLIANCE_FRAMEWORKS = ['iso-27001', 'soc2', 'hipaa', 'gdpr', 'pci-dss', 'sox', 'fda-21cfr11'] as const;
export type ComplianceFramework = (typeof COMPLIANCE_FRAMEWORKS)[number];

// Module 19 — Executive roles
export const EXECUTIVE_ROLES = ['CEO', 'COO', 'CFO', 'CRO', 'CHRO', 'CIO', 'CTO', 'Board'] as const;
export type ExecutiveRole = (typeof EXECUTIVE_ROLES)[number];
