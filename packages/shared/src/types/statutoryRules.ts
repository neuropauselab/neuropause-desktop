/**
 * HR → Statutory Rules — effective-dated Indian statutory rule tables + pure
 * calculators (W6-A2). "Never hardcode rates" is enforced STRUCTURALLY:
 * every calculator takes a rule set as input; rule sets live as effective-dated
 * RECORDS (audited, RBAC'd, immutable once locked); the verified defaults
 * below are SEED DATA applied only through an explicit, audited module action
 * — never silently, never inside a formula.
 *
 * Seed values verified 2026-08-06 against current sources (stamped into
 * `sourceNote` on seeding):
 * - EPF: employee 12%, employer 12% (EPS 8.33% on wages capped at ₹15,000 —
 *   the ₹21,000 ceiling hike is POSTPONED, ceiling stays ₹15,000), EDLI 0.5%
 *   + admin 0.5% on the capped base. (taxfetchindia.com, 2026)
 * - ESI: employee 0.75% / employer 3.25% of gross, eligibility ≤ ₹21,000
 *   (₹25,000 disability), unchanged since 01-Jul-2019; paise round UP to the
 *   next rupee. (tallysolutions.com, 2026)
 * - Professional Tax: STATE-legislated. Gujarat seeded: ≤ ₹12,000 nil, above
 *   ₹200/month. The table is multi-state by design (per-slab `februaryPerMonth`
 *   exists so Maharashtra's ₹300 February fits without schema change). (simpliance.in)
 * - TDS (new regime FY 2026-27, unchanged by Budget 2026): 0–4L nil, 4–8L 5%,
 *   8–12L 10%, 12–16L 15%, 16–20L 20%, 20–24L 25%, >24L 30%; standard
 *   deduction ₹75,000; §87A rebate ₹60,000 to ₹12L income with marginal
 *   relief above; 4% health & education cess; §288B rounds annual tax to the
 *   nearest ₹10. (cleartax.in)
 *
 * Pure (no I/O), so it is shared by the backend hooks and the tests.
 */
import type { EnterpriseEntity } from './enterpriseModule';

/** The Statutory Rules module id + record kind (the framework store key). */
export const STATUTORY_RULES_MODULE_ID = 'hr-statutory-rules';
export const STATUTORY_RULE_KIND = 'statutoryRuleSet';

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}
const round2 = (n: number): number => Math.round(n * 100) / 100;
/** EPF convention: component amounts round to the nearest rupee. */
const roundRupee = (n: number): number => Math.round(n);
/** ESI convention: paise round UP to the next rupee. */
const roundUpRupee = (n: number): number => Math.ceil(round2(n));
/** §288B: annual income tax rounds to the nearest ₹10. */
const round10 = (n: number): number => Math.round(n / 10) * 10;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const pct = (v: unknown): boolean => isNum(v) && v >= 0 && v <= 100;

// ---------------------------------------------------------------------------
// PF (Employees' Provident Fund)
// ---------------------------------------------------------------------------

export interface PfRules {
  employeeRatePct: number;
  /** Employer's total statutory rate; EPS is carved out of it. */
  employerTotalRatePct: number;
  /** EPS share — ALWAYS computed on wages capped at the ceiling. */
  employerEpsRatePct: number;
  wageCeilingMonthly: number;
  /** EDLI + admin are always on the CAPPED base (statutory ceilings). */
  edliRatePct: number;
  adminRatePct: number;
  /** true → employee/employer shares also compute on the capped base. */
  restrictToCeiling: boolean;
}

