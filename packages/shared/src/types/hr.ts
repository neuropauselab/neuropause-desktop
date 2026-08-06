/**
 * HR → Employees + Payroll Runs — the HR-core domain (W4.3/W4.4). A NEW
 * certification family; RBAC deliberately reuses `operations:read` /
 * `operations:manage` (the Finance/Projects precedent).
 *
 * EMPLOYEES are deliberately WORK-SCOPED records: name, role, department,
 * manager, work contact, join date, monthly salary. No personal data beyond
 * what payroll and the org chart need — that is a privacy decision, not an
 * omission. The org structure is the `managerRef` chain (self-referential,
 * CYCLE-GUARDED at validate); exits are the W1 marker pattern.
 *
 * PAYROLL RUNS are Payroll LITE, stated honestly: one run per month gathers
 * every ACTIVE employee with a positive salary, previews deterministically,
 * and POSTING books the ACCRUAL into the real W1 General Ledger through the
 * `applyGlDerivedEntries` seam — Dr Salaries Expense / Cr Salaries Payable,
 * idempotent entry number, closed-period guards inherited from the journal
 * itself. Statutory payroll (PF/ESI/TDS) and salary DISBURSEMENT (Cr Cash)
 * are deliberately out of scope and named as such — never faked.
 *
 * Pure (no I/O), so it is shared by the backend hooks and the tests.
 */
import type { EnterpriseEntity } from './enterpriseModule';
import type { GlJournalLine } from './generalLedger';

/** The Employees module id + record kind (the framework store key). */
export const EMPLOYEES_MODULE_ID = 'hr-employees';
export const EMPLOYEE_KIND = 'employee';

/** The Payroll Runs module id + record kind (the framework store key). */
export const PAYROLL_RUNS_MODULE_ID = 'hr-payroll-runs';
export const PAYROLL_RUN_KIND = 'payrollRun';

/** The payroll accrual accounts (ensured, then posted against). */
export const PAYROLL_EXPENSE_ACCOUNT = { code: '5300', name: 'Salaries Expense', type: 'expense' } as const;
export const PAYROLL_LIABILITY_ACCOUNT = { code: '2200', name: 'Salaries Payable', type: 'liability' } as const;

/** A typed view over an employee record's flat fields. */
export interface Employee {
  id: string;
  employeeNumber: string;
  name: string;
  role: string;
  department: string;
  managerRef: string;
  workEmail: string;
  joinDate: string | null;
  monthlySalary: number;
  exitedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}
function num(v: unknown): number {
  return typeof v === 'number' ? v : Number(str(v)) || 0;
}
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Project a framework record into a typed employee. */
export function employeeFromRecord(record: EnterpriseEntity): Employee {
  const f = record.fields;
  return {
    id: record.id,
    employeeNumber: str(f.employeeNumber) || record.title,
    name: str(f.name),
    role: str(f.role),
    department: str(f.department),
    managerRef: str(f.managerRef),
    workEmail: str(f.workEmail),
    joinDate: str(f.joinDate) || null,
    monthlySalary: num(f.monthlySalary),
    exitedAt: str(f.exitedAt) || null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * Walk the manager chain from `startManagerRef`; returns the offending chain
 * when it loops back to `employeeId` (or exceeds `maxDepth`), else null.
 */
export function managerChainCycle(
  employeeId: string,
  startManagerRef: string,
  byId: Map<string, Employee>,
  maxDepth = 20,
): string[] | null {
  const chain: string[] = [];
  let cursor = startManagerRef;
  for (let depth = 0; cursor && depth < maxDepth; depth += 1) {
    chain.push(cursor);
    if (cursor === employeeId) return chain; // loops back — cycle
    cursor = byId.get(cursor)?.managerRef ?? '';
  }
  return cursor ? chain : null; // non-empty cursor at maxDepth → treat as cycle
}

/** One node of the derived org chart. */
export interface OrgNode {
  employee: string;
  name: string;
  role: string;
  level: number;
  directReports: number;
}

/** Derive the org chart from the manager chains — roots first, level by level. */
export function deriveOrgChart(employees: Employee[]): OrgNode[] {
  const active = employees.filter((e) => !e.exitedAt);
  const byId = new Map(active.map((e) => [e.id, e]));
  const reportCounts = new Map<string, number>();
  for (const e of active) {
    if (e.managerRef && byId.has(e.managerRef)) {
      reportCounts.set(e.managerRef, (reportCounts.get(e.managerRef) ?? 0) + 1);
    }
  }
  const levelOf = (e: Employee): number => {
    let level = 0;
    let cursor = e.managerRef;
    const seen = new Set<string>([e.id]);
    while (cursor && byId.has(cursor) && !seen.has(cursor) && level < 20) {
      seen.add(cursor);
      cursor = byId.get(cursor)!.managerRef;
      level += 1;
    }
    return level;
  };
  return active
    .map((e) => ({
      employee: e.id,
      name: e.name,
      role: e.role,
      level: levelOf(e),
      directReports: reportCounts.get(e.id) ?? 0,
    }))
    .sort((a, b) => a.level - b.level || b.directReports - a.directReports || a.name.localeCompare(b.name));
}

/** One employee's line on a payroll run. */
export interface PayrollLine {
  employee: string;
  name: string;
  monthlySalary: number;
}

export interface PayrollRunResult {
  lines: PayrollLine[];
  employeeCount: number;
  totalGross: number;
  /** Active employees with no positive salary — unpaid by this run, stated. */
  unsalariedCount: number;
}

/** Gather the run: every ACTIVE employee with a positive monthly salary. */
export function derivePayrollRun(employees: Employee[]): PayrollRunResult {
  const active = employees.filter((e) => !e.exitedAt);
  const lines = active
    .filter((e) => e.monthlySalary > 0)
    .map((e) => ({ employee: e.id, name: e.name, monthlySalary: e.monthlySalary }))
    .sort((a, b) => b.monthlySalary - a.monthlySalary || a.name.localeCompare(b.name));
  return {
    lines,
    employeeCount: lines.length,
    totalGross: round2(lines.reduce((s, l) => s + l.monthlySalary, 0)),
    unsalariedCount: active.length - lines.length,
  };
}

/** The deterministic idempotency key of a payroll accrual. */
export function payrollEntryNumber(periodKey: string): string {
  return `JE-PAYROLL-${periodKey}`;
}

/** The balanced accrual lines: Dr Salaries Expense / Cr Salaries Payable. */
export function payrollAccrualLines(totalGross: number): GlJournalLine[] {
  return [
    { account: PAYROLL_EXPENSE_ACCOUNT.code, debit: round2(totalGross), credit: 0 },
    { account: PAYROLL_LIABILITY_ACCOUNT.code, debit: 0, credit: round2(totalGross) },
  ];
}
