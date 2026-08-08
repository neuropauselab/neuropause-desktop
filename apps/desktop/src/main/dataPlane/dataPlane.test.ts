/**
 * Phase 6 — Universal Data Plane: intelligence, governance and import locks.
 *
 * These are the tests that protect a customer's books. They assert the
 * behaviours that make an automated import safe to trust:
 *   - a header the DATA contradicts does not win;
 *   - a semantically wrong-but-similar field is refused ("Annual" ≠ monthly);
 *   - high-risk data cannot be written without explicit approval;
 *   - a partial failure on high-risk data is rolled back, never reported as success;
 *   - every imported value can be traced back to its source cell.
 */
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EnterpriseRecordStore } from '../enterprise/framework/enterpriseRecordStore';
import { classifyTable } from './classifier';
import { entityById, requiresExplicitApproval } from './ontology';
import { canonicalName, normalizeValue, parseMoney, parseDateValue, shapeOf } from './normalize';
import { parseFile, toTable, type ParsedTable } from './parsers';
import { analyzeSource, summarizePlan } from './planner';
import { applyImportPlan, ProvenanceStore, type ImportDeps } from './importer';
import { prepareRows, similarity } from './quality';
import { buildXlsx } from './testFixtures';

const T0 = '2026-08-08T10:00:00.000Z';

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'np-dataplane-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function table(name: string, headers: string[], rows: (string | number | null)[][]): ParsedTable {
  return toTable(name, [headers, ...rows]);
}

// ---------------------------------------------------------------------------

describe('normalization records every transformation', () => {
  it('parses money with symbol, separators and accounting negatives', () => {
    expect(parseMoney('₹25,000')).toEqual({ amount: 25000, currency: 'INR' });
    expect(parseMoney('$1,234.56')).toEqual({ amount: 1234.56, currency: 'USD' });
    expect(parseMoney('(500)')).toEqual({ amount: -500, currency: null });
    expect(parseMoney('1200 USD')).toEqual({ amount: 1200, currency: 'USD' });
  });

  it('refuses to coerce a non-numeric value into a number', () => {
    expect(parseMoney('not-a-number')).toBeNull();
    const n = normalizeValue('not-a-number', 'number');
    expect(n.value).toBeNull();
    expect(n.error).toMatch(/is not a number/);
  });

  it('reports the transformation so provenance can show it', () => {
    const n = normalizeValue('₹25,000', 'number');
    expect(n.value).toBe(25000);
    expect(n.transformed).toBe(true);
    expect(n.note).toBe('"₹25,000" → 25000 INR');
    expect(n.currency).toBe('INR');
  });

  it('normalizes dates to ISO and rejects unparseable ones', () => {
    expect(parseDateValue('2026-03-15')).toBe('2026-03-15');
    expect(parseDateValue('15/03/2026')).toBe('2026-03-15');
    expect(parseDateValue('2026/3/5')).toBe('2026-03-05');
    expect(parseDateValue('someday')).toBeNull();
  });

  it('distinguishes a phone number from a bare quantity', () => {
    expect(shapeOf('+91 98200 11111')).toBe('phone');
    expect(shapeOf('1234567')).toBe('number');
    expect(shapeOf('ops@acme.example')).toBe('email');
  });

  it('canonicalizes company suffixes for matching', () => {
    expect(canonicalName('ABC Industries Pvt Ltd')).toBe(canonicalName('ABC Industries Private Limited'));
  });
});

// ---------------------------------------------------------------------------