export function parsePfRules(raw: unknown): { rules: PfRules | null; errors: string[] } {
  const errors: string[] = [];
  let o: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(str(raw) || 'null');
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { rules: null, errors: ['PF rules must be one JSON object.'] };
    }
    o = parsed as Record<string, unknown>;
  } catch {
    return { rules: null, errors: ['PF rules are not valid JSON.'] };
  }
  if (!pct(o.employeeRatePct)) errors.push('PF employeeRatePct must be 0–100.');
  if (!pct(o.employerTotalRatePct)) errors.push('PF employerTotalRatePct must be 0–100.');
  if (!pct(o.employerEpsRatePct)) errors.push('PF employerEpsRatePct must be 0–100.');
  else if (isNum(o.employerTotalRatePct) && (o.employerEpsRatePct as number) > (o.employerTotalRatePct as number)) {
    errors.push('PF employerEpsRatePct cannot exceed employerTotalRatePct.');
  }
  if (!isNum(o.wageCeilingMonthly) || o.wageCeilingMonthly <= 0) errors.push('PF wageCeilingMonthly must be > 0.');
  if (!pct(o.edliRatePct)) errors.push('PF edliRatePct must be 0–100.');
  if (!pct(o.adminRatePct)) errors.push('PF adminRatePct must be 0–100.');
  if (typeof o.restrictToCeiling !== 'boolean') errors.push('PF restrictToCeiling must be true or false.');
  if (errors.length > 0) return { rules: null, errors };
  return {
    rules: {
      employeeRatePct: o.employeeRatePct as number,
      employerTotalRatePct: o.employerTotalRatePct as number,
      employerEpsRatePct: o.employerEpsRatePct as number,
      wageCeilingMonthly: o.wageCeilingMonthly as number,
      edliRatePct: o.edliRatePct as number,
      adminRatePct: o.adminRatePct as number,
      restrictToCeiling: o.restrictToCeiling as boolean,
    },
    errors: [],
  };
}

export interface PfResult {
  /** The base employee/employer shares computed on (capped when restricted). */
  contributionBase: number;
  /** The capped base EPS/EDLI/admin ALWAYS compute on. */
  cappedBase: number;
  employee: number;
  employerEps: number;
  employerEpf: number;
  edli: number;
  admin: number;
  employerTotal: number;
}

/** PF on one month's PF wages — rupee-rounded per EPFO convention. */
export function calculatePf(rules: PfRules, pfWageMonthly: number): PfResult {
  const wage = Math.max(0, pfWageMonthly);
  const cappedBase = Math.min(wage, rules.wageCeilingMonthly);
  const contributionBase = rules.restrictToCeiling ? cappedBase : wage;
  const employee = roundRupee((contributionBase * rules.employeeRatePct) / 100);
  const employerGross = roundRupee((contributionBase * rules.employerTotalRatePct) / 100);
  const employerEps = roundRupee((cappedBase * rules.employerEpsRatePct) / 100);
  const employerEpf = Math.max(0, employerGross - employerEps);
  const edli = roundRupee((cappedBase * rules.edliRatePct) / 100);
  const admin = roundRupee((cappedBase * rules.adminRatePct) / 100);
  return {
    contributionBase,
    cappedBase,
    employee,
    employerEps,
    employerEpf,
    edli,
    admin,
    employerTotal: employerEps + employerEpf,
  };
}

// ---------------------------------------------------------------------------
// ESI (Employees' State Insurance)
// ---------------------------------------------------------------------------

export interface EsiRules {
  employeeRatePct: number;
  employerRatePct: number;
  grossCeilingMonthly: number;
  disabilityCeilingMonthly: number;
}

export function parseEsiRules(raw: unknown): { rules: EsiRules | null; errors: string[] } {
  const errors: string[] = [];
  let o: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(str(raw) || 'null');
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { rules: null, errors: ['ESI rules must be one JSON object.'] };
    }
    o = parsed as Record<string, unknown>;
  } catch {
    return { rules: null, errors: ['ESI rules are not valid JSON.'] };
  }
  if (!pct(o.employeeRatePct)) errors.push('ESI employeeRatePct must be 0–100.');
  if (!pct(o.employerRatePct)) errors.push('ESI employerRatePct must be 0–100.');
  if (!isNum(o.grossCeilingMonthly) || o.grossCeilingMonthly <= 0) errors.push('ESI grossCeilingMonthly must be > 0.');
  if (!isNum(o.disabilityCeilingMonthly) || o.disabilityCeilingMonthly < (isNum(o.grossCeilingMonthly) ? (o.grossCeilingMonthly as number) : 0)) {
    errors.push('ESI disabilityCeilingMonthly must be ≥ grossCeilingMonthly.');
  }
  if (errors.length > 0) return { rules: null, errors };
  return {
    rules: {
      employeeRatePct: o.employeeRatePct as number,
      employerRatePct: o.employerRatePct as number,
      grossCeilingMonthly: o.grossCeilingMonthly as number,
      disabilityCeilingMonthly: o.disabilityCeilingMonthly as number,
    },
    errors: [],
  };
}

