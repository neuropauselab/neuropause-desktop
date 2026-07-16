/**
 * Industry Solution Platform (P13) — the pure projection model.
 *
 * A curated SOLUTION-PACK CATALOG over the EXISTING platform. Each `IndustrySuiteDefinition`
 * references REAL platform entities by id — built-in AI workers, connector manifests, enterprise
 * compliance rules, and workforce governance policies — plus marketplace example slugs and catalog
 * metadata (KPIs, frameworks, dashboards, playbooks, reports, automations, knowledge packs,
 * templates). This module resolves each suite against a composed snapshot of the LIVE deployment
 * (`IndustryPlatformState`) to produce an honest readiness signal: `present` (the platform ships
 * the referenced entity) and `active` (it is wired/enabled in THIS deployment). It is pure — no
 * I/O, no new runtime, no new store — and unit-tested under Node.
 */
import type {
  ExecutiveKpi,
  IndustryCollection,
  IndustryComplianceFramework,
  IndustryComplianceReport,
  IndustryEntityRef,
  IndustryFrameworkRef,
  IndustryId,
  IndustryPlatformOverview,
  IndustryPlatformSummary,
  IndustryReadinessReport,
  IndustrySuite,
  IndustrySuiteDefinition,
  IndustrySuiteReadiness,
  IndustrySuiteStatus,
  IndustrySuiteSummary,
} from '@neuropause/shared';

/** Readiness bands (fraction of referenced real entities wired/enabled in this deployment). */
const READY_THRESHOLD = 0.75;
const PARTIAL_THRESHOLD = 0.25;

/** The composed snapshot the projections read (assembled by the service from live stores). */
export interface IndustryPlatformState {
  /** Registered worker ids (workerRegistry.summaries()). */
  workerIds: string[];
  /** Supported connector manifest ids (the connector registry). */
  supportedConnectorIds: string[];
  /** Connector ids with at least one connected account in this deployment. */
  connectedConnectorIds: string[];
  /** Optional connector id → display name (falls back to the id). */
  connectorLabels?: Record<string, string>;
  /** Enterprise compliance rules with their enabled state. */
  complianceRules: { id: string; enabled: boolean }[];
  /** Present workforce governance policy ids (the built-in `pol:*` defaults). */
  policyIds: string[];
  /** Marketplace slugs currently published in this deployment. */
  publishedSlugs: string[];
}

/* ── Framework catalog (reused across suites; catalog metadata, not installed entities) ── */

const FW: Record<string, IndustryFrameworkRef> = {
  soc2: { id: 'soc2', name: 'SOC 2', description: 'AICPA Trust Services security, availability & confidentiality controls.' },
  gdpr: { id: 'gdpr', name: 'GDPR', description: 'EU General Data Protection Regulation.' },
  iso27001: { id: 'iso27001', name: 'ISO/IEC 27001', description: 'Information security management systems.' },
  sox: { id: 'sox', name: 'SOX', description: 'Sarbanes-Oxley financial reporting controls.' },
  hipaa: { id: 'hipaa', name: 'HIPAA', description: 'US protected-health-information privacy & security.' },
  hitrust: { id: 'hitrust', name: 'HITRUST CSF', description: 'Healthcare security certification framework.' },
  pci: { id: 'pci-dss', name: 'PCI-DSS', description: 'Payment Card Industry Data Security Standard.' },
  basel: { id: 'basel-iii', name: 'Basel III', description: 'Banking capital, leverage & liquidity risk framework.' },
  iso9001: { id: 'iso9001', name: 'ISO 9001', description: 'Quality management systems.' },
  osha: { id: 'osha', name: 'OSHA', description: 'US occupational safety & health standards.' },
  iso45001: { id: 'iso45001', name: 'ISO 45001', description: 'Occupational health & safety management.' },
  ferpa: { id: 'ferpa', name: 'FERPA', description: 'US student education-records privacy.' },
  fedramp: { id: 'fedramp', name: 'FedRAMP', description: 'US federal cloud security authorization.' },
  nist: { id: 'nist-800-53', name: 'NIST 800-53', description: 'US federal security & privacy controls.' },
  cmmc: { id: 'cmmc', name: 'CMMC', description: 'Cybersecurity Maturity Model Certification (defense).' },
  nerc: { id: 'nerc-cip', name: 'NERC CIP', description: 'Critical-infrastructure protection for the bulk electric system.' },
  iso55000: { id: 'iso55000', name: 'ISO 55000', description: 'Asset management systems.' },
  iso28000: { id: 'iso28000', name: 'ISO 28000', description: 'Supply-chain security management.' },
  ctpat: { id: 'c-tpat', name: 'C-TPAT', description: 'Customs-Trade Partnership Against Terrorism.' },
  tl9000: { id: 'tl9000', name: 'TL 9000', description: 'Telecom quality management system.' },
};

/* ── The twelve industry solution packs (authored definitions referencing REAL ids) ── */