describe('classification uses values, not just headers', () => {
  it('classifies a customer sheet with high confidence', () => {
    const c = classifyTable(
      table('Customers', ['Customer Name', 'Email', 'Credit Limit'], [['Acme', 'a@acme.example', 5000]]),
    );
    expect(c.entityId).toBe('customer');
    expect(c.entityBand).toBe('high');
    expect(c.mappings.find((m) => m.header === 'Email')?.fieldKey).toBe('email');
  });

  it('recognizes synonyms across vocabularies (Bill Number → Invoice #)', () => {
    const c = classifyTable(
      table('Billing', ['Bill Number', 'Party Name', 'Taxable Value'], [['B-1', 'Acme', 100]]),
    );
    expect(c.entityId).toBe('invoice');
    expect(c.mappings.find((m) => m.header === 'Bill Number')?.fieldKey).toBe('number');
    expect(c.mappings.find((m) => m.header === 'Party Name')?.fieldKey).toBe('customer');
  });

  it('DOWNGRADES a header the data contradicts', () => {
    // Header says "Invoice Date" but every value is a person's name.
    const c = classifyTable(
      table('Sheet1', ['Invoice No', 'Customer', 'Net Amount', 'Invoice Date'], [
        ['INV-1', 'Acme', 100, 'Priya Nair'],
        ['INV-2', 'Beta', 200, 'Daniel Osei'],
      ]),
    );
    // The safe outcomes are: left unmapped, or mapped but never at high
    // confidence. What must NEVER happen is a confident mapping to issueDate.
    const dateCol = c.mappings.find((m) => m.header === 'Invoice Date');
    expect(dateCol).toBeDefined();
    const confidentlyWrong = dateCol?.fieldKey === 'issueDate' && dateCol?.band === 'high';
    expect(confidentlyWrong).toBe(false);
    expect(dateCol?.band).not.toBe('high');
  });

  it('REFUSES a semantically wrong match: "Annual Salary" is not a monthly field', () => {
    const c = classifyTable(
      table('Employees', ['Employee ID', 'Full Name', 'Annual Salary'], [['E1', 'Priya', 1450000]]),
    );
    expect(c.entityId).toBe('employee');
    const salary = c.mappings.find((m) => m.header === 'Annual Salary');
    expect(salary?.fieldKey).not.toBe('monthlySalary');
  });

  it('does not map a column on a weak "looks like a code" signal alone', () => {
    const c = classifyTable(
      table('Suppliers', ['Supplier Name', 'Payment Terms'], [['Metro', 'NET30'], ['Pacific', 'NET45']]),
    );
    expect(c.mappings.find((m) => m.header === 'Payment Terms')?.fieldKey).toBeNull();
  });

  it('returns an honest "no match" for prose rather than guessing', () => {
    const c = classifyTable(toTable('Notes', [['Internal migration notes'], ['Exported 2026-08-01']]));
    expect(c.entityId).toBeNull();
    expect(c.entityReasons[0]).toMatch(/no canonical entity/i);
  });

  it('flags a table whose required field is unmapped', () => {
    const c = classifyTable(table('Products', ['Product Name', 'Category'], [['Widget', 'Parts']]));
    if (c.entityId === 'product') expect(c.missingRequired).toContain('SKU');
  });
});

// ---------------------------------------------------------------------------

describe('quality, validation and duplicates', () => {
  const t = table(
    'Customers',
    ['Customer Name', 'Email', 'Credit Limit'],
    [
      ['ABC Industries Pvt Ltd', 'ops@abc.example', '₹250,000'],
      ['ABC Industries Private Limited', 'ops@abc.example', '₹250,000'],
      ['Northwind Trading', 'hi@northwind.example', 'not-a-number'],
      [null, 'orphan@x.example', 1000],
    ],
  );

  it('counts valid, invalid, incomplete and duplicate rows separately', () => {
    const c = classifyTable(t);
    const entity = entityById(c.entityId ?? '');
    expect(entity).not.toBeNull();
    const { report, rows } = prepareRows(t, c, entity!);

    expect(report.totalRows).toBe(4);
    expect(report.duplicates).toBe(1); // same email
    expect(report.invalid).toBe(1); // "not-a-number" credit limit
    expect(report.incomplete).toBe(1); // missing required name
    expect(rows.filter((r) => r.verdict === 'valid')).toHaveLength(1);
  });

  it('records the money transformation on the row', () => {
    const c = classifyTable(t);
    const { rows } = prepareRows(t, c, entityById(c.entityId ?? '')!);
    expect(rows[0]?.transformations.join(' ')).toMatch(/250000/);
  });

  it('explains why a row is invalid', () => {
    const c = classifyTable(t);
    const { rows } = prepareRows(t, c, entityById(c.entityId ?? '')!);
    expect(rows[2]?.issues[0]?.message).toMatch(/is not a number/);
  });

  it('scores name similarity for near-duplicate review', () => {
    expect(similarity(canonicalName('Acme Industries Ltd'), canonicalName('Acme Industries'))).toBeGreaterThan(0.6);
  });
});

