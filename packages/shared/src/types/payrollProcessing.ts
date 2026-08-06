/**
 * HR → Statutory Payroll Processing — the pure gross-to-net engine (W6-A3)
 * composing W6-A1 salary structures with W6-A2 effective-dated statutory
 * rules over the W4 payroll-run machinery.
 *
 * TWO MODES PER EMPLOYEE, split honestly and never mixed silently:
 * - STATUTORY: structure-assigned employees with a positive basic get the
 *   full chain — breakup → wage bases → PF / ESI / PT / TDS from the
 *   period's resolved rule set → net pay.
 * - FLAT: legacy employees on `monthlySalary` stay on the W4 accrual path
 *   (computing PF on a flat gross would over-deduct against the basic-wage
 *   norm) — counted and named per line and in totals.
 * PT is state law: a line with no work state (or a state absent from the
 * table) SKIPS PT with a per-line note and a run-level count — never a
 * silent zero. TDS annualizes the month's taxable base ×12, stated. The ESI
 * disability ceiling stays engine-supported, but no disability flag exists
 * on employee records — the W4 privacy rule outranks it.
 *
 * The accrual builder emits one BALANCED multi-line GL entry: gross and
 * employer contributions as expenses against net pay and every statutory
 * payable — balance is by construction (net ≡ gross − employee-side
 * deductions), and the tests prove it to the paisa.
 *
 * Pure (no I/O), so it is shared by the backend hooks and the tests.
 */
import type { GlJournalLine } from './generalLedger';
import type { Employee } from './hr';
import type { SalaryComponent } from './salaryStructures';
import { computeSalaryBreakup } from './salaryStructures';
import {
  calculateAnnualTds,
  calculateEsi,
  calculatePf,
  calculatePt,
  type StatutoryRuleSet,
} from './statutoryRules';

/** Employer-contribution expense accounts (ensured before posting). */
export const PAYROLL_EMPLOYER_PF_ACCOUNT = { code: '5310', name: 'Employer PF Contributions', type: 'expense' } as const;
export const PAYROLL_EMPLOYER_ESI_ACCOUNT = { code: '5320', name: 'Employer ESI Contributions', type: 'expense' } as const;
/** Statutory + contractual payables (ensured before posting). */
export const PF_PAYABLE_ACCOUNT = { code: '2210', name: 'PF Payable', type: 'liability' } as const;
export const ESI_PAYABLE_ACCOUNT = { code: '2220', name: 'ESI Payable', type: 'liability' } as const;
export const PT_PAYABLE_ACCOUNT = { code: '2230', name: 'Professional Tax Payable', type: 'liability' } as const;
export const TDS_PAYABLE_ACCOUNT = { code: '2240', name: 'TDS Payable', type: 'liability' } as const;
export const DEDUCTIONS_PAYABLE_ACCOUNT = { code: '2250', name: 'Employee Deductions Payable', type: 'liability' } as const;

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** One itemized component amount on a payroll line (drives the payslip). */
export interface PayComponentLine {
  code: string;
  name: string;
  amount: number;
}

/** One employee's fully computed line on a statutory payroll run. */
export interface StatutoryPayrollLine {
  employee: string;
  name: string;
  mode: 'statutory' | 'flat';
  gross: number;
  basic: number;
  /** Itemized earnings incl. Basic — the payslip's earnings block (W6-A5). */
  earnings: PayComponentLine[];
  /** Itemized non-statutory (contractual) deductions — the payslip's other-deductions block. */
  contractualDeductions: PayComponentLine[];
  /** PF filing detail — the wage bases + employer EPS/EPF split ECR needs (W6-A7). */
  pfWageBase: number;
  pfCappedBase: number;
  pfEmployerEps: number;
  pfEmployerEpf: number;
  /** ESI filing wage base (0 when not ESI-eligible). */
  esiWageBase: number;
  pfEmployee: number;
  pfEmployerTotal: number;
  pfEdli: number;
  pfAdmin: number;
  esiEligible: boolean;
  esiEmployee: number;
  esiEmployer: number;
  pt: number;
  ptSkipped: boolean;
  tdsMonthly: number;
  otherDeductions: number;
  netPay: number;
  note: string;
}