export interface EsiResult {
  eligible: boolean;
  employee: number;
  employer: number;
}

/** ESI on one month's gross — eligibility by ceiling, paise rounded UP. */
export function calculateEsi(rules: EsiRules, grossMonthly: number, disabled = false): EsiResult {
  const gross = Math.max(0, grossMonthly);
  const ceiling = disabled ? rules.disabilityCeilingMonthly : rules.grossCeilingMonthly;
  if (gross <= 0 || gross > ceiling) return { eligible: false, employee: 0, employer: 0 };
  return {
    eligible: true,
    employee: roundUpRupee((gross * rules.employeeRatePct) / 100),
    employer: roundUpRupee((gross * rules.employerRatePct) / 100),
  };
}

// ---------------------------------------------------------------------------
// Professional Tax (state-legislated)
// ---------------------------------------------------------------------------

export interface PtSlab {
  /** Upper bound of monthly gross for this slab; null = open-ended top slab. */
  uptoMonthly: number | null;
  perMonth: number;
  /** Some states (e.g. Maharashtra) charge a different February amount FOR A SLAB. */
  februaryPerMonth: number | null;
}

export interface PtStateRules {
  /** State code, e.g. GJ, MH. */
  state: string;
  slabs: PtSlab[];
}

export function parsePtRules(raw: unknown): { rules: PtStateRules[] | null; errors: string[] } {
  const errors: string[] = [];
  let arr: unknown;
  try {
    arr = JSON.parse(str(raw) || 'null');
  } catch {
    return { rules: null, errors: ['PT rules are not valid JSON.'] };
  }
  if (!Array.isArray(arr)) return { rules: null, errors: ['PT rules must be a JSON array of state entries.'] };
  const out: PtStateRules[] = [];
  const seen = new Set<string>();
  arr.forEach((entry, index) => {
    const at = `PT state entry ${index + 1}`;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      errors.push(`${at}: must be a JSON object.`);
      return;
    }
    const o = entry as Record<string, unknown>;
    const state = str(o.state).trim().toUpperCase();
    if (state.length < 2) errors.push(`${at}: "state" must be a state code (e.g. GJ).`);
    else if (seen.has(state)) errors.push(`${at}: duplicate state "${state}".`);
    const slabsRaw = o.slabs;
    const slabs: PtSlab[] = [];
    if (!Array.isArray(slabsRaw) || slabsRaw.length === 0) {
      errors.push(`${at}: "slabs" must be a non-empty array.`);
    } else {
      let prevUpto = 0;
      slabsRaw.forEach((s, slabIndex) => {
        const sat = `${at}, slab ${slabIndex + 1}`;
        if (typeof s !== 'object' || s === null) {
          errors.push(`${sat}: must be an object.`);
          return;
        }
        const so = s as Record<string, unknown>;
        const last = slabIndex === slabsRaw.length - 1;
        const upto = so.uptoMonthly;
        if (last) {
          if (upto !== null) errors.push(`${sat}: the final slab must have "uptoMonthly": null (open-ended).`);
        } else if (!isNum(upto) || upto <= prevUpto) {
          errors.push(`${sat}: "uptoMonthly" must be a number greater than the previous slab.`);
        } else {
          prevUpto = upto;
        }
        if (!isNum(so.perMonth) || so.perMonth < 0) errors.push(`${sat}: "perMonth" must be a number ≥ 0.`);
        const feb = so.februaryPerMonth;
        if (feb !== undefined && feb !== null && (!isNum(feb) || feb < 0)) {
          errors.push(`${sat}: "februaryPerMonth" must be null or a number ≥ 0.`);
        }
        slabs.push({
          uptoMonthly: isNum(upto) ? upto : null,
          perMonth: isNum(so.perMonth) ? so.perMonth : 0,
          februaryPerMonth: isNum(feb) ? feb : null,
        });
      });
    }
    if (state.length >= 2 && !seen.has(state)) {
      seen.add(state);
      out.push({ state, slabs });
    }
  });
  if (errors.length > 0) return { rules: null, errors };
  return { rules: out, errors: [] };
}

