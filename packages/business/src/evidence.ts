/**
 * Wave 8 capability evidence matrix — the four-level HONESTY BOUNDARY encoded as data:
 *   live-verified          — domain runtimes/engines executed entirely inside NEMS over data
 *                            supplied at runtime (CRM, ERP posting engine, accounting, payroll
 *                            compute, banking ledger, tax calc, inventory valuation, etc.)
 *   adapter-verified       — external system integration shapes (SAP/Oracle/Stripe/Epic/FHIR/
 *                            MES/…) validated but never executed
 *   business-data-pending  — requires real business data; registries start empty and are never
 *                            fabricated (customers, revenue, invoices, HR/payroll/patient records)
 *   regulated-external     — requires government/banking/payroll/healthcare/tax/manufacturing
 *                            infrastructure (payroll processing, tax filing, bank transfers, EHR,
 *                            claims, manufacturing execution, legal filings, certification)
 * A test asserts nothing regulated-external or business-data-pending is marked live-verified.
 */
import type { EvidenceLevel } from './types';

export interface CapabilityEvidence {
  capability: string;
  module: string;
  level: EvidenceLevel;
  note: string;
}

export const BUSINESS_MATRIX: CapabilityEvidence[] = [
  // Live-verified — executed entirely inside NEMS over runtime-supplied data
  { capability: 'CRM Runtime', module: 'M1', level: 'live-verified', note: 'Accounts/contacts/leads/opportunities/activities/territories + computed health — in-process.' },
  { capability: 'Sales Runtime (pipeline/forecast)', module: 'M2', level: 'live-verified', note: 'Pipeline and forecast summed from real opportunities only — no revenue fabricated.' },
  { capability: 'Customer Success Runtime', module: 'M3', level: 'live-verified', note: 'Onboarding, renewals, churn risk derived from real CRM health signals.' },
  { capability: 'ERP Core + double-entry posting engine', module: 'M4', level: 'live-verified', note: 'Chart of accounts, journal, posting (rejects unbalanced), trial balance — in-process.' },
  { capability: 'Accounting Runtime', module: 'M5', level: 'live-verified', note: 'AR/AP, invoices, payments, depreciation, statements from the ERP — empty until real data.' },
  { capability: 'Payroll Engine (in-process compute)', module: 'M6', level: 'live-verified', note: 'Payslip gross/deductions/withholding/net computed from a structure — never disbursed.' },
  { capability: 'Banking Ledger + Reconciliation', module: 'M7', level: 'live-verified', note: 'In-process book ledger, cash position, and reconciliation diff — no money movement.' },
  { capability: 'Tax Calculation Engine', module: 'M8', level: 'live-verified', note: 'GST/VAT/sales/withholding computed from rules — never filed.' },
  { capability: 'Procurement Runtime', module: 'M9', level: 'live-verified', note: 'Suppliers, POs, approvals, goods receipt, vendor score, spend analysis — in-process.' },
  { capability: 'Inventory + valuation', module: 'M10', level: 'live-verified', note: 'On-hand and weighted-average valuation computed from recorded movements.' },
  { capability: 'Manufacturing planning + BOM explosion', module: 'M11', level: 'live-verified', note: 'BOM explosion and scheduling in-process — factory execution never performed.' },
  { capability: 'Healthcare FHIR/HL7 models', module: 'M12', level: 'live-verified', note: 'Structural FHIR/HL7 shape validation over SYNTHETIC data — no real patient data.' },
  { capability: 'HR Runtime', module: 'M13', level: 'live-verified', note: 'Employees, departments, skills, performance, org chart — in-process; no live HR records.' },
  { capability: 'Project Portfolio Management', module: 'M14', level: 'live-verified', note: 'Programs/projects/milestones/tasks/risks/OKRs/capacity — in-process.' },
  { capability: 'Enterprise Asset Platform', module: 'M15', level: 'live-verified', note: 'Hardware/software/license/vehicle/building/cloud/IoT assets + lifecycle + maintenance.' },
  { capability: 'Compliance framework + readiness', module: 'M16', level: 'live-verified', note: 'Control matrix, evidence, risk register, readiness % — certification never claimed.' },
  { capability: 'Business AI integration (search/graph/copilot)', module: 'M17', level: 'live-verified', note: 'Lexical search + relationship graph over real business objects (reuses federation search).' },
  { capability: 'Business automation (HITL approvals)', module: 'M18', level: 'live-verified', note: 'Reuses the Wave 4 HITL gate — AI may not self-approve restricted business operations.' },
  { capability: 'Executive dashboards', module: 'M19', level: 'live-verified', note: "Composed from real registries; show 'No business data available' when empty — no fabricated KPIs." },
  { capability: 'Enterprise APIs', module: 'M20', level: 'live-verified', note: 'runtime.crm/erp/finance/accounting/payroll/banking/tax/… composition root.' },
  { capability: 'Business Governance', module: 'M1-M20', level: 'live-verified', note: 'Every business operation audited on the one runtime chain with a replay id and evidence.' },
  // Adapter-verified — external integration shapes; never executed
  { capability: 'ERP adapters (SAP / Oracle / Dynamics / NetSuite)', module: 'M4', level: 'adapter-verified', note: 'Integration shapes registered; never executed.' },
  { capability: 'Accounting adapters (QuickBooks / Xero)', module: 'M5', level: 'adapter-verified', note: 'Integration shapes registered; never executed.' },
  { capability: 'HR/Payroll adapters (Workday / ADP)', module: 'M6/M13', level: 'adapter-verified', note: 'Integration shapes registered; never executed.' },
  { capability: 'Payment adapters (Stripe / PayPal / Razorpay / Plaid)', module: 'M7', level: 'adapter-verified', note: 'Integration shapes registered; never executed.' },
  { capability: 'Healthcare adapters (Epic / Cerner / FHIR / HL7)', module: 'M12', level: 'adapter-verified', note: 'Integration shapes registered; never executed against a real EHR.' },
  { capability: 'Manufacturing adapters (MES / SCADA)', module: 'M11', level: 'adapter-verified', note: 'Integration shapes registered; never executed.' },
  { capability: 'Banking rails (SWIFT / ACH / UPI / open-banking)', module: 'M7', level: 'adapter-verified', note: 'Rail shapes registered; no money moves.' },
  { capability: 'Government tax connectors', module: 'M8', level: 'adapter-verified', note: 'Filing connector shape registered; never submitted.' },
  // Business-data-pending — requires real data; registries start empty
  { capability: 'Customers', module: 'M1', level: 'business-data-pending', note: 'No customers until real ones are entered — never fabricated.' },
  { capability: 'Revenue / pipeline', module: 'M2', level: 'business-data-pending', note: 'Zero until real opportunities exist — never fabricated.' },
  { capability: 'Invoices / financial reports', module: 'M5', level: 'business-data-pending', note: 'Empty until real invoices are posted — never fabricated.' },
  { capability: 'Inventory (actual stock)', module: 'M10', level: 'business-data-pending', note: 'Empty until real movements are recorded.' },
  { capability: 'Projects (actual)', module: 'M14', level: 'business-data-pending', note: 'Empty until real projects are created.' },
  { capability: 'Assets (actual)', module: 'M15', level: 'business-data-pending', note: 'Empty until real assets are registered.' },
  { capability: 'HR records (real people)', module: 'M13', level: 'business-data-pending', note: 'No live HR records until real data is entered.' },
  { capability: 'Payroll data (real salaries)', module: 'M6', level: 'business-data-pending', note: 'No salaries until real compensation is entered.' },
  { capability: 'Patient records (real)', module: 'M12', level: 'business-data-pending', note: 'Only synthetic models — real patient data is never stored.' },
  // Regulated-external — requires regulated infrastructure; never executed
  { capability: 'Payroll processing / disbursement', module: 'M6', level: 'regulated-external', note: 'Requires a payroll provider + banking. Prepared, never executed.' },
  { capability: 'Government tax filing', module: 'M8', level: 'regulated-external', note: 'Requires a government portal. Prepared, never submitted.' },
  { capability: 'Bank transfers / payment settlement', module: 'M7', level: 'regulated-external', note: 'Requires bank rails + credentials. Instructed, never settled.' },
  { capability: 'Healthcare EHR / PHI', module: 'M12', level: 'regulated-external', note: 'Requires a regulated EHR. Never connected; no real PHI stored.' },
  { capability: 'Insurance claims', module: 'M12', level: 'regulated-external', note: 'Requires a payer network. Never submitted.' },
  { capability: 'Manufacturing execution', module: 'M11', level: 'regulated-external', note: 'Requires a real MES/SCADA + plant. Planned, never executed.' },
  { capability: 'Legal filings', module: 'M16', level: 'regulated-external', note: 'Requires legal/government systems. Never filed.' },
  { capability: 'Compliance certification', module: 'M16', level: 'regulated-external', note: 'Requires an accredited external auditor. Readiness tracked, certification never claimed.' },
  { capability: 'Government APIs / payment rails', module: 'M7/M8', level: 'regulated-external', note: 'Requires regulated infrastructure + credentials. Never invoked.' },
];

export interface BusinessReadiness {
  total: number;
  liveVerified: number;
  adapterVerified: number;
  businessDataPending: number;
  regulatedExternal: number;
}

export function businessReadiness(matrix: CapabilityEvidence[] = BUSINESS_MATRIX): BusinessReadiness {
  const by = (l: EvidenceLevel): number => matrix.filter((m) => m.level === l).length;
  return {
    total: matrix.length,
    liveVerified: by('live-verified'),
    adapterVerified: by('adapter-verified'),
    businessDataPending: by('business-data-pending'),
    regulatedExternal: by('regulated-external'),
  };
}