export const INDUSTRY_SUITES: IndustrySuiteDefinition[] = [
  {
    id: 'erp',
    name: 'ERP Suite',
    sector: 'Enterprise Resource Planning',
    summary: 'Finance, procurement and operations automation across SAP, Oracle, Dynamics and NetSuite.',
    systems: ['SAP S/4HANA', 'Oracle Fusion', 'Microsoft Dynamics 365', 'NetSuite', 'Odoo', 'IFS', 'Epicor'],
    workerIds: ['worker:finance', 'worker:procurement', 'worker:operations', 'worker:exec-cfo', 'worker:exec-coo'],
    connectorIds: ['sap', 'oracle', 'dynamics365', 'workday', 'servicenow'],
    complianceRuleIds: ['rule-audit', 'rule-side-effects', 'rule-chain'],
    policyIds: ['pol:read-allow', 'pol:external-approval', 'pol:high-risk-approval'],
    marketplaceSlugs: ['soc2-governance-pack', 'markdown-export-plugin'],
    frameworks: [FW.sox, FW.soc2, FW.iso27001],
    kpis: [
      { key: 'erp.o2c', label: 'Order-to-cash cycle', unit: 'days', benchmark: '< 30 days', description: 'Average days from order to cash receipt.' },
      { key: 'erp.invoice', label: 'Invoice accuracy', unit: '%', benchmark: '> 98%', description: 'Share of invoices requiring no correction.' },
      { key: 'erp.savings', label: 'Procurement savings', unit: '%', benchmark: '> 8%', description: 'Realized sourcing savings vs baseline.' },
      { key: 'erp.close', label: 'Financial close', unit: 'days', benchmark: '< 5 days', description: 'Days to complete the period-end close.' },
    ],
    dashboards: ['Order-to-Cash', 'Procure-to-Pay', 'Financial Close'],
    automations: [
      { name: 'Three-way match', detail: 'Reconcile PO, goods receipt and invoice before payment.' },
      { name: 'Period-close checklist', detail: 'Sequenced close tasks with approval gates.' },
    ],
    playbooks: [
      { name: 'Vendor onboarding', detail: 'KYC + approval chain for new suppliers.' },
      { name: 'Month-end close', detail: 'Close sequencing and reconciliation playbook.' },
    ],
    reports: ['P&L summary', 'Aged payables', 'Spend by category'],
    knowledgePacks: [
      { name: 'Chart of accounts', detail: 'Standard COA taxonomy and mappings.' },
      { name: 'Procurement policy corpus', detail: 'Sourcing and approval rules.' },
    ],
    templates: ['Purchase requisition', 'Journal entry approval', 'Vendor master'],
  },
  {
    id: 'healthcare',
    name: 'Healthcare Suite',
    sector: 'Healthcare & Life Sciences',
    summary: 'Hospital operations, clinical workflow and medical compliance over FHIR, HL7 and DICOM systems.',
    systems: ['FHIR R4', 'HL7 v2', 'DICOM', 'Epic', 'Cerner', 'Hospital EMR'],
    workerIds: ['worker:operations', 'worker:support', 'worker:hr', 'worker:legal', 'worker:exec-cco'],
    connectorIds: ['servicenow', 'microsoft-entra', 'google-workspace', 'salesforce'],
    complianceRuleIds: ['rule-audit', 'rule-side-effects', 'rule-chain', 'rule-worker-health'],
    policyIds: ['pol:read-allow', 'pol:external-approval', 'pol:high-risk-approval', 'pol:write-trust'],
    marketplaceSlugs: ['soc2-governance-pack', 'markdown-export-plugin'],
    frameworks: [FW.hipaa, FW.hitrust, FW.gdpr],
    kpis: [
      { key: 'hc.occupancy', label: 'Bed occupancy', unit: '%', benchmark: '80–85%', description: 'Inpatient bed utilization.' },
      { key: 'hc.los', label: 'Avg length of stay', unit: 'days', benchmark: '< 5 days', description: 'Mean inpatient length of stay.' },
      { key: 'hc.readmit', label: '30-day readmission', unit: '%', benchmark: '< 15%', description: 'Unplanned 30-day readmission rate.' },
      { key: 'hc.denial', label: 'Claim denial rate', unit: '%', benchmark: '< 5%', description: 'Share of claims denied by payers.' },
    ],
    dashboards: ['Bed Management', 'Clinical Throughput', 'Compliance Posture'],
    automations: [
      { name: 'Prior authorization', detail: 'Route payer authorization requests.' },
      { name: 'Discharge coordination', detail: 'Orchestrate discharge tasks across teams.' },
    ],
    playbooks: [
      { name: 'Patient-safety event', detail: 'Incident reporting and review workflow.' },
      { name: 'PHI breach response', detail: 'Breach notification and containment playbook.' },
    ],
    reports: ['Census report', 'Denials summary', 'Compliance attestation'],
    knowledgePacks: [
      { name: 'Clinical protocols', detail: 'Care-pathway reference library.' },
      { name: 'HIPAA policy corpus', detail: 'PHI handling and safeguard rules.' },
    ],
    templates: ['Care plan', 'Consent form', 'Incident report'],
  },
  {
    id: 'manufacturing',
    name: 'Manufacturing Suite',
    sector: 'Manufacturing & Industrial',
    summary: 'Production, maintenance and quality operations across MES, SCADA and IoT.',
    systems: ['MES', 'SCADA', 'IoT / Historian', 'OPC-UA', 'Siemens Opcenter'],
    workerIds: ['worker:operations', 'worker:procurement', 'worker:engineering', 'worker:infra-platform', 'worker:exec-coo'],
    connectorIds: ['sap', 'oracle', 'servicenow', 'dynamics365'],
    complianceRuleIds: ['rule-audit', 'rule-side-effects', 'rule-worker-health'],
    policyIds: ['pol:read-allow', 'pol:external-approval', 'pol:high-risk-approval'],
    marketplaceSlugs: ['soc2-governance-pack', 'inbox-to-notion-automation'],
    frameworks: [FW.iso9001, FW.iso27001, FW.osha],
    kpis: [
      { key: 'mfg.oee', label: 'Overall equipment effectiveness', unit: '%', benchmark: '> 85%', description: 'Availability × performance × quality.' },
      { key: 'mfg.fpy', label: 'First-pass yield', unit: '%', benchmark: '> 95%', description: 'Units passing without rework.' },
      { key: 'mfg.downtime', label: 'Unplanned downtime', unit: 'hrs', benchmark: '< 2%', description: 'Unplanned line stoppage.' },
      { key: 'mfg.scrap', label: 'Scrap rate', unit: '%', benchmark: '< 1%', description: 'Material scrapped vs consumed.' },
    ],
    dashboards: ['OEE Overview', 'Maintenance', 'Quality Control'],
    automations: [
      { name: 'Preventive maintenance', detail: 'Schedule work orders from telemetry thresholds.' },
      { name: 'Nonconformance routing', detail: 'NCR creation and disposition workflow.' },
    ],
    playbooks: [
      { name: 'Line changeover', detail: 'Changeover sequencing and validation.' },
      { name: '8D root cause', detail: 'Eight-discipline problem-solving playbook.' },
    ],
    reports: ['Downtime Pareto', 'Yield by line', 'Maintenance backlog'],
    knowledgePacks: [
      { name: 'SOP library', detail: 'Standard operating procedures.' },
      { name: 'Quality standards', detail: 'ISO 9001 clause reference.' },
    ],
    templates: ['Work order', 'Nonconformance report', 'PM schedule'],
  },
  {
    id: 'finance',
    name: 'Finance Suite',
    sector: 'Banking & Financial Services',
    summary: 'Treasury, risk, compliance and forecasting for financial services.',
    systems: ['Bloomberg', 'ERP General Ledger', 'Treasury Management', 'Risk Engine', 'Reuters'],
    workerIds: ['worker:finance', 'worker:exec-cfo', 'worker:legal', 'worker:exec-cco', 'worker:research'],
    connectorIds: ['salesforce', 'hubspot', 'sap', 'oracle', 'workday', 'microsoft-entra'],
    complianceRuleIds: ['rule-audit', 'rule-side-effects', 'rule-chain'],
    policyIds: ['pol:read-allow', 'pol:external-approval', 'pol:high-risk-approval', 'pol:write-trust'],
    marketplaceSlugs: ['soc2-governance-pack', 'markdown-export-plugin'],
    frameworks: [FW.sox, FW.pci, FW.basel, FW.gdpr],
    kpis: [
      { key: 'fin.dso', label: 'Days sales outstanding', unit: 'days', benchmark: '< 45 days', description: 'Average collection period.' },
      { key: 'fin.forecast', label: 'Forecast accuracy', unit: '%', benchmark: '> 90%', description: 'Actual vs forecast variance.' },
      { key: 'fin.var', label: 'Value at risk (95%)', unit: '$', benchmark: 'within limit', description: 'Portfolio 95% VaR.' },
      { key: 'fin.findings', label: 'Audit findings', unit: 'count', benchmark: '0 material', description: 'Open material audit findings.' },
    ],
    dashboards: ['Treasury', 'Risk Exposure', 'Regulatory Reporting'],
    automations: [
      { name: 'Reconciliation', detail: 'Bank-to-GL reconciliation with exceptions.' },
      { name: 'Regulatory filing', detail: 'Filing preparation and approval routing.' },
    ],
    playbooks: [
      { name: 'Fraud triage', detail: 'Suspicious-activity investigation workflow.' },
      { name: 'Close & attest', detail: 'SOX attestation and sign-off playbook.' },
    ],
    reports: ['Cash position', 'Risk register', 'Covenant compliance'],
    knowledgePacks: [
      { name: 'Risk taxonomy', detail: 'Risk categories and limit structure.' },
      { name: 'Regulatory corpus', detail: 'Applicable financial regulations.' },
    ],
    templates: ['Journal approval', 'Risk assessment', 'Filing checklist'],
  },
  {
    id: 'retail',
    name: 'Retail Suite',
    sector: 'Retail & Commerce',
    summary: 'POS, inventory, CRM, pricing and loyalty across commerce channels.',
    systems: ['POS', 'Shopify', 'Square', 'Inventory Management', 'Loyalty Platform'],
    workerIds: ['worker:sales', 'worker:marketing', 'worker:support', 'worker:operations', 'worker:finance'],
    connectorIds: ['salesforce', 'hubspot', 'dynamics365', 'sap'],
    complianceRuleIds: ['rule-audit', 'rule-side-effects'],
    policyIds: ['pol:read-allow', 'pol:external-approval', 'pol:high-risk-approval'],
    marketplaceSlugs: ['soc2-governance-pack', 'inbox-to-notion-automation'],
    frameworks: [FW.pci, FW.gdpr, FW.soc2],
    kpis: [
      { key: 'ret.ssg', label: 'Same-store sales growth', unit: '%', benchmark: '> 3%', description: 'Comparable-store sales growth.' },
      { key: 'ret.turns', label: 'Inventory turns', unit: 'ratio', benchmark: '> 6', description: 'Annual inventory turnover.' },
      { key: 'ret.gmroi', label: 'GMROI', unit: 'ratio', benchmark: '> 3', description: 'Gross margin return on inventory.' },
      { key: 'ret.basket', label: 'Average basket size', unit: '$', benchmark: 'rising', description: 'Average transaction value.' },
    ],
    dashboards: ['Sales Performance', 'Inventory Health', 'Loyalty'],
    automations: [
      { name: 'Replenishment', detail: 'Auto-reorder on stock thresholds.' },
      { name: 'Price change', detail: 'Markdown approval workflow.' },
    ],
    playbooks: [
      { name: 'Stockout recovery', detail: 'Out-of-stock response workflow.' },
      { name: 'Peak season', detail: 'Holiday readiness playbook.' },
    ],
    reports: ['Sell-through', 'Margin by SKU', 'Loyalty cohort'],
    knowledgePacks: [
      { name: 'Merchandising', detail: 'Category and assortment rules.' },
      { name: 'Pricing policy', detail: 'Discount guardrails and approvals.' },
    ],
    templates: ['Promotion plan', 'Reorder point', 'Loyalty tier'],
  },
  {
    id: 'supply-chain',
    name: 'Supply Chain Suite',
    sector: 'Supply Chain & Logistics',
    summary: 'Planning, procurement, warehouse and transportation orchestration.',
    systems: ['WMS', 'TMS', 'EDI', 'Demand Planning', 'Blue Yonder'],
    workerIds: ['worker:operations', 'worker:procurement', 'worker:finance', 'worker:exec-coo'],
    connectorIds: ['sap', 'oracle', 'servicenow', 'workday'],
    complianceRuleIds: ['rule-audit', 'rule-side-effects', 'rule-worker-health'],
    policyIds: ['pol:read-allow', 'pol:external-approval', 'pol:high-risk-approval'],
    marketplaceSlugs: ['soc2-governance-pack', 'inbox-to-notion-automation'],
    frameworks: [FW.iso28000, FW.ctpat, FW.iso9001],
    kpis: [
      { key: 'sc.otif', label: 'On-time in-full', unit: '%', benchmark: '> 95%', description: 'Orders delivered complete and on time.' },
      { key: 'sc.invdays', label: 'Inventory days of supply', unit: 'days', benchmark: '< 40 days', description: 'Days of inventory on hand.' },
      { key: 'sc.freight', label: 'Freight cost', unit: '%', benchmark: '< 6%', description: 'Freight as a share of revenue.' },
      { key: 'sc.perfect', label: 'Perfect order rate', unit: '%', benchmark: '> 90%', description: 'Orders with no defects end-to-end.' },
    ],
    dashboards: ['Network Flow', 'Inventory Position', 'Carrier Performance'],
    automations: [
      { name: 'ASN processing', detail: 'Ingest advance ship notices.' },
      { name: 'Exception routing', detail: 'Escalate delays and shortages.' },
    ],
    playbooks: [
      { name: 'Disruption response', detail: 'Supplier disruption mitigation playbook.' },
      { name: 'S&OP cycle', detail: 'Sales & operations planning cadence.' },
    ],
    reports: ['OTIF trend', 'Landed cost', 'Supplier scorecard'],
    knowledgePacks: [
      { name: 'Incoterms', detail: 'Trade terms reference.' },
      { name: 'Carrier matrix', detail: 'Lane and rate reference.' },
    ],
    templates: ['Purchase order', 'Advance ship notice', 'Freight tender'],
  },
  {
    id: 'education',
    name: 'Education Suite',
    sector: 'Education & Research',
    summary: 'Student operations, learning management and institutional administration.',
    systems: ['LMS', 'SIS', 'Canvas', 'Blackboard', 'Banner'],
    workerIds: ['worker:operations', 'worker:support', 'worker:hr', 'worker:marketing'],
    connectorIds: ['google-workspace', 'microsoft-entra', 'servicenow', 'slack'],
    complianceRuleIds: ['rule-audit', 'rule-side-effects', 'rule-orphans'],
    policyIds: ['pol:read-allow', 'pol:external-approval', 'pol:high-risk-approval'],
    marketplaceSlugs: ['soc2-governance-pack', 'research-analyst-worker'],
    frameworks: [FW.ferpa, FW.gdpr, FW.soc2],
    kpis: [
      { key: 'edu.yield', label: 'Enrollment yield', unit: '%', benchmark: '> 35%', description: 'Admitted students who enroll.' },
      { key: 'edu.retention', label: 'Retention rate', unit: '%', benchmark: '> 85%', description: 'Year-over-year student retention.' },
      { key: 'edu.ttd', label: 'Time to degree', unit: 'yrs', benchmark: '< 4.2 yrs', description: 'Average time to completion.' },
      { key: 'edu.resolution', label: 'Support resolution', unit: 'hrs', benchmark: '< 24 hrs', description: 'Service-desk resolution time.' },
    ],
    dashboards: ['Enrollment', 'Student Success', 'Service Desk'],
    automations: [
      { name: 'Enrollment workflow', detail: 'Application-to-enrollment orchestration.' },
      { name: 'Advising nudges', detail: 'At-risk student alerting.' },
    ],
    playbooks: [
      { name: 'Student onboarding', detail: 'New-student onboarding workflow.' },
      { name: 'Retention intervention', detail: 'At-risk intervention playbook.' },
    ],
    reports: ['Enrollment funnel', 'Retention cohort', 'Ticket volume'],
    knowledgePacks: [
      { name: 'Course catalog', detail: 'Program and course reference.' },
      { name: 'Policy handbook', detail: 'Academic policies and procedures.' },
    ],
    templates: ['Course plan', 'Advising note', 'Support ticket'],
  },
  {
    id: 'legal',
    name: 'Legal Suite',
    sector: 'Legal & Professional Services',
    summary: 'Matter management, contract lifecycle and compliance for legal teams.',
    systems: ['iManage', 'Relativity', 'Document Management', 'Contract Lifecycle', 'NetDocuments'],
    workerIds: ['worker:legal', 'worker:exec-cco', 'worker:operations', 'worker:research'],
    connectorIds: ['microsoft-entra', 'google-workspace', 'notion', 'atlassian'],
    complianceRuleIds: ['rule-audit', 'rule-side-effects', 'rule-chain'],
    policyIds: ['pol:read-allow', 'pol:external-approval', 'pol:high-risk-approval', 'pol:write-trust'],
    marketplaceSlugs: ['soc2-governance-pack', 'research-analyst-worker'],
    frameworks: [FW.gdpr, FW.soc2, FW.iso27001],
    kpis: [
      { key: 'legal.matter', label: 'Matter cycle time', unit: 'days', benchmark: '< 30 days', description: 'Average matter resolution time.' },
      { key: 'legal.contract', label: 'Contract turnaround', unit: 'days', benchmark: '< 10 days', description: 'Draft-to-signature time.' },
      { key: 'legal.findings', label: 'Compliance findings', unit: 'count', benchmark: '0 open', description: 'Open compliance findings.' },
      { key: 'legal.utilization', label: 'Billable utilization', unit: '%', benchmark: '> 80%', description: 'Billable-hour utilization.' },
    ],
    dashboards: ['Matter Pipeline', 'Contract Lifecycle', 'Compliance'],
    automations: [
      { name: 'Contract intake', detail: 'Clause extraction and routing.' },
      { name: 'Obligation tracking', detail: 'Renewal and expiry alerting.' },
    ],
    playbooks: [
      { name: 'Contract review', detail: 'CLM review and negotiation workflow.' },
      { name: 'Litigation hold', detail: 'Preservation and hold playbook.' },
    ],
    reports: ['Matter status', 'Contract expiries', 'Risk exposure'],
    knowledgePacks: [
      { name: 'Clause library', detail: 'Standard and fallback clauses.' },
      { name: 'Negotiation corpus', detail: 'Preferred negotiation positions.' },
    ],
    templates: ['NDA', 'Master services agreement', 'Matter intake'],
  },
  {
    id: 'government',
    name: 'Government Suite',
    sector: 'Government & Public Sector',
    summary: 'Case management, citizen services and public-sector compliance.',
    systems: ['FedRAMP', 'StateRAMP', 'GovCloud', 'Case Management', 'Grants Management'],
    workerIds: ['worker:legal', 'worker:exec-cco', 'worker:operations', 'worker:support', 'worker:exec-ciso'],
    connectorIds: ['microsoft-entra', 'servicenow', 'salesforce'],
    complianceRuleIds: ['rule-audit', 'rule-side-effects', 'rule-chain', 'rule-leads'],
    policyIds: ['pol:read-allow', 'pol:external-approval', 'pol:high-risk-approval', 'pol:write-trust'],
    marketplaceSlugs: ['soc2-governance-pack', 'markdown-export-plugin'],
    frameworks: [FW.fedramp, FW.nist, FW.cmmc, FW.gdpr],
    kpis: [
      { key: 'gov.resolution', label: 'Case resolution time', unit: 'days', benchmark: '< 20 days', description: 'Average case closure time.' },
      { key: 'gov.sla', label: 'SLA compliance', unit: '%', benchmark: '> 95%', description: 'Service-level attainment.' },
      { key: 'gov.backlog', label: 'Case backlog', unit: 'count', benchmark: 'declining', description: 'Open case backlog.' },
      { key: 'gov.findings', label: 'Audit findings', unit: 'count', benchmark: '0 critical', description: 'Open control findings.' },
    ],
    dashboards: ['Case Management', 'Service Levels', 'Compliance Posture'],
    automations: [
      { name: 'Case routing', detail: 'Intake-to-assignment orchestration.' },
      { name: 'Records request', detail: 'FOIA processing workflow.' },
    ],
    playbooks: [
      { name: 'Security incident', detail: 'Incident response playbook.' },
      { name: 'Continuity of operations', detail: 'COOP activation playbook.' },
    ],
    reports: ['Case backlog', 'SLA attainment', 'Control assessment'],
    knowledgePacks: [
      { name: 'Statute corpus', detail: 'Statutes and directives reference.' },
      { name: 'Control catalog', detail: 'NIST control set reference.' },
    ],
    templates: ['Case file', 'FOIA request', 'ATO package'],
  },
  {
    id: 'construction',
    name: 'Construction Suite',
    sector: 'Construction & Engineering',
    summary: 'Project controls, procurement and field operations for architecture, engineering & construction.',
    systems: ['Procore', 'Autodesk BIM', 'Primavera', 'Bluebeam', 'Sage 300 CRE'],
    workerIds: ['worker:operations', 'worker:procurement', 'worker:finance', 'worker:engineering'],
    connectorIds: ['sap', 'oracle', 'servicenow', 'dynamics365'],
    complianceRuleIds: ['rule-audit', 'rule-side-effects', 'rule-worker-health'],
    policyIds: ['pol:read-allow', 'pol:external-approval', 'pol:high-risk-approval'],
    marketplaceSlugs: ['soc2-governance-pack', 'inbox-to-notion-automation'],
    frameworks: [FW.iso9001, FW.osha, FW.iso45001],
    kpis: [
      { key: 'con.schedule', label: 'Schedule variance', unit: '%', benchmark: 'within 5%', description: 'Planned vs actual schedule.' },
      { key: 'con.cpi', label: 'Cost performance index', unit: 'ratio', benchmark: '> 1.0', description: 'Earned value over actual cost.' },
      { key: 'con.rfi', label: 'RFI cycle time', unit: 'days', benchmark: '< 7 days', description: 'Request-for-information turnaround.' },
      { key: 'con.safety', label: 'Safety incident rate', unit: 'TRIR', benchmark: '< 1.0', description: 'Total recordable incident rate.' },
    ],
    dashboards: ['Project Controls', 'Procurement', 'Field Safety'],
    automations: [
      { name: 'RFI routing', detail: 'Request-for-information workflow.' },
      { name: 'Submittal tracking', detail: 'Submittal review and approval.' },
    ],
    playbooks: [
      { name: 'Change order', detail: 'Change-management playbook.' },
      { name: 'Site safety', detail: 'Safety inspection playbook.' },
    ],
    reports: ['Schedule status', 'Cost variance', 'Safety log'],
    knowledgePacks: [
      { name: 'Specification library', detail: 'Division specifications reference.' },
      { name: 'Safety standards', detail: 'OSHA reference material.' },
    ],
    templates: ['Request for information', 'Submittal', 'Change order'],
  },
  {
    id: 'energy',
    name: 'Energy Suite',
    sector: 'Energy & Utilities',
    summary: 'Grid operations, asset maintenance and regulatory compliance for utilities.',
    systems: ['SCADA', 'GIS', 'OSIsoft PI', 'ADMS', 'Historian'],
    workerIds: ['worker:operations', 'worker:infra-platform', 'worker:infra-security', 'worker:procurement', 'worker:exec-coo'],
    connectorIds: ['sap', 'oracle', 'servicenow'],
    complianceRuleIds: ['rule-audit', 'rule-side-effects', 'rule-worker-health', 'rule-chain'],
    policyIds: ['pol:read-allow', 'pol:external-approval', 'pol:high-risk-approval'],
    marketplaceSlugs: ['soc2-governance-pack', 'markdown-export-plugin'],
    frameworks: [FW.nerc, FW.iso27001, FW.iso55000],
    kpis: [
      { key: 'egy.saidi', label: 'SAIDI', unit: 'min', benchmark: '< 100 min', description: 'System average interruption duration.' },
      { key: 'egy.saifi', label: 'SAIFI', unit: 'count', benchmark: '< 1.0', description: 'System average interruption frequency.' },
      { key: 'egy.asset', label: 'Asset health index', unit: 'index', benchmark: '> 80', description: 'Composite asset condition score.' },
      { key: 'egy.restore', label: 'Outage restoration', unit: 'hrs', benchmark: '< 2 hrs', description: 'Average restoration time.' },
    ],
    dashboards: ['Grid Operations', 'Asset Health', 'Compliance'],
    automations: [
      { name: 'Outage detection', detail: 'SCADA alarm triage.' },
      { name: 'Crew dispatch', detail: 'Field work dispatch workflow.' },
    ],
    playbooks: [
      { name: 'Storm response', detail: 'Major-event restoration playbook.' },
      { name: 'NERC CIP audit', detail: 'CIP audit preparation playbook.' },
    ],
    reports: ['Reliability indices', 'Asset condition', 'Compliance evidence'],
    knowledgePacks: [
      { name: 'Asset standards', detail: 'Equipment specification reference.' },
      { name: 'CIP corpus', detail: 'NERC CIP requirement reference.' },
    ],
    templates: ['Work order', 'Switching order', 'Compliance evidence'],
  },
  {
    id: 'telecom',
    name: 'Telecommunications Suite',
    sector: 'Telecommunications',
    summary: 'Network operations, service assurance and subscriber management.',
    systems: ['OSS/BSS', 'Netcracker', 'Amdocs', 'NMS', 'Ericsson OSS'],
    workerIds: ['worker:support', 'worker:operations', 'worker:infra-network', 'worker:sales', 'worker:exec-cio'],
    connectorIds: ['servicenow', 'salesforce', 'sap', 'oracle'],
    complianceRuleIds: ['rule-audit', 'rule-side-effects', 'rule-worker-health'],
    policyIds: ['pol:read-allow', 'pol:external-approval', 'pol:high-risk-approval'],
    marketplaceSlugs: ['soc2-governance-pack', 'github-connector'],
    frameworks: [FW.iso27001, FW.gdpr, FW.tl9000],
    kpis: [
      { key: 'tel.availability', label: 'Network availability', unit: '%', benchmark: '> 99.99%', description: 'Network uptime.' },
      { key: 'tel.mttr', label: 'Mean time to repair', unit: 'hrs', benchmark: '< 2 hrs', description: 'Average incident repair time.' },
      { key: 'tel.churn', label: 'Churn rate', unit: '%', benchmark: '< 2%', description: 'Monthly subscriber churn.' },
      { key: 'tel.arpu', label: 'ARPU', unit: '$', benchmark: 'rising', description: 'Average revenue per user.' },
    ],
    dashboards: ['Network Health', 'Service Assurance', 'Subscriber'],
    automations: [
      { name: 'Incident correlation', detail: 'Alarm-to-ticket correlation.' },
      { name: 'Provisioning', detail: 'Service activation workflow.' },
    ],
    playbooks: [
      { name: 'Outage response', detail: 'Major-incident response playbook.' },
      { name: 'Churn save', detail: 'Retention and win-back workflow.' },
    ],
    reports: ['Availability trend', 'Ticket aging', 'Churn cohort'],
    knowledgePacks: [
      { name: 'Network topology', detail: 'Reference architecture.' },
      { name: 'NOC runbooks', detail: 'Network operations runbook corpus.' },
    ],
    templates: ['Trouble ticket', 'Service order', 'Change request'],
  },
];