export interface StatutoryPayrollRun {
  lines: StatutoryPayrollLine[];
  employeeCount: number;
  statutoryCount: number;
  flatCount: number;
  /** Active employees with neither a usable structure nor a flat salary. */
  unsalariedCount: number;
  ptSkippedCount: number;
  totalGross: number;
  totalNet: number;
  totalPfEmployee: number;
  totalPfEmployer: number;
  totalPfEdli: number;
  totalPfAdmin: number;
  totalEsiEmployee: number;
  totalEsiEmployer: number;
  totalPt: number;
  totalTds: number;
  totalOtherDeductions: number;
  ruleSetCode: string | null;
}

/**
 * Derive the full statutory run. Employees with a resolvable structure, a
 * positive basic, AND a rule set compute statutory; everyone else with a flat
 * salary stays legacy-flat; the rest are unsalaried — every bucket counted.
 */
export function deriveStatutoryPayrollRun(
  employees: Employee[],
  structuresById: Map<string, SalaryComponent[]>,
  ruleSet: StatutoryRuleSet | null,
  periodKey: string,
): StatutoryPayrollRun {
  const month = Number(periodKey.slice(5, 7)) || 0;
  const active = employees.filter((e) => !e.exitedAt);
  const lines: StatutoryPayrollLine[] = [];
  let unsalariedCount = 0;
  for (const e of active) {
    const ref = e.salaryStructureRef ?? '';
    const basic = e.basicSalary ?? 0;
    const components = ref ? structuresById.get(ref) : undefined;
    if (ruleSet && ref && components && basic > 0) {
      const breakup = computeSalaryBreakup(components, basic);
      const pf = calculatePf(ruleSet.pf, breakup.pfWageBase);
      const esi = calculateEsi(ruleSet.esi, breakup.esiWageBase);
      const state = (e.workState ?? '').trim().toUpperCase();
      const ptResult = state ? calculatePt(ruleSet.pt, state, breakup.grossEarnings, month) : { stateFound: false, amount: 0 };
      const ptSkipped = !ptResult.stateFound;
      const tds = calculateAnnualTds(ruleSet.tds, breakup.taxableBase * 12);
      const netPay = round2(
        breakup.grossEarnings - pf.employee - esi.employee - ptResult.amount - tds.monthlyTds - breakup.totalDeductions,
      );
      lines.push({
        employee: e.id,
        name: e.name,
        mode: 'statutory',
        gross: breakup.grossEarnings,
        basic: round2(basic),
        earnings: breakup.lines
          .filter((l) => l.kind === 'earning')
          .map((l) => ({ code: l.code, name: l.name, amount: l.amount })),
        contractualDeductions: breakup.lines
          .filter((l) => l.kind === 'deduction')
          .map((l) => ({ code: l.code, name: l.name, amount: l.amount })),
        pfWageBase: pf.contributionBase,
        pfCappedBase: pf.cappedBase,
        pfEmployerEps: pf.employerEps,
        pfEmployerEpf: pf.employerEpf,
        esiWageBase: esi.eligible ? breakup.esiWageBase : 0,
        pfEmployee: pf.employee,
        pfEmployerTotal: pf.employerTotal,
        pfEdli: pf.edli,
        pfAdmin: pf.admin,
        esiEligible: esi.eligible,
        esiEmployee: esi.employee,
        esiEmployer: esi.employer,
        pt: ptResult.amount,
        ptSkipped,
        tdsMonthly: tds.monthlyTds,
        otherDeductions: breakup.totalDeductions,
        netPay,
        note: ptSkipped
          ? state
            ? `PT skipped: state "${state}" is not in the rule table`
            : 'PT skipped: no work state on the employee'
          : '',
      });
    } else if (e.monthlySalary > 0) {
      lines.push({
        employee: e.id,
        name: e.name,
        mode: 'flat',
        gross: round2(e.monthlySalary),
        basic: 0,
        earnings: [{ code: 'GROSS', name: 'Gross Salary', amount: round2(e.monthlySalary) }],
        contractualDeductions: [],
        pfWageBase: 0,
        pfCappedBase: 0,
        pfEmployerEps: 0,
        pfEmployerEpf: 0,
        esiWageBase: 0,
        pfEmployee: 0,
        pfEmployerTotal: 0,
        pfEdli: 0,
        pfAdmin: 0,
        esiEligible: false,
        esiEmployee: 0,
        esiEmployer: 0,
        pt: 0,
        ptSkipped: false,
        tdsMonthly: 0,
        otherDeductions: 0,
        netPay: round2(e.monthlySalary),
        note:
          ref && basic > 0 && !components
            ? 'flat: assigned structure not found — repair the assignment'
            : ref && basic <= 0
              ? 'flat: structure assigned but basic is not positive'
              : 'flat: no structure assigned — statutory not computed, stated',
      });
    } else {
      unsalariedCount += 1;
    }
  }
  lines.sort((a, b) => b.gross - a.gross || a.name.localeCompare(b.name));
  const sum = (pick: (l: StatutoryPayrollLine) => number): number => round2(lines.reduce((s, l) => s + pick(l), 0));
  const statutoryCount = lines.filter((l) => l.mode === 'statutory').length;
  return {
    lines,
    employeeCount: lines.length,
    statutoryCount,
    flatCount: lines.length - statutoryCount,
    unsalariedCount,
    ptSkippedCount: lines.filter((l) => l.ptSkipped).length,
    totalGross: sum((l) => l.gross),
    totalNet: sum((l) => l.netPay),
    totalPfEmployee: sum((l) => l.pfEmployee),
    totalPfEmployer: sum((l) => l.pfEmployerTotal),
    totalPfEdli: sum((l) => l.pfEdli),
    totalPfAdmin: sum((l) => l.pfAdmin),
    totalEsiEmployee: sum((l) => l.esiEmployee),
    totalEsiEmployer: sum((l) => l.esiEmployer),
    totalPt: sum((l) => l.pt),
    totalTds: sum((l) => l.tdsMonthly),
    totalOtherDeductions: sum((l) => l.otherDeductions),
    ruleSetCode: ruleSet ? ruleSet.ruleSetCode : null,
  };
}

