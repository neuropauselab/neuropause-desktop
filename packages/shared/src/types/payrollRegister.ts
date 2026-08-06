/**
 * HR → Payroll Register — the management summary snapshot over posted payroll
 * runs (W6-A6). A register aggregates every POSTED run for one period into
 * per-employee rows (gross, itemized deductions, net, employer cost) plus
 * column totals — the internal report finance signs off before disbursement
 * and filing. It is a SNAPSHOT: immutable once generated (the W1 pattern), and
 * the register sequence for a period is the audit trail of what was reported
 * when — never superseded, never edited.
 *
 * Distinct from statutory FILING registers (W6-A7): this is the internal
 * management view; government portal formats are that increment's concern.
 *
 * Pure (no I/O), so it is shared by the backend hooks and the tests.
 */
import type { StatutoryPayrollRun } from './payrollProcessing';

/** The Payroll Register module id + record kind (the framework store key). */
export const PAYROLL_REGISTER_MODULE_ID = 'hr-payroll-register';
export const PAYROLL_REGISTER_KIND = 'payrollRegister';

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** One employee's aggregated line across the period's posted runs. */
export interface PayrollRegisterRow {
  employee: string;
  name: string;
  mode: string;
  gross: number;
  pfEmployee: number;
  esiEmployee: number;
  pt: number;
  tds: number;
  contractual: number;
  totalDeductions: number;
  netPay: number;
  pfEmployer: number;
  esiEmployer: number;
}

export interface PayrollRegister {
  rows: PayrollRegisterRow[];
  employeeCount: number;
  statutoryCount: number;
  flatCount: number;
  runCount: number;
  totalGross: number;
  totalNet: number;
  totalPfEmployee: number;
  totalEsiEmployee: number;
  totalPt: number;
  totalTds: number;
  totalContractual: number;
  totalEmployerPf: number;
  totalEmployerEsi: number;
}

/**
 * Aggregate posted runs into a register — one row per employee, summed across
 * every run supplied (normally one run per period; corrections add more). All
 * arithmetic is round2; `totalDeductions` is derived from its parts, never
 * trusted.
 */
export function derivePayrollRegister(runs: StatutoryPayrollRun[]): PayrollRegister {
  const byEmployee = new Map<string, PayrollRegisterRow>();
  for (const run of runs) {
    for (const line of run.lines) {
      const row =
        byEmployee.get(line.employee) ??
        {
          employee: line.employee,
          name: line.name,
          mode: line.mode,
          gross: 0,
          pfEmployee: 0,
          esiEmployee: 0,
          pt: 0,
          tds: 0,
          contractual: 0,
          totalDeductions: 0,
          netPay: 0,
          pfEmployer: 0,
          esiEmployer: 0,
        };
      row.gross = round2(row.gross + line.gross);
      row.pfEmployee = round2(row.pfEmployee + line.pfEmployee);
      row.esiEmployee = round2(row.esiEmployee + line.esiEmployee);
      row.pt = round2(row.pt + line.pt);
      row.tds = round2(row.tds + line.tdsMonthly);
      row.contractual = round2(row.contractual + line.otherDeductions);
      row.netPay = round2(row.netPay + line.netPay);
      row.pfEmployer = round2(row.pfEmployer + line.pfEmployerTotal);
      row.esiEmployer = round2(row.esiEmployer + line.esiEmployer);
      byEmployee.set(line.employee, row);
    }
  }
  const rows = [...byEmployee.values()].map((r) => ({
    ...r,
    totalDeductions: round2(r.pfEmployee + r.esiEmployee + r.pt + r.tds + r.contractual),
  }));
  rows.sort((a, b) => b.netPay - a.netPay || a.name.localeCompare(b.name));
  const sum = (pick: (r: PayrollRegisterRow) => number): number => round2(rows.reduce((s, r) => s + pick(r), 0));
  return {
    rows,
    employeeCount: rows.length,
    statutoryCount: rows.filter((r) => r.mode === 'statutory').length,
    flatCount: rows.filter((r) => r.mode !== 'statutory').length,
    runCount: runs.length,
    totalGross: sum((r) => r.gross),
    totalNet: sum((r) => r.netPay),
    totalPfEmployee: sum((r) => r.pfEmployee),
    totalEsiEmployee: sum((r) => r.esiEmployee),
    totalPt: sum((r) => r.pt),
    totalTds: sum((r) => r.tds),
    totalContractual: sum((r) => r.contractual),
    totalEmployerPf: sum((r) => r.pfEmployer),
    totalEmployerEsi: sum((r) => r.esiEmployer),
  };
}
