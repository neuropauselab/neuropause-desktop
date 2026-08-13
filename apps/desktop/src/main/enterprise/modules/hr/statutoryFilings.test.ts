import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  JOURNAL_ENTRIES_MODULE_ID,
  LEDGER_ACCOUNTS_MODULE_ID,
  buildEcrRows,
  buildEsiRows,
  buildPtSummary,
  buildTdsRows,
  formatEcr,
  type EmployeeStatutoryIds,
  type EnterpriseEntity,
  type StatutoryPayrollRun,
} from '@neuropause/shared';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';
import { createLedgerAccountModule } from '../finance/ledgerAccountModule';
import { createJournalEntryModule } from '../finance/journalEntryModule';
import { createEmployeeModule } from './employeeModule';
import { createPayrollRunModule } from './payrollRunModule';
import { createSalaryStructureModule } from './salaryStructureModule';
import { createStatutoryFilingModule } from './statutoryFilingModule';
import { createStatutoryRuleModule } from './statutoryRuleModule';

const T0 = '2026-08-06T00:00:00.000Z';

const mkLine = (over: Record<string, unknown>) => ({
  employee: 'e', name: 'N', mode: 'statutory', gross: 0, basic: 0, earnings: [], contractualDeductions: [],
  pfWageBase: 0, pfCappedBase: 0, pfEmployerEps: 0, pfEmployerEpf: 0, esiWageBase: 0,
  pfEmployee: 0, pfEmployerTotal: 0, pfEdli: 0, pfAdmin: 0, esiEligible: false, esiEmployee: 0, esiEmployer: 0,
  pt: 0, ptSkipped: false, tdsMonthly: 0, otherDeductions: 0, netPay: 0, note: '', ...over,
});

describe('Statutory filing builders (pure)', () => {
  it('ECR: 11 fields in EPFO order with the verified 1800/1250/550 split, missing UAN excluded + counted', () => {
    const runs = [{ lines: [
      mkLine({ employee: 'a', name: 'Kinjal', gross: 18000, pfWageBase: 15000, pfCappedBase: 15000, pfEmployee: 1800, pfEmployerEps: 1250, pfEmployerEpf: 550 }),
      mkLine({ employee: 'b', name: 'NoUan', gross: 12000, pfWageBase: 12000, pfCappedBase: 12000, pfEmployee: 1440, pfEmployerEps: 1000, pfEmployerEpf: 440 }),
      mkLine({ employee: 'c', name: 'Flat', mode: 'flat', gross: 90000 }), // not a PF member
    ] }] as unknown as StatutoryPayrollRun[];
    const ids = new Map<string, EmployeeStatutoryIds>([
      ['a', { uan: '100987654321', esicNumber: '', pan: 'ABCDE1234F' }],
      ['b', { uan: '', esicNumber: '', pan: '' }],
    ]);
    const ecr = buildEcrRows(runs, ids);
    expect(ecr.rows).toHaveLength(1);
    expect(ecr.missingUan).toBe(1);
    const [row] = ecr.rows;
    expect([row.grossWages, row.epfWages, row.epsWages, row.edliWages]).toEqual([18000, 15000, 15000, 15000]);
    expect([row.epfContribution, row.epsContribution, row.epfEpsDiff]).toEqual([1800, 1250, 550]);
    expect(ecr.totalEpf).toBe(1800);
    const text = formatEcr(ecr.rows, '#~#');
    expect(text).toBe('100987654321#~#Kinjal#~#18000.00#~#15000.00#~#15000.00#~#15000.00#~#1800.00#~#1250.00#~#550.00#~#0#~#0.00');
    expect(text.split('#~#')).toHaveLength(11); // exactly 11 fields
    // A configurable delimiter renders the same fields differently.
    expect(formatEcr(ecr.rows, '||').split('||')).toHaveLength(11);
  });

  it('ESI includes only eligible members with an IP; PT sums payees; 24Q needs PAN', () => {
    const runs = [{ lines: [
      mkLine({ employee: 'a', name: 'Elig', esiEligible: true, esiWageBase: 10000, esiEmployee: 75, esiEmployer: 325, pt: 200, tdsMonthly: 5000 }),
      mkLine({ employee: 'b', name: 'NoIp', esiEligible: true, esiWageBase: 12000, esiEmployee: 90, esiEmployer: 390, pt: 200, tdsMonthly: 0 }),
      mkLine({ employee: 'c', name: 'NotElig', esiEligible: false, esiEmployee: 0, pt: 0 }),
    ] }] as unknown as StatutoryPayrollRun[];
    const ids = new Map<string, EmployeeStatutoryIds>([
      ['a', { uan: '', esicNumber: '1234567890', pan: 'ABCDE1234F' }],
      ['b', { uan: '', esicNumber: '', pan: '' }],
    ]);
    const esi = buildEsiRows(runs, ids);
    expect(esi.rows.map((r) => r.ipNumber)).toEqual(['1234567890']);
    expect(esi.missingIp).toBe(1); // 'b' eligible but no IP
    expect(esi.totalEmployee).toBe(75);
    const pt = buildPtSummary(runs);
    expect(pt).toEqual({ total: 400, payeeCount: 2 });
    const tds = buildTdsRows(runs, ids);
    expect(tds.rows).toEqual([{ pan: 'ABCDE1234F', name: 'Elig', monthlyTds: 5000 }]);
    expect(tds.total).toBe(5000);
  });
});