/* ── Resolution helpers ── */

function labelForWorker(id: string): string {
  return id.replace(/^worker:/, '');
}

function statusFor(activation: number): IndustrySuiteStatus {
  return activation >= READY_THRESHOLD ? 'ready' : activation >= PARTIAL_THRESHOLD ? 'partial' : 'planned';
}

/** Resolve a single suite definition against the live snapshot. */
export function resolveSuite(def: IndustrySuiteDefinition, state: IndustryPlatformState): IndustrySuite {
  const workerSet = new Set(state.workerIds);
  const supportedSet = new Set(state.supportedConnectorIds);
  const connectedSet = new Set(state.connectedConnectorIds);
  const policySet = new Set(state.policyIds);
  const publishedSet = new Set(state.publishedSlugs);
  const ruleEnabled = new Map(state.complianceRules.map((r) => [r.id, r.enabled]));
  const connectorLabels = state.connectorLabels ?? {};

  const workerRefs: IndustryEntityRef[] = def.workerIds.map((id) => {
    const present = workerSet.has(id);
    return { kind: 'worker', id, label: labelForWorker(id), present, active: present };
  });
  const connectorRefs: IndustryEntityRef[] = def.connectorIds.map((id) => {
    const present = supportedSet.has(id);
    return { kind: 'connector', id, label: connectorLabels[id] ?? id, present, active: connectedSet.has(id) };
  });
  const complianceRefs: IndustryEntityRef[] = def.complianceRuleIds.map((id) => {
    const present = ruleEnabled.has(id);
    return { kind: 'compliance', id, label: id, present, active: ruleEnabled.get(id) === true };
  });
  const policyRefs: IndustryEntityRef[] = def.policyIds.map((id) => {
    const present = policySet.has(id);
    return { kind: 'policy', id, label: id, present, active: present };
  });
  const listingRefs: IndustryEntityRef[] = def.marketplaceSlugs.map((slug) => {
    const present = publishedSet.has(slug);
    return { kind: 'listing', id: slug, label: slug, present, active: present };
  });

  const all = [...workerRefs, ...connectorRefs, ...complianceRefs, ...policyRefs, ...listingRefs];
  const referenced = all.length;
  const present = all.filter((r) => r.present).length;
  // COVERAGE = what the PLATFORM ships: the fraction of referenced capabilities that exist in this
  // build (present). Near-constant by design — it validates that the pack references only real,
  // shipped platform entities, and is 0 only if the platform is stripped of them.
  const coverage = referenced > 0 ? present / referenced : 0;
  // ACTIVATION = what THIS DEPLOYMENT has actually wired up, and it is the ONLY axis that drives the
  // readiness band. Workers, workforce policies, seeded compliance rules, and auto-published example
  // listings are all platform-shipped defaults (present ⇒ active), so folding them in would make a
  // brand-new, zero-config install look "ready". The one capability an operator must configure
  // per-deployment is CONNECTORS (connect the external systems), so activation is the fraction of the
  // suite's connectors that are actually connected. A suite with no connectors connected is never
  // "ready" — honestly reflecting that nothing has been wired up yet.
  const connectorsConnected = connectorRefs.filter((r) => r.active).length;
  const activation = connectorRefs.length > 0 ? connectorsConnected / connectorRefs.length : 0;

  const readiness: IndustrySuiteReadiness = {
    coverage,
    activation,
    workers: { referenced: workerRefs.length, available: workerRefs.filter((r) => r.active).length },
    connectors: {
      referenced: connectorRefs.length,
      supported: connectorRefs.filter((r) => r.present).length,
      connected: connectorRefs.filter((r) => r.active).length,
    },
    compliance: { referenced: complianceRefs.length, enabled: complianceRefs.filter((r) => r.active).length },
    policies: { referenced: policyRefs.length, enabled: policyRefs.filter((r) => r.active).length },
  };

  return {
    ...def,
    status: statusFor(activation),
    readiness,
    workerRefs,
    connectorRefs,
    complianceRefs,
    policyRefs,
    listingRefs,
    counts: {
      workers: def.workerIds.length,
      connectors: def.connectorIds.length,
      compliance: def.complianceRuleIds.length,
      policies: def.policyIds.length,
      frameworks: def.frameworks.length,
      kpis: def.kpis.length,
      dashboards: def.dashboards.length,
      automations: def.automations.length,
      playbooks: def.playbooks.length,
      reports: def.reports.length,
      knowledgePacks: def.knowledgePacks.length,
      templates: def.templates.length,
      systems: def.systems.length,
    },
  };
}

