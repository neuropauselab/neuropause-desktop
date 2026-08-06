/**
 * HR → Statutory Filing Registers — the government-filing DATA derived from a
 * posted period's payroll (W6-A7), closing Workstream A. For one period this
 * builds four datasets, each joining the posted run's computed lines to the
 * employees' statutory identifiers:
 *
 * - PF → ECR: the Electronic Challan-cum-Return. 11 fields in EPFO's fixed
 *   order (UAN, name, gross/EPF/EPS/EDLI wages, EPF/EPS/diff contributions,
 *   NCP days, refund) rendered as delimited text. Field structure + values are
 *   verified; the DELIMITER is CONFIGURABLE (default '#~#') because sources
 *   disagree across ECR versions — confirm against the EPFO portal before the
 *   first filing. NCP days are 0 here (attendance/LOP is not tracked — named).
 * - ESI: per-IP contribution rows (IP number, ESI wages, EE + ER contribution).
 * - PT: the period's professional-tax total + payee count (state-legislated).
 * - TDS → 24Q Annexure I data: per-deductee PAN + monthly TDS. The portal
 *   filing is an FVU produced by Protean's RPU — a specialized format this
 *   platform does NOT emit; the DATA is correct, the FVU export is the named
 *   boundary.
 *
 * Employees missing the required identifier (UAN / IP / PAN) are EXCLUDED from
 * that scheme's rows and COUNTED — a return can't carry a member without their
 * id, and silently dropping them would hide unpaid compliance.
 *
 * Pure (no I/O), so it is shared by the backend hooks and the tests.
 */
import type { StatutoryPayrollRun } from './payrollProcessing';

/** The Statutory Filings module id + record kind (the framework store key). */
export const STATUTORY_FILINGS_MODULE_ID = 'hr-statutory-filings';
export const STATUTORY_FILING_KIND = 'statutoryFiling';

/** The default ECR field delimiter — CONFIGURABLE; confirm against the portal. */
export const DEFAULT_ECR_DELIMITER = '#~#';

/** Identifier format patterns (validated on the employee when present). */
export const UAN_PATTERN = /^\d{12}$/;
export const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const ESIC_IP_PATTERN = /^\d{10,17}$/;

const round2 = (n: number): number => Math.round(n * 100) / 100;
function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/** One employee's statutory identifiers, looked up live at filing time. */
export interface EmployeeStatutoryIds {
  uan: string;
  esicNumber: string;
  pan: string;
}

// ── PF / ECR ────────────────────────────────────────────────────────────────

/** One ECR member row — EPFO's 11 fields, in order. */
export interface EcrRow {
  uan: string;
  name: string;
  grossWages: number;
  epfWages: number;
  epsWages: number;
  edliWages: number;
  epfContribution: number;
  epsContribution: number;
  epfEpsDiff: number;
  ncpDays: number;
  refundOfAdvances: number;
}

export interface EcrDataset {
  rows: EcrRow[];
  missingUan: number;
  totalEpf: number;
  totalEps: number;
  totalEdli: number;
}

/** Build the ECR rows for PF members (statutory lines with a PF wage). */
export function buildEcrRows(
  runs: StatutoryPayrollRun[],
  idsByEmployee: Map<string, EmployeeStatutoryIds>,
): EcrDataset {
  const rows: EcrRow[] = [];
  let missingUan = 0;
  for (const run of runs) {
    for (const line of run.lines) {
      if (line.mode !== 'statutory' || line.pfEmployee <= 0) continue;
      const uan = str(idsByEmployee.get(line.employee)?.uan).trim();
      if (!UAN_PATTERN.test(uan)) {
        missingUan += 1;
        continue;
      }
      rows.push({
        uan,
        name: line.name,
        grossWages: round2(line.gross),
        epfWages: round2(line.pfWageBase),
        epsWages: round2(line.pfCappedBase),
        edliWages: round2(line.pfCappedBase),
        epfContribution: round2(line.pfEmployee),
        epsContribution: round2(line.pfEmployerEps),
        epfEpsDiff: round2(line.pfEmployerEpf),
        ncpDays: 0,
        refundOfAdvances: 0,
      });
    }
  }
  rows.sort((a, b) => a.uan.localeCompare(b.uan));
  return {
    rows,
    missingUan,
    totalEpf: round2(rows.reduce((s, r) => s + r.epfContribution, 0)),
    totalEps: round2(rows.reduce((s, r) => s + r.epsContribution, 0)),
    totalEdli: round2(rows.reduce((s, r) => s + r.epfEpsDiff, 0)),
  };
}