export interface PtResult {
  /** false when the employee's state has no PT table — the caller must refuse, not zero. */
  stateFound: boolean;
  amount: number;
}

/** Professional tax for one month (1–12) in one state — never a silent zero. */
export function calculatePt(rules: PtStateRules[], state: string, grossMonthly: number, month: number): PtResult {
  const entry = rules.find((r) => r.state === str(state).trim().toUpperCase());
  if (!entry) return { stateFound: false, amount: 0 };
  const gross = Math.max(0, grossMonthly);
  for (const slab of entry.slabs) {
    if (slab.uptoMonthly === null || gross <= slab.uptoMonthly) {
      const amount = month === 2 && slab.februaryPerMonth !== null ? slab.februaryPerMonth : slab.perMonth;
      return { stateFound: true, amount };
    }
  }
  return { stateFound: true, amount: 0 };
}

// ---------------------------------------------------------------------------
// TDS on salary (new regime)
// ---------------------------------------------------------------------------

export interface TdsSlab {
  /** Upper bound of annual taxable income; null = open-ended top slab. */
  uptoAnnual: number | null;
  ratePct: number;
}

export interface TdsRules {
  slabs: TdsSlab[];
  standardDeduction: number;
  rebateMax: number;
  rebateIncomeLimit: number;
  marginalRelief: boolean;
  cessPct: number;
}

export function parseTdsRules(raw: unknown): { rules: TdsRules | null; errors: string[] } {
  const errors: string[] = [];
  let o: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(str(raw) || 'null');
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { rules: null, errors: ['TDS rules must be one JSON object.'] };
    }
    o = parsed as Record<string, unknown>;
  } catch {
    return { rules: null, errors: ['TDS rules are not valid JSON.'] };
  }
  const slabsRaw = o.slabs;
  const slabs: TdsSlab[] = [];
  if (!Array.isArray(slabsRaw) || slabsRaw.length === 0) {
    errors.push('TDS "slabs" must be a non-empty array.');
  } else {
    let prevUpto = 0;
    slabsRaw.forEach((s, index) => {
      const at = `TDS slab ${index + 1}`;
      if (typeof s !== 'object' || s === null) {
        errors.push(`${at}: must be an object.`);
        return;
      }
      const so = s as Record<string, unknown>;
      const last = index === slabsRaw.length - 1;
      const upto = so.uptoAnnual;
      if (last) {
        if (upto !== null) errors.push(`${at}: the final slab must have "uptoAnnual": null (open-ended).`);
      } else if (!isNum(upto) || upto <= prevUpto) {
        errors.push(`${at}: "uptoAnnual" must be a number greater than the previous slab.`);
      } else {
        prevUpto = upto;
      }
      if (!pct(so.ratePct)) errors.push(`${at}: "ratePct" must be 0–100.`);
      slabs.push({ uptoAnnual: isNum(upto) ? upto : null, ratePct: pct(so.ratePct) ? (so.ratePct as number) : 0 });
    });
  }
  if (!isNum(o.standardDeduction) || o.standardDeduction < 0) errors.push('TDS standardDeduction must be ≥ 0.');
  if (!isNum(o.rebateMax) || o.rebateMax < 0) errors.push('TDS rebateMax must be ≥ 0.');
  if (!isNum(o.rebateIncomeLimit) || o.rebateIncomeLimit < 0) errors.push('TDS rebateIncomeLimit must be ≥ 0.');
  if (typeof o.marginalRelief !== 'boolean') errors.push('TDS marginalRelief must be true or false.');
  if (!pct(o.cessPct)) errors.push('TDS cessPct must be 0–100.');
  if (errors.length > 0) return { rules: null, errors };
  return {
    rules: {
      slabs,
      standardDeduction: o.standardDeduction as number,
      rebateMax: o.rebateMax as number,
      rebateIncomeLimit: o.rebateIncomeLimit as number,
      marginalRelief: o.marginalRelief as boolean,
      cessPct: o.cessPct as number,
    },
    errors: [],
  };
}