// ---------------------------------------------------------------------------

describe('import planning', () => {
  const workbook = buildXlsx([
    {
      name: 'Customers',
      rows: [
        ['Customer Name', 'Email', 'Credit Limit'],
        ['Acme Ltd', 'ops@acme.example', 5000],
      ],
    },
    {
      name: 'Projects',
      rows: [
        ['Project Number', 'Project Name', 'Manager'],
        ['P-1', 'Rollout', 'Mei'],
      ],
    },
    { name: 'Notes', rows: [['just prose']] },
  ]);

  it('produces a routed, totalled plan and writes nothing', () => {
    const plan = analyzeSource('company.xlsx', workbook, { now: () => T0, idFactory: () => 'imp_test' });
    expect(plan.planId).toBe('imp_test');
    expect(plan.tables.map((t) => t.entityId).sort()).toEqual(['customer', 'project']);
    expect(plan.totals.importable).toBe(2);
    expect(plan.unclassified.map((u) => u.tableName)).toEqual(['Notes']);
  });

  it('flags high-risk domains as approval-required and low-risk as not', () => {
    const plan = analyzeSource('company.xlsx', workbook, { now: () => T0 });
    const customers = plan.tables.find((t) => t.entityId === 'customer');
    const projects = plan.tables.find((t) => t.entityId === 'project');
    expect(customers?.requiresApproval).toBe(true); // customer master is high risk
    expect(projects?.requiresApproval).toBe(false);
    expect(plan.requiresApproval).toBe(true);
  });

  it('treats finance and HR as always approval-required', () => {
    expect(requiresExplicitApproval(entityById('invoice')!)).toBe(true);
    expect(requiresExplicitApproval(entityById('employee')!)).toBe(true);
  });

  it('reports an unsupported file as a plan with a reason, not a crash', () => {
    const plan = analyzeSource('scan.pdf', Buffer.from('%PDF-1.7', 'utf8'), { now: () => T0 });
    expect(plan.tables).toHaveLength(0);
    expect(plan.unsupportedReason).toMatch(/PDF/i);
  });

  it('summarizePlan drops row payloads for the renderer', () => {
    const plan = analyzeSource('company.xlsx', workbook, { now: () => T0 });
    const summary = summarizePlan(plan);
    expect(summary.tables[0]).not.toHaveProperty('rows');
  });
});

// ---------------------------------------------------------------------------