describe('Statutory filing module over real stores — closes Workstream A', () => {
  let dir: string;
  let structures: EnterpriseModule;
  let statutory: EnterpriseModule;
  let employees: EnterpriseModule;
  let accounts: EnterpriseModule;
  let journal: EnterpriseModule;
  let runs: EnterpriseModule;
  let filings: EnterpriseModule;
  let ctx: EnterpriseModuleActionContext;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-filing-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    structures = createSalaryStructureModule(join(dir, 'structures.json'));
    statutory = createStatutoryRuleModule(join(dir, 'statutory.json'));
    employees = createEmployeeModule(join(dir, 'employees.json'), structures.store);
    accounts = createLedgerAccountModule(join(dir, 'accounts.json'));
    journal = createJournalEntryModule(join(dir, 'journal.json'), accounts.store);
    runs = createPayrollRunModule(join(dir, 'runs.json'), employees.store, structures.store, statutory.store);
    filings = createStatutoryFilingModule(join(dir, 'filings.json'), runs.store, employees.store);
    await Promise.all([
      structures.store.load(), statutory.store.load(), employees.store.load(),
      accounts.store.load(), journal.store.load(), runs.store.load(), filings.store.load(),
    ]);
    ctx = {
      actor: () => 't@np',
      now: () => T0,
      authorize: () => undefined,
      moduleFor: (id: string) =>
        id === LEDGER_ACCOUNTS_MODULE_ID ? accounts : id === JOURNAL_ENTRIES_MODULE_ID ? journal : null,
      emit: () => undefined,
    };
  });

  afterEach(async () => {
    await Promise.all([
      structures.store.flush(), statutory.store.flush(), employees.store.flush(),
      accounts.store.flush(), journal.store.flush(), runs.store.flush(), filings.store.flush(),
    ]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  const create = (module: EnterpriseModule, fields: Record<string, unknown>, title: string): EnterpriseEntity => {
    const v = module.hooks.validate({ fields });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    return module.store.create({ title, fields: v.values, actor: 't@np', now: T0 });
  };

  it('generates ECR/ESI/PT/24Q data from the posted run and flags missing identifiers, immutably', async () => {
    const std = create(structures, { structureCode: 'STD', structureName: 'Standard', componentsJson: JSON.stringify({ code: 'HRA', name: 'HRA', kind: 'earning', calc: 'percentOfBasic', value: 40 }) }, 'Standard');
    const bare = create(structures, { structureCode: 'BARE', structureName: 'Bare', componentsJson: '' }, 'Bare');
    create(statutory, {}, 'IN-FY2026-27');
    create(employees, { employeeNumber: 'E1', name: 'Kinjal', salaryStructureRef: std.id, basicSalary: 20000, workState: 'GJ', uan: '100987654321', pan: 'ABCDE1234F' }, 'Kinjal');
    create(employees, { employeeNumber: 'E2', name: 'Dishant', salaryStructureRef: bare.id, basicSalary: 10000, workState: 'GJ', uan: '100987654322', esicNumber: '1234567890', pan: 'FGHIJ5678K' }, 'Dishant');
    create(employees, { employeeNumber: 'E3', name: 'Ghost', salaryStructureRef: bare.id, basicSalary: 12000, workState: 'GJ' }, 'Ghost'); // no identifiers
    const rv = runs.hooks.validate({ fields: { periodKey: '2026-08' } });
    if (!rv.ok) throw new Error('unreachable');
    const runRec = runs.store.create({ title: String(rv.values.runNumber), fields: rv.values, actor: 't@np', now: T0 });
    await runs.hooks.runAction!('post', runRec, ctx);
    const filing = create(filings, { periodKey: '2026-08' }, 'filing');
    expect(filing.fields.ecrMemberCount).toBe(2); // Kinjal + Dishant have UAN; Ghost missing
    expect(filing.fields.ecrMissingUan).toBe(1);
    expect(filing.fields.esiMemberCount).toBe(1); // Dishant eligible with IP (Kinjal gross>21k not eligible)
    expect(filing.fields.esiMissingIp).toBe(1); // Ghost eligible (gross 12000) but no IP
    expect(filing.fields.ptTotal).toBe(200); // only Kinjal (gross 28000 > 12000)
    expect(filing.fields.ptPayeeCount).toBe(1);
    expect(filing.fields.tdsMemberCount).toBe(0); // all below the TDS threshold
    expect(String(filing.fields.ecrText)).toContain('100987654321#~#Kinjal');
    expect(String(filing.fields.note)).toContain('FVU');
    expect(String(filing.fields.generatedAt).length).toBeGreaterThan(0);
    const summary = await filings.hooks.summarize!(filings.store.get(filing.id)!);
    expect(summary.risk).toBe('high'); // identifier gaps present
    // Immutable.
    expect(filings.hooks.validate({ fields: { ...filing.fields, ecrMemberCount: 99 } }).ok).toBe(false);
  });

  it('refuses malformed statutory identifiers at the employee source', () => {
    const bad = (fields: Record<string, unknown>) =>
      employees.hooks.validate({ fields: { employeeNumber: 'X', name: 'X', ...fields } });
    expect(bad({ uan: '123' }).ok).toBe(false);
    expect(bad({ pan: 'ABC123' }).ok).toBe(false);
    expect(bad({ esicNumber: 'abc' }).ok).toBe(false);
    const ok = bad({ uan: '100987654321', pan: 'ABCDE1234F', esicNumber: '1234567890' });
    expect(ok.ok, JSON.stringify('errors' in ok ? ok.errors : {})).toBe(true);
  });
});