export interface TdsResult {
  annualGross: number;
  standardDeduction: number;
  annualTaxable: number;
  slabTax: number;
  rebateApplied: number;
  marginalReliefApplied: boolean;
  taxAfterRebate: number;
  cess: number;
  /** §288B-rounded annual tax including cess. */
  annualTax: number;
  monthlyTds: number;
}

/**
 * Annual TDS on salary under the configured regime slabs: standard deduction,
 * slab walk, §87A rebate with marginal relief just above the limit, cess,
 * §288B rounding, and a flat monthly deduction (annual ÷ 12, rupee-rounded).
 */
export function calculateAnnualTds(rules: TdsRules, annualGrossSalary: number): TdsResult {
  const annualGross = Math.max(0, annualGrossSalary);
  const standardDeduction = Math.min(annualGross, rules.standardDeduction);
  const taxable = Math.max(0, annualGross - standardDeduction);
  let slabTax = 0;
  let lower = 0;
  for (const slab of rules.slabs) {
    const upper = slab.uptoAnnual === null ? taxable : Math.min(slab.uptoAnnual, taxable);
    if (upper > lower) slabTax += ((upper - lower) * slab.ratePct) / 100;
    if (slab.uptoAnnual === null || taxable <= slab.uptoAnnual) break;
    lower = slab.uptoAnnual;
  }
  slabTax = round2(slabTax);
  let taxAfterRebate = slabTax;
  let rebateApplied = 0;
  let marginalReliefApplied = false;
  if (taxable <= rules.rebateIncomeLimit) {
    rebateApplied = Math.min(slabTax, rules.rebateMax);
    taxAfterRebate = round2(slabTax - rebateApplied);
  } else if (rules.marginalRelief) {
    const excess = taxable - rules.rebateIncomeLimit;
    if (slabTax > excess) {
      taxAfterRebate = round2(excess);
      marginalReliefApplied = true;
    }
  }
  const cess = round2((taxAfterRebate * rules.cessPct) / 100);
  const annualTax = round10(taxAfterRebate + cess);
  return {
    annualGross,
    standardDeduction,
    annualTaxable: taxable,
    slabTax,
    rebateApplied,
    marginalReliefApplied,
    taxAfterRebate,
    cess,
    annualTax,
    monthlyTds: roundRupee(annualTax / 12),
  };
}

// ---------------------------------------------------------------------------
// Rule-set records: typed view, resolution by period, verified seed data
// ---------------------------------------------------------------------------

/** A fully parsed, usable rule set (every domain valid). */
export interface StatutoryRuleSet {
  recordId: string;
  ruleSetCode: string;
  effectiveFrom: string;
  pf: PfRules;
  esi: EsiRules;
  pt: PtStateRules[];
  tds: TdsRules;
  lockedAt: string | null;
}

export interface StatutoryResolution {
  ruleSet: StatutoryRuleSet | null;
  /** Non-empty when the winning record exists but fails to parse — REFUSE, never zero. */
  errors: string[];
}

