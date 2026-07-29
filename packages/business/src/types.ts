/**
 * Wave 8 shared types. The four-level evidence classification is the honesty spine of this
 * wave; domain entity types live in their own module files. Registries start EMPTY — real
 * customers, revenue, invoices, payroll, patients, etc. are BUSINESS-DATA-PENDING and never
 * fabricated.
 */
export type EvidenceLevel =
  | 'live-verified' // executed entirely inside NEMS over data supplied at runtime
  | 'adapter-verified' // external integration interface exists; shape validated; never executed
  | 'business-data-pending' // requires real business data; empty until entered
  | 'regulated-external'; // requires government/banking/payroll/healthcare/tax/manufacturing infra

export interface Money {
  amount: number;
  currency: string;
}

export type ApprovalState = 'pending' | 'approved' | 'rejected';

/** Standard note strings that keep the boundary explicit on every record. */
export const REGULATED_NOTE = 'REGULATED-EXTERNAL — requires regulated infrastructure; represented, never executed';
export const BUSINESS_DATA_NOTE = 'BUSINESS-DATA-PENDING — requires real business data; empty until entered';
export const ADAPTER_NOTE = 'ADAPTER-VERIFIED — external integration shape validated; never executed';
