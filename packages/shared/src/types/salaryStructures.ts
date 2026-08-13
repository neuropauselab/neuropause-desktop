/**
 * HR → Salary Structures — contractual pay-template domain types + the pure
 * breakup engine (W6-A1, the first Production Readiness increment).
 *
 * A salary structure is a NAMED TEMPLATE of contractual components: earnings
 * (allowances) and non-statutory deductions, each either a fixed amount or a
 * percent of the employee's basic. BASIC itself is IMPLICIT — always the
 * first earning line, scaled from the employee's own `basicSalary` — so the
 * same template serves every pay grade. Statutory deductions (PF, ESI,
 * Professional Tax, TDS) are NOT structure components: they are COMPUTED by
 * the effective-dated statutory engine, which reads the wage BASES this
 * engine derives per component flags (`pfWage`, `esiWage`, `taxable`).
 * Never hardcoded rates — that is the W6 mandate, enforced by design here.
 *
 * Component lists use the certified JSON-per-line format (the RFQ quote
 * precedent): validated line by line with line-numbered errors, duplicate
 * codes refused, the reserved BASIC code refused, wage-base flags refused on
 * deductions (they apply to earnings only — silent coercion would lie).
 *
 * Pure (no I/O), so it is shared by the backend hooks and the tests.
 */
import type { EnterpriseEntity } from './enterpriseModule';

/** The Salary Structures module id + record kind (the framework store key). */
export const SALARY_STRUCTURES_MODULE_ID = 'hr-salary-structures';
export const SALARY_STRUCTURE_KIND = 'salaryStructure';

/** BASIC is implicit — always emitted first, never declared as a component. */
export const BASIC_COMPONENT_CODE = 'BASIC';
/** Sanity bound on template size (a real CTC sheet is far smaller). */
export const MAX_SALARY_COMPONENTS = 30;
/** Sanity bound on percent-of-basic values (DA in public scales can exceed 100). */
export const MAX_PERCENT_OF_BASIC = 500;

export type SalaryComponentKind = 'earning' | 'deduction';
export type SalaryComponentCalc = 'fixed' | 'percentOfBasic';

/** One contractual component of a salary structure. */
export interface SalaryComponent {
  /** Stable uppercase code, e.g. HRA, CONV, LTA. BASIC is reserved. */
  code: string;
  name: string;
  kind: SalaryComponentKind;
  calc: SalaryComponentCalc;
  /** Amount for `fixed`; percent (of basic) for `percentOfBasic`. */
  value: number;
  /** Counts toward the PF wage base (basic + DA-like earnings; default false). */
  pfWage: boolean;
  /** Counts toward the ESI gross-wage base (default true for earnings). */
  esiWage: boolean;
  /** Counts toward taxable income for TDS (default true for earnings). */
  taxable: boolean;
}

export interface SalaryComponentParse {
  components: SalaryComponent[];
  /** Line-numbered problems — empty means every line parsed and validated. */
  errors: string[];
}