export function buildSuites(state: IndustryPlatformState): IndustrySuite[] {
  return INDUSTRY_SUITES.map((d) => resolveSuite(d, state));
}

export function buildSuiteSummaries(state: IndustryPlatformState): IndustrySuiteSummary[] {
  return buildSuites(state).map((s) => ({
    id: s.id,
    name: s.name,
    sector: s.sector,
    status: s.status,
    coverage: s.readiness.coverage,
    activation: s.readiness.activation,
    workers: s.readiness.workers.referenced,
    connectors: s.readiness.connectors.referenced,
    connectorsConnected: s.readiness.connectors.connected,
    frameworks: s.frameworks.length,
  }));
}

/* ── Marketplace collections (referenced example listings, resolved) ── */

export function buildCollections(state: IndustryPlatformState): IndustryCollection[] {
  return buildSuites(state).map((s) => ({
    id: s.id,
    name: s.name,
    sector: s.sector,
    status: s.status,
    entries: s.listingRefs,
    available: s.listingRefs.filter((r) => r.present).length,
    total: s.listingRefs.length,
  }));
}

/* ── Compliance rollup ──
 * Maps each catalog framework (HIPAA, PCI-DSS, FedRAMP, …) to the GENERIC platform governance
 * controls (rule-audit, rule-side-effects, rule-chain, rule-worker-health, …) carried by the suites
 * that reference it, and reports how many of those backing controls are enabled. This is honest
 * control-enablement, NOT a framework-specific attestation — the platform ships generic governance
 * rules, not HIPAA/PCI/FedRAMP-specific checks, so `status` is a "controls enabled" band. */