/** Parse every domain of one record; errors aggregated with domain prefixes. */
export function statutoryRuleSetFromRecord(record: EnterpriseEntity): { ruleSet: StatutoryRuleSet | null; errors: string[] } {
  const f = record.fields;
  const pf = parsePfRules(f.pfJson);
  const esi = parseEsiRules(f.esiJson);
  const pt = parsePtRules(f.ptJson);
  const tds = parseTdsRules(f.tdsJson);
  const errors = [...pf.errors, ...esi.errors, ...pt.errors, ...tds.errors];
  if (!str(f.effectiveFrom)) errors.push('effectiveFrom is required.');
  if (errors.length > 0 || !pf.rules || !esi.rules || !pt.rules || !tds.rules) return { ruleSet: null, errors };
  return {
    ruleSet: {
      recordId: record.id,
      ruleSetCode: str(f.ruleSetCode) || record.title,
      effectiveFrom: str(f.effectiveFrom),
      pf: pf.rules,
      esi: esi.rules,
      pt: pt.rules,
      tds: tds.rules,
      lockedAt: str(f.lockedAt) || null,
    },
    errors: [],
  };
}

/**
 * Resolve the rule set governing a payroll period (`YYYY-MM`): the record
 * with the LATEST effectiveFrom on or before the period's first day. A
 * winning record that fails to parse surfaces its errors — processing must
 * refuse; silently computing zero statutory would be a lie.
 */
export function resolveStatutoryRuleSet(records: EnterpriseEntity[], periodKey: string): StatutoryResolution {
  const periodStart = `${periodKey}-01`;
  const candidates = records
    .filter((r) => r.status !== 'deleted' && str(r.fields.effectiveFrom) && str(r.fields.effectiveFrom) <= periodStart)
    .sort((a, b) =>
      str(b.fields.effectiveFrom).localeCompare(str(a.fields.effectiveFrom)) ||
      str(b.fields.ruleSetCode).localeCompare(str(a.fields.ruleSetCode)),
    );
  if (candidates.length === 0) return { ruleSet: null, errors: [] };
  return statutoryRuleSetFromRecord(candidates[0]);
}

/**
 * The verified seed (sources + dates in the header comment above) — applied
 * ONLY via the module's explicit, audited `seedDefaults` action.
 */
export const DEFAULT_STATUTORY_RULE_SET = {
  ruleSetCode: 'IN-FY2026-27',
  effectiveFrom: '2026-04-01',
  pfJson: JSON.stringify({
    employeeRatePct: 12,
    employerTotalRatePct: 12,
    employerEpsRatePct: 8.33,
    wageCeilingMonthly: 15000,
    edliRatePct: 0.5,
    adminRatePct: 0.5,
    restrictToCeiling: true,
  }),
  esiJson: JSON.stringify({
    employeeRatePct: 0.75,
    employerRatePct: 3.25,
    grossCeilingMonthly: 21000,
    disabilityCeilingMonthly: 25000,
  }),
  ptJson: JSON.stringify([
    { state: 'GJ', slabs: [{ uptoMonthly: 12000, perMonth: 0 }, { uptoMonthly: null, perMonth: 200 }] },
  ]),
  tdsJson: JSON.stringify({
    slabs: [
      { uptoAnnual: 400000, ratePct: 0 },
      { uptoAnnual: 800000, ratePct: 5 },
      { uptoAnnual: 1200000, ratePct: 10 },
      { uptoAnnual: 1600000, ratePct: 15 },
      { uptoAnnual: 2000000, ratePct: 20 },
      { uptoAnnual: 2400000, ratePct: 25 },
      { uptoAnnual: null, ratePct: 30 },
    ],
    standardDeduction: 75000,
    rebateMax: 60000,
    rebateIncomeLimit: 1200000,
    marginalRelief: true,
    cessPct: 4,
  }),
  sourceNote:
    'Verified 2026-08-06: EPF ceiling ₹15,000 — ₹21,000 hike postponed (taxfetchindia.com); ESI 0.75%/3.25%, ceiling ₹21,000/₹25,000 disability, unchanged since 01-Jul-2019 (tallysolutions.com); Gujarat PT nil ≤ ₹12,000 else ₹200/month (simpliance.in); FY 2026-27 new-regime slabs, ₹75,000 standard deduction, §87A ₹60,000 to ₹12L, 4% cess — Budget 2026 made no slab changes (cleartax.in).',
} as const;