/** A typed view over a salary-structure record's flat fields. */
export interface SalaryStructure {
  id: string;
  structureCode: string;
  structureName: string;
  referenceBasic: number;
  components: SalaryComponent[];
  /** Non-empty only when stored JSON is invalid (legacy/hand-edited data). */
  parseErrors: string[];
  archivedAt: string | null;
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

/**
 * Parse the JSON-per-line component list (the RFQ precedent): every line one
 * JSON object, validated independently, problems reported by line number.
 */
export function parseSalaryComponents(raw: unknown): SalaryComponentParse {
  const text = str(raw).trim();
  if (!text) return { components: [], errors: [] };
  const lines = text
    .split('\n')
    .map((line, index) => ({ line: line.trim(), lineNo: index + 1 }))
    .filter((l) => l.line.length > 0);
  const errors: string[] = [];
  const components: SalaryComponent[] = [];
  if (lines.length > MAX_SALARY_COMPONENTS) {
    return { components: [], errors: [`At most ${MAX_SALARY_COMPONENTS} components per structure (got ${lines.length}).`] };
  }
  const seen = new Set<string>();
  for (const { line, lineNo } of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      errors.push(`Line ${lineNo}: not valid JSON.`);
      continue;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      errors.push(`Line ${lineNo}: each line must be one JSON object.`);
      continue;
    }
    const o = parsed as Record<string, unknown>;
    const code = str(o.code).trim().toUpperCase();
    const name = str(o.name).trim();
    const kind = str(o.kind);
    const calc = str(o.calc);
    const value = o.value;
    const lineErrors: string[] = [];
    if (!code) lineErrors.push('"code" is required');
    else if (code === BASIC_COMPONENT_CODE) lineErrors.push(`"${BASIC_COMPONENT_CODE}" is reserved — basic is implicit`);
    else if (seen.has(code)) lineErrors.push(`duplicate code "${code}"`);
    if (!name) lineErrors.push('"name" is required');
    if (kind !== 'earning' && kind !== 'deduction') lineErrors.push('"kind" must be "earning" or "deduction"');
    if (calc !== 'fixed' && calc !== 'percentOfBasic') lineErrors.push('"calc" must be "fixed" or "percentOfBasic"');
    const n = typeof value === 'number' ? value : Number.NaN;
    if (!Number.isFinite(n) || n < 0) lineErrors.push('"value" must be a number ≥ 0');
    else if (calc === 'percentOfBasic' && n > MAX_PERCENT_OF_BASIC) {
      lineErrors.push(`percent of basic is capped at ${MAX_PERCENT_OF_BASIC}`);
    }
    for (const flag of ['pfWage', 'esiWage', 'taxable'] as const) {
      if (o[flag] !== undefined && typeof o[flag] !== 'boolean') lineErrors.push(`"${flag}" must be true or false`);
    }
    const isEarning = kind === 'earning';
    if (!isEarning && kind === 'deduction') {
      for (const flag of ['pfWage', 'esiWage', 'taxable'] as const) {
        if (o[flag] === true) lineErrors.push(`"${flag}" applies to earnings only`);
      }
    }
    if (lineErrors.length > 0) {
      errors.push(`Line ${lineNo}: ${lineErrors.join('; ')}.`);
      continue;
    }
    seen.add(code);
    components.push({
      code,
      name,
      kind: kind as SalaryComponentKind,
      calc: calc as SalaryComponentCalc,
      value: round2(n),
      pfWage: isEarning ? o.pfWage === true : false,
      esiWage: isEarning ? o.esiWage !== false : false,
      taxable: isEarning ? o.taxable !== false : false,
    });
  }
  return { components, errors };
}

/** One computed line of a monthly breakup. */
export interface SalaryBreakupLine {
  code: string;
  name: string;
  kind: SalaryComponentKind;
  amount: number;
}

export interface SalaryBreakup {
  /** BASIC first, then earnings in template order, then deductions. */
  lines: SalaryBreakupLine[];
  grossEarnings: number;
  totalDeductions: number;
  /** Gross minus contractual deductions — BEFORE statutory deductions. */
  netPay: number;
  /** Wage bases the statutory engine reads (BASIC always counts in all three). */
  pfWageBase: number;
  esiWageBase: number;
  taxableBase: number;
}

/**
 * The pure breakup engine: scale the template from one employee's basic.
 * Deterministic — fixed amounts as declared, percents of basic, all round2.
 * A negative basic is clamped to 0 (the validator refuses it upstream).
 */
export function computeSalaryBreakup(components: SalaryComponent[], basic: number): SalaryBreakup {
  const base = round2(Math.max(0, num(basic)));
  const amountOf = (c: SalaryComponent): number =>
    c.calc === 'fixed' ? round2(c.value) : round2((base * c.value) / 100);
  const earnings = components.filter((c) => c.kind === 'earning');
  const deductions = components.filter((c) => c.kind === 'deduction');
  const lines: SalaryBreakupLine[] = [
    { code: BASIC_COMPONENT_CODE, name: 'Basic', kind: 'earning', amount: base },
    ...earnings.map((c) => ({ code: c.code, name: c.name, kind: c.kind, amount: amountOf(c) })),
    ...deductions.map((c) => ({ code: c.code, name: c.name, kind: c.kind, amount: amountOf(c) })),
  ];
  const grossEarnings = round2(base + earnings.reduce((s, c) => s + amountOf(c), 0));
  const totalDeductions = round2(deductions.reduce((s, c) => s + amountOf(c), 0));
  const baseOf = (flag: 'pfWage' | 'esiWage' | 'taxable'): number =>
    round2(base + earnings.filter((c) => c[flag]).reduce((s, c) => s + amountOf(c), 0));
  return {
    lines,
    grossEarnings,
    totalDeductions,
    netPay: round2(grossEarnings - totalDeductions),
    pfWageBase: baseOf('pfWage'),
    esiWageBase: baseOf('esiWage'),
    taxableBase: baseOf('taxable'),
  };
}

/** Project a framework record into a typed salary structure. */
export function salaryStructureFromRecord(record: EnterpriseEntity): SalaryStructure {
  const f = record.fields;
  const parsed = parseSalaryComponents(f.componentsJson);
  return {
    id: record.id,
    structureCode: str(f.structureCode) || record.title,
    structureName: str(f.structureName),
    referenceBasic: num(f.referenceBasic),
    components: parsed.components,
    parseErrors: parsed.errors,
    archivedAt: str(f.archivedAt) || null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