describe('import execution, approval gating and provenance', () => {
  function deps(stores: Map<string, EnterpriseRecordStore>, audit: string[] = []): ImportDeps {
    return {
      storeFor: (moduleId) => stores.get(moduleId) ?? null,
      actor: () => 'reviewer@np.example',
      now: () => T0,
      audit: (e) => audit.push(`${e.action}:${e.summary}`),
    };
  }

  function storeFor(moduleId: string): EnterpriseRecordStore {
    return new EnterpriseRecordStore(join(dir, `${moduleId}.json`), moduleId, moduleId.split('-')[1] ?? 'record');
  }

  const projectBook = buildXlsx([
    {
      name: 'Projects',
      rows: [
        ['Project Number', 'Project Name', 'Manager', 'Budget'],
        ['P-1', 'Rollout', 'Mei', '₹1,200,000'],
        ['P-2', 'Migration', 'Daniel', 900000],
      ],
    },
  ]);

  it('imports an approved low-risk table into the real module store', async () => {
    const store = storeFor('projects-projects');
    const stores = new Map([['projects-projects', store]]);
    const plan = analyzeSource('projects.xlsx', projectBook, { now: () => T0 });

    const { result, provenance } = await applyImportPlan(plan, [{ tableName: 'Projects', approved: true }], deps(stores));

    expect(result.status).toBe('imported');
    expect(result.totals.imported).toBe(2);
    const records = store.list();
    expect(records).toHaveLength(2);
    expect(records.some((r) => r.title === 'Rollout')).toBe(true);
    expect(provenance).toHaveLength(2);
  });

  it('normalizes currency on the way in and records it in provenance', async () => {
    const store = storeFor('projects-projects');
    const plan = analyzeSource('projects.xlsx', projectBook, { now: () => T0 });
    const { provenance } = await applyImportPlan(
      plan,
      [{ tableName: 'Projects', approved: true }],
      deps(new Map([['projects-projects', store]])),
    );
    const rollout = store.list().find((r) => r.title === 'Rollout');
    expect(rollout?.fields.budget).toBe(1200000); // "₹1,200,000" → 1200000
    const trace = provenance.find((p) => p.recordId === rollout?.id);
    expect(trace?.sourceFile).toBe('projects.xlsx');
    expect(trace?.sourceTable).toBe('Projects');
    expect(trace?.sourceRow).toBe(2); // row 1 is the header
    expect(trace?.fields.find((f) => f.field === 'budget')?.transformation).toMatch(/1200000/);
  });

  it('REFUSES to write high-risk data without explicit approval', async () => {
    const store = storeFor('crm-customers');
    const workbook = buildXlsx([
      { name: 'Customers', rows: [['Customer Name', 'Email'], ['Acme Ltd', 'ops@acme.example']] },
    ]);
    const plan = analyzeSource('customers.xlsx', workbook, { now: () => T0 });

    // No decision supplied at all.
    const { result } = await applyImportPlan(plan, [], deps(new Map([['crm-customers', store]])));

    expect(result.tables[0]?.status).toBe('awaiting_approval');
    expect(result.totals.imported).toBe(0);
    expect(result.status).toBe('nothing_imported');
    expect(store.list()).toHaveLength(0); // nothing was written
  });

  it('honours an explicit decline without writing', async () => {
    const store = storeFor('crm-customers');
    const workbook = buildXlsx([
      { name: 'Customers', rows: [['Customer Name', 'Email'], ['Acme Ltd', 'ops@acme.example']] },
    ]);
    const plan = analyzeSource('customers.xlsx', workbook, { now: () => T0 });
    const { result } = await applyImportPlan(
      plan,
      [{ tableName: 'Customers', approved: false }],
      deps(new Map([['crm-customers', store]])),
    );
    expect(result.tables[0]?.status).toBe('skipped');
    expect(store.list()).toHaveLength(0);
  });

  it('skips invalid and duplicate rows instead of importing them', async () => {
    const store = storeFor('projects-projects');
    const workbook = buildXlsx([
      {
        name: 'Projects',
        rows: [
          ['Project Number', 'Project Name', 'Budget'],
          ['P-1', 'Rollout', 1000],
          ['P-1', 'Rollout', 1000], // duplicate identity
          ['P-2', 'Broken', 'not-a-number'], // invalid
        ],
      },
    ]);
    const plan = analyzeSource('projects.xlsx', workbook, { now: () => T0 });
    const { result } = await applyImportPlan(
      plan,
      [{ tableName: 'Projects', approved: true }],
      deps(new Map([['projects-projects', store]])),
    );
    expect(result.totals.imported).toBe(1);
    expect(store.list()).toHaveLength(1);
    expect(result.tables[0]?.duplicates).toBe(1);
  });

  it('lets a reviewer skip specific rows', async () => {
    const store = storeFor('projects-projects');
    const plan = analyzeSource('projects.xlsx', projectBook, { now: () => T0 });
    const { result } = await applyImportPlan(
      plan,
      [{ tableName: 'Projects', approved: true, skipRows: [0] }],
      deps(new Map([['projects-projects', store]])),
    );
    expect(result.totals.imported).toBe(1);
    expect(store.list()[0]?.title).toBe('Migration');
  });

  it('never reports "imported" when the destination module is missing', async () => {
    const plan = analyzeSource('projects.xlsx', projectBook, { now: () => T0 });
    const { result } = await applyImportPlan(
      plan,
      [{ tableName: 'Projects', approved: true }],
      deps(new Map()), // no stores registered
    );
    expect(result.tables[0]?.status).toBe('failed');
    expect(result.status).not.toBe('imported');
    expect(result.tables[0]?.note).toMatch(/not available/i);
  });

  it('rolls back a high-risk table when any row fails to write', async () => {
    // A store capped at 1 record forces the second create to evict/fail-ish;
    // we simulate a mid-import failure by making create throw on the 2nd row.
    const store = storeFor('crm-customers');
    await store.load();
    let calls = 0;
    const realCreate = store.create.bind(store);
    store.create = ((input: Parameters<typeof realCreate>[0]) => {
      calls += 1;
      if (calls === 2) throw new Error('disk full');
      return realCreate(input);
    }) as typeof store.create;

    const workbook = buildXlsx([
      {
        name: 'Customers',
        rows: [
          ['Customer Name', 'Email'],
          ['Acme Ltd', 'a@acme.example'],
          ['Beta Ltd', 'b@beta.example'],
        ],
      },
    ]);
    const audit: string[] = [];
    const plan = analyzeSource('customers.xlsx', workbook, { now: () => T0 });
    const { result } = await applyImportPlan(
      plan,
      [{ tableName: 'Customers', approved: true }],
      deps(new Map([['crm-customers', store]]), audit),
    );

    expect(result.tables[0]?.status).toBe('failed');
    expect(result.tables[0]?.rolledBack).toBe(true);
    expect(result.tables[0]?.imported).toBe(0);
    expect(result.status).not.toBe('imported');
    // The compensating delete really happened — no live records remain.
    expect(store.list()).toHaveLength(0);
    expect(audit.some((a) => a.startsWith('dataplane.import.rollback'))).toBe(true);
  });

  it('writes an audit entry for every import run', async () => {
    const audit: string[] = [];
    const store = storeFor('projects-projects');
    const plan = analyzeSource('projects.xlsx', projectBook, { now: () => T0 });
    await applyImportPlan(
      plan,
      [{ tableName: 'Projects', approved: true }],
      deps(new Map([['projects-projects', store]]), audit),
    );
    expect(audit.some((a) => a.startsWith('dataplane.import:'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('ProvenanceStore', () => {
  it('persists import history and per-record lineage across instances', async () => {
    const file = join(dir, 'provenance.json');
    const a = new ProvenanceStore(file);
    await a.load();
    await a.append(
      {
        planId: 'imp_1',
        sourceFile: 'company.xlsx',
        importedAt: T0,
        actor: 'reviewer@np.example',
        status: 'imported',
        tables: [],
        totals: { imported: 1, skipped: 0, failed: 0, duplicates: 0, needsReview: 0 },
      },
      [
        {
          recordId: 'rec_1',
          moduleId: 'crm-customers',
          planId: 'imp_1',
          sourceFile: 'company.xlsx',
          sourceTable: 'Customers',
          sourceRow: 1847,
          confidence: 0.98,
          approvedBy: 'reviewer@np.example',
          importedAt: T0,
          fields: [{ field: 'creditLimit', column: 'Credit Limit', original: '25000', transformation: '"₹25,000" → 25000 INR' }],
        },
      ],
    );

    const b = new ProvenanceStore(file);
    await b.load();
    expect(b.counts()).toEqual({ runs: 1, records: 1 });
    const trace = b.forRecord('rec_1');
    expect(trace?.sourceRow).toBe(1847);
    expect(trace?.fields[0]?.transformation).toMatch(/25000 INR/);
    expect(b.forPlan('imp_1')).toHaveLength(1);
    expect(b.history()[0]?.sourceFile).toBe('company.xlsx');
  });

  it('starts empty on a corrupt file rather than throwing', async () => {
    const file = join(dir, 'corrupt.json');
    await fs.writeFile(file, '{not json', 'utf8');
    const store = new ProvenanceStore(file);
    await store.load();
    expect(store.counts()).toEqual({ runs: 0, records: 0 });
  });
});

// ---------------------------------------------------------------------------

describe('end-to-end: a company workbook becomes governed enterprise records', () => {
  it('analyzes, routes, gates, imports and traces a multi-domain workbook', async () => {
    const workbook = buildXlsx([
      {
        name: 'Customers',
        rows: [
          ['Customer Name', 'Email', 'Credit Limit'],
          ['ABC Industries Pvt Ltd', 'ops@abc.example', '₹250,000'],
          ['ABC Industries Private Limited', 'ops@abc.example', '₹250,000'],
        ],
      },
      {
        name: 'Employees',
        rows: [
          ['Employee ID', 'Full Name', 'Department', 'Date of Joining'],
          ['EMP-1001', 'Priya Nair', 'Finance', { date: '2024-01-15' }],
        ],
      },
      {
        name: 'Projects',
        rows: [
          ['Project Number', 'Project Name', 'Budget'],
          ['P-1', 'Rollout', 1200000],
        ],
      },
      { name: 'Notes', rows: [['Exported from the legacy system']] },
    ]);

    // 1. ANALYZE — nothing is written.
    const plan = analyzeSource('company_e2e.xlsx', workbook, { now: () => T0 });
    expect(plan.tables.map((t) => t.entityId).sort()).toEqual(['customer', 'employee', 'project']);
    expect(plan.unclassified.map((u) => u.tableName)).toEqual(['Notes']);
    expect(plan.totals.duplicates).toBe(1); // the two ABC spellings

    // 2. The dates survived the round trip.
    const employees = plan.tables.find((t) => t.entityId === 'employee');
    expect(employees?.rows[0]?.fields.joinDate).toBe('2024-01-15');

    // 3. HR and CRM demand approval; Projects does not.
    expect(employees?.requiresApproval).toBe(true);
    expect(plan.tables.find((t) => t.entityId === 'project')?.requiresApproval).toBe(false);

    // 4. Approve only Projects and Employees; leave Customers unapproved.
    const stores = new Map<string, EnterpriseRecordStore>([
      ['crm-customers', new EnterpriseRecordStore(join(dir, 'cust.json'), 'crm-customers', 'customer')],
      ['hr-employees', new EnterpriseRecordStore(join(dir, 'emp.json'), 'hr-employees', 'employee')],
      ['projects-projects', new EnterpriseRecordStore(join(dir, 'proj.json'), 'projects-projects', 'project')],
    ]);
    const audit: string[] = [];
    const { result, provenance } = await applyImportPlan(
      plan,
      [
        { tableName: 'Projects', approved: true },
        { tableName: 'Employees', approved: true },
      ],
      {
        storeFor: (id) => stores.get(id) ?? null,
        actor: () => 'cfo@np.example',
        now: () => T0,
        audit: (e) => audit.push(e.action),
      },
    );

    // 5. Exactly what was approved landed; the unapproved table did not.
    expect(result.status).toBe('imported');
    expect(stores.get('projects-projects')?.list()).toHaveLength(1);
    expect(stores.get('hr-employees')?.list()).toHaveLength(1);
    expect(stores.get('crm-customers')?.list()).toHaveLength(0);
    expect(result.tables.find((t) => t.tableName === 'Customers')?.status).toBe('awaiting_approval');

    // 6. Every imported record is traceable to its source cell.
    const emp = stores.get('hr-employees')?.list()[0];
    const trace = provenance.find((p) => p.recordId === emp?.id);
    expect(trace).toBeDefined();
    expect(trace?.sourceFile).toBe('company_e2e.xlsx');
    expect(trace?.sourceTable).toBe('Employees');
    expect(trace?.approvedBy).toBe('cfo@np.example');

    // 7. The record carries its provenance metadata inline too.
    expect(emp?.metadata.importSourceFile).toBe('company_e2e.xlsx');
    expect(emp?.tags).toContain('imported');
    expect(audit).toContain('dataplane.import');
  });

  it('parses the same workbook through the public parseFile entry point', () => {
    const workbook = buildXlsx([{ name: 'Customers', rows: [['Customer Name'], ['Acme']] }]);
    expect(parseFile('x.xlsx', workbook).tables[0]?.name).toBe('Customers');
  });
});