/**
 * The balanced accrual lines. Zero lines are dropped; balance holds by
 * construction: net ≡ gross − employee-side deductions, so
 * Dr(gross + employer PF + employer ESI) = Cr(net + payables).
 */
export function statutoryAccrualLines(run: StatutoryPayrollRun, salariesExpenseCode: string, salariesPayableCode: string): GlJournalLine[] {
  const employerPfExpense = round2(run.totalPfEmployer + run.totalPfEdli + run.totalPfAdmin);
  const pfPayable = round2(run.totalPfEmployee + employerPfExpense);
  const esiPayable = round2(run.totalEsiEmployee + run.totalEsiEmployer);
  const lines: GlJournalLine[] = [
    { account: salariesExpenseCode, debit: run.totalGross, credit: 0 },
    { account: PAYROLL_EMPLOYER_PF_ACCOUNT.code, debit: employerPfExpense, credit: 0 },
    { account: PAYROLL_EMPLOYER_ESI_ACCOUNT.code, debit: run.totalEsiEmployer, credit: 0 },
    { account: salariesPayableCode, debit: 0, credit: run.totalNet },
    { account: PF_PAYABLE_ACCOUNT.code, debit: 0, credit: pfPayable },
    { account: ESI_PAYABLE_ACCOUNT.code, debit: 0, credit: esiPayable },
    { account: PT_PAYABLE_ACCOUNT.code, debit: 0, credit: run.totalPt },
    { account: TDS_PAYABLE_ACCOUNT.code, debit: 0, credit: run.totalTds },
    { account: DEDUCTIONS_PAYABLE_ACCOUNT.code, debit: 0, credit: run.totalOtherDeductions },
  ];
  return lines.filter((l) => l.debit > 0 || l.credit > 0);
}
