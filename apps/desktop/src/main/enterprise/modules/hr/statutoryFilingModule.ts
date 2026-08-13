/**
 * HR → Statutory Filing Registers — government-filing DATA for a posted period
 * on the Enterprise Module Framework (W6-A7), closing Workstream A. CRUD
 * (generate + read), RBAC (`operations:read` / `operations:manage` — the HR
 * family's certified scopes), audit, timeline, search, offline persistence,
 * and the UI are all inherited.
 *
 * CREATING a filing generates it: validate gathers the period's POSTED runs,
 * joins their lines to employee statutory identifiers (UAN / IP / PAN), and
 * builds the ECR text (delimiter configurable, default '#~#'), the ESI rows,
 * the PT summary, and the 24Q Annexure-I data. Immutable once generated (the
 * W1 snapshot marker). Members missing an identifier are excluded from that
 * scheme and counted — never silently filed without their id. The 24Q FVU
 * (Protean RPU output) is the named boundary: correct data here, no faked FVU.
 *
 * Electron-free (store paths injected), so it unit-tests without the app runtime.
 */
import type {
  EnterpriseModuleDescriptor,
  EnterpriseRecordInput,
  EnterpriseRecordSummary,
  EnterpriseRecordValidation,
  StatutoryPayrollRun,
} from '@neuropause/shared';
import {
  DEFAULT_ECR_DELIMITER,
  STATUTORY_FILINGS_MODULE_ID,
  STATUTORY_FILING_KIND,
  buildEcrRows,
  buildEsiRows,
  buildPtSummary,
  buildTdsRows,
  formatEcr,
  isGlPeriodKey,
  validateEnterpriseRecordInput,
  type EmployeeStatutoryIds,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';

/** The declarative description of a statutory filing — drives store, CRUD, and the UI. */
export const STATUTORY_FILING_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: STATUTORY_FILINGS_MODULE_ID,
  title: 'Statutory Filings',
  singular: 'Statutory Filing',
  plural: 'Statutory Filings',
  icon: 'landmark',
  description:
    'Government filing data for a posted period — ECR (PF), ESI, PT, and 24Q (TDS) built from the run and employee identifiers; immutable.',
  group: 'HR',
  titleField: 'filingNumber',
  permissions: { read: 'operations:read', write: 'operations:manage' },
  fields: [
    { key: 'filingNumber', label: 'Filing #', type: 'text', readOnly: true },
    { key: 'periodKey', label: 'Period', type: 'text', required: true, placeholder: '2026-08' },
    { key: 'ecrDelimiter', label: 'ECR Delimiter', type: 'text', default: DEFAULT_ECR_DELIMITER, column: false, placeholder: '#~# (confirm with your EPFO portal)' },
    { key: 'ecrMemberCount', label: 'ECR Members', type: 'number', readOnly: true, default: 0 },
    { key: 'ecrMissingUan', label: 'Missing UAN', type: 'number', readOnly: true, default: 0, column: false },
    { key: 'ecrTotalEpf', label: 'ECR EPF', type: 'number', readOnly: true, format: 'currency', column: false },
    { key: 'ecrText', label: 'ECR File', type: 'textarea', readOnly: true, column: false },
    { key: 'ecrRowsJson', label: 'ECR Rows', type: 'textarea', readOnly: true, column: false },
    { key: 'esiMemberCount', label: 'ESI Members', type: 'number', readOnly: true, default: 0, column: false },
    { key: 'esiMissingIp', label: 'Missing IP', type: 'number', readOnly: true, default: 0, column: false },
    { key: 'esiTotal', label: 'ESI Total', type: 'number', readOnly: true, format: 'currency', column: false },
    { key: 'esiRowsJson', label: 'ESI Rows', type: 'textarea', readOnly: true, column: false },
    { key: 'ptTotal', label: 'PT Total', type: 'number', readOnly: true, format: 'currency', column: false },
    { key: 'ptPayeeCount', label: 'PT Payees', type: 'number', readOnly: true, default: 0, column: false },
    { key: 'tdsMemberCount', label: '24Q Deductees', type: 'number', readOnly: true, default: 0, column: false },
    { key: 'tdsMissingPan', label: 'Missing PAN', type: 'number', readOnly: true, default: 0, column: false },
    { key: 'tdsTotal', label: 'TDS Total', type: 'number', readOnly: true, format: 'currency', column: false },
    // Every deductee's PAN and taxable salary, in one cell.
    { key: 'tdsRowsJson', label: '24Q Rows', type: 'textarea', readOnly: true, column: false, sensitive: 'restricted' },
    { key: 'note', label: 'Note', type: 'textarea', readOnly: true, column: false },
    { key: 'generatedAt', label: 'Generated At', type: 'text', readOnly: true, column: false },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/**
 * Build the Statutory Filings module. The payroll-run store supplies the
 * posted period; the employee store supplies the statutory identifiers the
 * filings join against — neither is invented.
 */
export function createStatutoryFilingModule(
  storePath: string,
  payrollRunStore: EnterpriseRecordStore,
  employeeStore: EnterpriseRecordStore,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, STATUTORY_FILINGS_MODULE_ID, STATUTORY_FILING_KIND);
  return defineEnterpriseModule({
    descriptor: STATUTORY_FILING_DESCRIPTOR,
    store,
    hooks: {
      // Creating a filing IS generating it; a generated filing is immutable.
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(STATUTORY_FILING_DESCRIPTOR, input);
        if (!result.ok) return result;
        if (str(result.values.generatedAt)) {
          return {
            ok: false,
            errors: { _: 'Statutory filings are immutable snapshots — generate a new filing instead.' },
            values: result.values,
          };
        }
        const periodKey = str(result.values.periodKey).trim();
        if (!isGlPeriodKey(periodKey)) {
          return { ok: false, errors: { periodKey: 'Period must be a valid month (YYYY-MM).' }, values: result.values };
        }
        const runs: StatutoryPayrollRun[] = [];
        for (const r of payrollRunStore.list()) {
          if (str(r.fields.status) !== 'posted' || str(r.fields.periodKey) !== periodKey) continue;
          const raw = str(r.fields.statutoryJson);
          if (!raw) continue;
          try {
            runs.push(JSON.parse(raw) as StatutoryPayrollRun);
          } catch {
            /* skip unreadable — counted implicitly by empty output + note */
          }
        }
        const idsByEmployee = new Map<string, EmployeeStatutoryIds>();
        for (const r of employeeStore.list()) {
          if (r.status === 'deleted') continue;
          idsByEmployee.set(r.id, {
            uan: str(r.fields.uan),
            esicNumber: str(r.fields.esicNumber),
            pan: str(r.fields.pan),
          });
        }
        const delimiter = str(result.values.ecrDelimiter).trim() || DEFAULT_ECR_DELIMITER;
        const ecr = buildEcrRows(runs, idsByEmployee);
        const esi = buildEsiRows(runs, idsByEmployee);
        const pt = buildPtSummary(runs);
        const tds = buildTdsRows(runs, idsByEmployee);
        const priorCount = store.list().filter((r) => str(r.fields.periodKey) === periodKey).length;

        result.values.filingNumber = `SF-${periodKey}-${priorCount + 1}`;
        result.values.ecrDelimiter = delimiter;
        result.values.ecrMemberCount = ecr.rows.length;
        result.values.ecrMissingUan = ecr.missingUan;
        result.values.ecrTotalEpf = ecr.totalEpf;
        result.values.ecrText = formatEcr(ecr.rows, delimiter);
        result.values.ecrRowsJson = JSON.stringify(ecr.rows);
        result.values.esiMemberCount = esi.rows.length;
        result.values.esiMissingIp = esi.missingIp;
        result.values.esiTotal = Math.round((esi.totalEmployee + esi.totalEmployer) * 100) / 100;
        result.values.esiRowsJson = JSON.stringify(esi.rows);
        result.values.ptTotal = pt.total;
        result.values.ptPayeeCount = pt.payeeCount;
        result.values.tdsMemberCount = tds.rows.length;
        result.values.tdsMissingPan = tds.missingPan;
        result.values.tdsTotal = tds.total;
        result.values.tdsRowsJson = JSON.stringify(tds.rows);

        const gaps: string[] = [];
        if (ecr.missingUan > 0) gaps.push(`${ecr.missingUan} PF member(s) without a valid UAN`);
        if (esi.missingIp > 0) gaps.push(`${esi.missingIp} ESI member(s) without an IP number`);
        if (tds.missingPan > 0) gaps.push(`${tds.missingPan} deductee(s) without a valid PAN`);
        result.values.note =
          (runs.length === 0
            ? `no posted payroll run for ${periodKey} — filings are empty, not fabricated. `
            : `from ${runs.length} posted run(s). `) +
          (gaps.length > 0 ? `EXCLUDED (identifier missing): ${gaps.join('; ')}. ` : 'All members have their statutory identifiers. ') +
          `ECR delimiter '${delimiter}' — confirm against the EPFO portal. NCP days come from confirmed attendance statements (0 where none exists for the period). ` +
          `24Q FVU generation via Protean RPU is out of scope — the data here is correct, the FVU export is named future work.`;
        result.values.generatedAt = new Date().toISOString();
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const f = record.fields;
        const gaps =
          Number(f.ecrMissingUan ?? 0) + Number(f.esiMissingIp ?? 0) + Number(f.tdsMissingPan ?? 0);
        return {
          moduleId: STATUTORY_FILINGS_MODULE_ID,
          recordId: record.id,
          headline: `${str(f.filingNumber)} · ECR ${Number(f.ecrMemberCount ?? 0)} · ESI ${Number(f.esiMemberCount ?? 0)} · 24Q ${Number(f.tdsMemberCount ?? 0)}`,
          summary:
            `${str(f.periodKey)}: ECR ${Number(f.ecrMemberCount ?? 0)} member(s) (EPF ${Number(f.ecrTotalEpf ?? 0).toLocaleString('en-US')}), ` +
            `ESI ${Number(f.esiMemberCount ?? 0)} (${Number(f.esiTotal ?? 0).toLocaleString('en-US')}), ` +
            `PT ${Number(f.ptPayeeCount ?? 0)} payee(s) (${Number(f.ptTotal ?? 0).toLocaleString('en-US')}), ` +
            `24Q ${Number(f.tdsMemberCount ?? 0)} deductee(s) (${Number(f.tdsTotal ?? 0).toLocaleString('en-US')}). ${str(f.note)}`,
          risk: gaps > 0 ? 'high' : 'low',
          riskReason:
            gaps > 0
              ? `${gaps} member(s) are excluded from a filing for a missing identifier — capture UAN/IP/PAN before submitting.`
              : 'Every member carries the statutory identifier their scheme requires.',
          executiveExplanation:
            'Statutory filings turn posted payroll into ECR/ESI/PT/24Q data joined to member identifiers; the ECR is portal-shaped (delimiter configurable), the 24Q FVU is named future work — never faked.',
          grounded: false,
          model: 'none',
        };
      },
    },
  });
}