export function buildComplianceReport(state: IndustryPlatformState): IndustryComplianceReport {
  const ruleEnabled = new Map(state.complianceRules.map((r) => [r.id, r.enabled]));
  const byFramework = new Map<string, { fw: IndustryFrameworkRef; industries: Set<IndustryId>; ruleIds: Set<string> }>();
  const allRuleIds = new Set<string>();

  for (const def of INDUSTRY_SUITES) {
    for (const id of def.complianceRuleIds) allRuleIds.add(id);
    for (const fw of def.frameworks) {
      const entry = byFramework.get(fw.id) ?? { fw, industries: new Set<IndustryId>(), ruleIds: new Set<string>() };
      entry.industries.add(def.id);
      for (const id of def.complianceRuleIds) entry.ruleIds.add(id);
      byFramework.set(fw.id, entry);
    }
  }

  const frameworks: IndustryComplianceFramework[] = [...byFramework.values()]
    .map(({ fw, industries, ruleIds }) => {
      const ruleRefs: IndustryEntityRef[] = [...ruleIds].sort().map((id) => ({
        kind: 'compliance' as const,
        id,
        label: id,
        present: ruleEnabled.has(id),
        active: ruleEnabled.get(id) === true,
      }));
      const enabled = ruleRefs.filter((r) => r.active).length;
      const total = ruleRefs.length;
      const activation = total > 0 ? enabled / total : 1;
      return {
        id: fw.id,
        name: fw.name,
        description: fw.description,
        industries: [...industries].sort(),
        ruleRefs,
        enabled,
        total,
        status: statusFor(activation),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const rulesEnabled = [...allRuleIds].filter((id) => ruleEnabled.get(id) === true).length;
  return { frameworks, totalFrameworks: frameworks.length, rulesReferenced: allRuleIds.size, rulesEnabled };
}

/* ── Live platform KPIs (real ExecutiveKpi projection) ── */

function kpiBand(pct: number): 'healthy' | 'watch' | 'at-risk' | 'critical' {
  return pct >= 75 ? 'healthy' : pct >= 50 ? 'watch' : pct >= 25 ? 'at-risk' : 'critical';
}

export function buildIndustryKpis(state: IndustryPlatformState): ExecutiveKpi[] {
  const suites = buildSuites(state);
  const total = suites.length;
  const ready = suites.filter((s) => s.status === 'ready').length;
  const avgCoverage = total > 0 ? Math.round((suites.reduce((n, s) => n + s.readiness.coverage, 0) / total) * 100) : 0;
  const avgActivation = total > 0 ? Math.round((suites.reduce((n, s) => n + s.readiness.activation, 0) / total) * 100) : 0;

  const referencedConnectors = new Set<string>();
  const connectedConnectors = new Set<string>();
  const connectedSet = new Set(state.connectedConnectorIds);
  for (const s of suites) {
    for (const r of s.connectorRefs) {
      referencedConnectors.add(r.id);
      if (connectedSet.has(r.id)) connectedConnectors.add(r.id);
    }
  }
  const connectorPct = referencedConnectors.size > 0 ? Math.round((connectedConnectors.size / referencedConnectors.size) * 100) : 0;

  const readyPct = total > 0 ? Math.round((ready / total) * 100) : 0;

  return [
    { key: 'industry.platform.suites', label: 'Industry suites', value: null, display: `${total} suites`, trend: 'flat' },
    { key: 'industry.platform.ready', label: 'Deployment-ready', value: readyPct, display: `${ready}/${total} ready`, band: kpiBand(readyPct) },
    { key: 'industry.platform.coverage', label: 'Platform coverage', value: avgCoverage, display: `${avgCoverage}%`, band: kpiBand(avgCoverage) },
    { key: 'industry.platform.activation', label: 'Deployment activation', value: avgActivation, display: `${avgActivation}%`, band: kpiBand(avgActivation) },
    { key: 'industry.connectors.connected', label: 'Connectors connected', value: connectorPct, display: `${connectedConnectors.size}/${referencedConnectors.size} connected`, band: kpiBand(connectorPct) },
  ];
}

/* ── Readiness rollup ── */

export function buildReadinessReport(state: IndustryPlatformState): IndustryReadinessReport {
  const suites = buildSuites(state);
  const entries = suites.map((s) => ({
    id: s.id,
    name: s.name,
    sector: s.sector,
    status: s.status,
    coverage: s.readiness.coverage,
    activation: s.readiness.activation,
  }));
  const ready = entries.filter((e) => e.status === 'ready').length;
  const partial = entries.filter((e) => e.status === 'partial').length;
  const planned = entries.filter((e) => e.status === 'planned').length;
  const averageActivation = entries.length > 0 ? entries.reduce((n, e) => n + e.activation, 0) / entries.length : 0;
  return { entries, ready, partial, planned, averageActivation };
}

/* ── Platform summary + overview bundle ── */

export function buildPlatformSummary(state: IndustryPlatformState): IndustryPlatformSummary {
  const suites = buildSuites(state);
  const compliance = buildComplianceReport(state);
  const workersReferenced = new Set<string>();
  const workersAvailable = new Set<string>();
  const connectorsReferenced = new Set<string>();
  const connectorsConnected = new Set<string>();
  const workerSet = new Set(state.workerIds);
  const connectedSet = new Set(state.connectedConnectorIds);
  for (const s of suites) {
    for (const r of s.workerRefs) {
      workersReferenced.add(r.id);
      if (workerSet.has(r.id)) workersAvailable.add(r.id);
    }
    for (const r of s.connectorRefs) {
      connectorsReferenced.add(r.id);
      if (connectedSet.has(r.id)) connectorsConnected.add(r.id);
    }
  }
  return {
    totalSuites: suites.length,
    ready: suites.filter((s) => s.status === 'ready').length,
    partial: suites.filter((s) => s.status === 'partial').length,
    planned: suites.filter((s) => s.status === 'planned').length,
    workersReferenced: workersReferenced.size,
    workersAvailable: workersAvailable.size,
    connectorsReferenced: connectorsReferenced.size,
    connectorsConnected: connectorsConnected.size,
    complianceFrameworks: compliance.totalFrameworks,
    marketplaceCollections: suites.length,
  };
}

export function buildIndustryOverview(state: IndustryPlatformState): IndustryPlatformOverview {
  return {
    summary: buildPlatformSummary(state),
    suites: buildSuites(state),
    collections: buildCollections(state),
    compliance: buildComplianceReport(state),
    kpis: buildIndustryKpis(state),
  };
}