/** Render the ECR text — one line per member, fields joined by the delimiter. */
export function formatEcr(rows: EcrRow[], delimiter: string = DEFAULT_ECR_DELIMITER): string {
  const d = delimiter || DEFAULT_ECR_DELIMITER;
  return rows
    .map((r) =>
      [
        r.uan,
        r.name,
        r.grossWages.toFixed(2),
        r.epfWages.toFixed(2),
        r.epsWages.toFixed(2),
        r.edliWages.toFixed(2),
        r.epfContribution.toFixed(2),
        r.epsContribution.toFixed(2),
        r.epfEpsDiff.toFixed(2),
        String(r.ncpDays),
        r.refundOfAdvances.toFixed(2),
      ].join(d),
    )
    .join('\n');
}

// ── ESI ───────────────────────────────────────────────────────────────────

export interface EsiRow {
  ipNumber: string;
  name: string;
  esiWages: number;
  employeeContribution: number;
  employerContribution: number;
}

export interface EsiDataset {
  rows: EsiRow[];
  missingIp: number;
  totalEmployee: number;
  totalEmployer: number;
}

/** Build ESI rows for ESI-eligible members (needs the IP number). */
export function buildEsiRows(
  runs: StatutoryPayrollRun[],
  idsByEmployee: Map<string, EmployeeStatutoryIds>,
): EsiDataset {
  const rows: EsiRow[] = [];
  let missingIp = 0;
  for (const run of runs) {
    for (const line of run.lines) {
      if (!line.esiEligible || line.esiEmployee <= 0) continue;
      const ip = str(idsByEmployee.get(line.employee)?.esicNumber).trim();
      if (!ESIC_IP_PATTERN.test(ip)) {
        missingIp += 1;
        continue;
      }
      rows.push({
        ipNumber: ip,
        name: line.name,
        esiWages: round2(line.esiWageBase),
        employeeContribution: round2(line.esiEmployee),
        employerContribution: round2(line.esiEmployer),
      });
    }
  }
  rows.sort((a, b) => a.ipNumber.localeCompare(b.ipNumber));
  return {
    rows,
    missingIp,
    totalEmployee: round2(rows.reduce((s, r) => s + r.employeeContribution, 0)),
    totalEmployer: round2(rows.reduce((s, r) => s + r.employerContribution, 0)),
  };
}

// ── Professional Tax ─────────────────────────────────────────────────────────

export interface PtDataset {
  total: number;
  payeeCount: number;
}

/** The period's PT total + count of employees who paid it (state-legislated). */
export function buildPtSummary(runs: StatutoryPayrollRun[]): PtDataset {
  let total = 0;
  let payeeCount = 0;
  for (const run of runs) {
    for (const line of run.lines) {
      if (line.pt > 0) {
        total = round2(total + line.pt);
        payeeCount += 1;
      }
    }
  }
  return { total, payeeCount };
}

// ── TDS / 24Q ────────────────────────────────────────────────────────────────

export interface TdsRow {
  pan: string;
  name: string;
  monthlyTds: number;
}

export interface TdsDataset {
  rows: TdsRow[];
  missingPan: number;
  total: number;
}

/** Build 24Q Annexure-I data for deductees with TDS (needs PAN). */
export function buildTdsRows(
  runs: StatutoryPayrollRun[],
  idsByEmployee: Map<string, EmployeeStatutoryIds>,
): TdsDataset {
  const rows: TdsRow[] = [];
  let missingPan = 0;
  for (const run of runs) {
    for (const line of run.lines) {
      if (line.tdsMonthly <= 0) continue;
      const pan = str(idsByEmployee.get(line.employee)?.pan).trim().toUpperCase();
      if (!PAN_PATTERN.test(pan)) {
        missingPan += 1;
        continue;
      }
      rows.push({ pan, name: line.name, monthlyTds: round2(line.tdsMonthly) });
    }
  }
  rows.sort((a, b) => a.pan.localeCompare(b.pan));
  return {
    rows,
    missingPan,
    total: round2(rows.reduce((s, r) => s + r.monthlyTds, 0)),
  };
}
