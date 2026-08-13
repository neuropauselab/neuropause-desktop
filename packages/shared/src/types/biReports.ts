/**
 * Executive → BI Report Definitions — the generic aggregation primitive
 * (W5.2), the last piece of the W2–W5 mandate.
 *
 * A report definition is a saved question over ANY registered module's
 * records: count them, or sum a numeric field, optionally grouped by a field
 * and filtered by an exact field match. `Run` resolves the target module at
 * RUNTIME through the action context (unknown modules refused by id, stated),
 * executes the pure engine, and stamps the result + run time onto the
 * definition — a living tool whose every run lands in the framework's audit
 * trail. Rows carry honest nulls: a sum over a non-numeric field counts the
 * unparseable values instead of silently zeroing them.
 *
 * This is BI LITE, stated: saved aggregations over live records. Charting is
 * renderer work; scheduled runs belong to the automation subsystem — named,
 * not faked.
 *
 * Pure (no I/O), so it is shared by the backend hooks and the tests.
 */
import type { EnterpriseEntity } from './enterpriseModule';

/** The BI Report Definitions module id + record kind (the framework store key). */
export const BI_REPORTS_MODULE_ID = 'executive-report-definitions';
export const BI_REPORT_KIND = 'reportDefinition';

export type BiAggregate = 'count' | 'sum';

/** The saved question a definition asks. */
export interface BiReportDefinition {
  reportName: string;
  targetModule: string;
  aggregate: BiAggregate;
  sumField: string;
  groupByField: string;
  filterField: string;
  filterValue: string;
}

/** One row of a report result. */
export interface BiReportRow {
  group: string;
  count: number;
  sum: number;
  /** Values that failed to parse as numbers under a `sum` aggregate. */
  unparseable: number;
}

export interface BiReportResult {
  rows: BiReportRow[];
  totalCount: number;
  totalSum: number;
  totalUnparseable: number;
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The engine: filter → group → aggregate, deterministically. */
export function runBiReport(records: EnterpriseEntity[], def: BiReportDefinition): BiReportResult {
  const filtered = def.filterField
    ? records.filter((r) => str(r.fields[def.filterField]) === def.filterValue)
    : records;
  const groups = new Map<string, BiReportRow>();
  for (const record of filtered) {
    const group = def.groupByField ? str(record.fields[def.groupByField]) || '(blank)' : '(all)';
    const row = groups.get(group) ?? { group, count: 0, sum: 0, unparseable: 0 };
    row.count += 1;
    if (def.aggregate === 'sum') {
      const raw = record.fields[def.sumField];
      const n = typeof raw === 'number' ? raw : Number(str(raw));
      if (Number.isFinite(n)) row.sum = round2(row.sum + n);
      else row.unparseable += 1;
    }
    groups.set(group, row);
  }
  const rows = [...groups.values()].sort(
    (a, b) => b.sum - a.sum || b.count - a.count || a.group.localeCompare(b.group),
  );
  return {
    rows,
    totalCount: rows.reduce((s, r) => s + r.count, 0),
    totalSum: round2(rows.reduce((s, r) => s + r.sum, 0)),
    totalUnparseable: rows.reduce((s, r) => s + r.unparseable, 0),
  };
}
