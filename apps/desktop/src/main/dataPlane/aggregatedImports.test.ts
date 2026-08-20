/**
 * NP-011 — aggregation-shaped ingestion, pure extractors + the REAL pipeline.
 *
 * Bank CSV → ONE statement record (lines in the shared BankStatementLine shape,
 * deposits positive) · Tally XML → one DRAFT journal entry per voucher (lines
 * in the shared GlJournalLine shape, Tally's negative-is-debit convention
 * honored) · both land through classify → approve (HIGH, structural) → import
 * with the §2 honesty label. Nothing posts: the GL gate stays the post action.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  DataPlanePlanSummary,
  DataPlaneRunResult,
  EnterpriseModuleDescriptor,
  EnterprisePermission,
  IpcChannelName,
} from '@neuropause/shared';
import { IpcChannel, parseBankStatementLines, parseGlJournalLines } from '@neuropause/shared';
import { EnterpriseRecordStore } from '../enterprise/framework/enterpriseRecordStore';
import { initDataPlane, type DataPlaneSubsystem } from './index';
import { TEST_TENANT_SCOPE } from '../tenancy/testScope';
import { extractTallyVouchers, foldBankStatementTable } from './aggregations';
import type { ParsedTable } from './parsers';

const T0 = '2026-08-20T00:00:00.000Z';
const ACTOR = 'priya@example.com';

const BANK_CSV = [
  'Date,Particulars,Cheque No,Debit,Credit,Balance',
  '01/08/2026,NEFT FROM ACME LTD,UTR111,,"1,200.00","10,200.00"',
  '03/08/2026,RENT AUG,CHQ778,5000,,5200.00',
  '05/08/2026,UPI FROM BOREALIS,UTR222,,800,6000.00',
].join('\n');

const TALLY_XML = `<?xml version="1.0"?>
<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA>
<TALLYMESSAGE>
 <VOUCHER VCHTYPE="Journal" ACTION="Create">
  <DATE>20260801</DATE>
  <VOUCHERNUMBER>JV-101</VOUCHERNUMBER>
  <NARRATION>August rent</NARRATION>
  <ALLLEDGERENTRIES.LIST><LEDGERNAME>Rent Expense</LEDGERNAME><AMOUNT>-5000</AMOUNT></ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST><LEDGERNAME>HDFC Bank</LEDGERNAME><AMOUNT>5000</AMOUNT></ALLLEDGERENTRIES.LIST>
 </VOUCHER>
</TALLYMESSAGE>
<TALLYMESSAGE>
 <VOUCHER VCHTYPE="Receipt" ACTION="Create">
  <DATE>20260803</DATE>
  <VOUCHERNUMBER>RC-7</VOUCHERNUMBER>
  <NARRATION>Acme collection</NARRATION>
  <ALLLEDGERENTRIES.LIST><LEDGERNAME>HDFC Bank</LEDGERNAME><AMOUNT>-1200</AMOUNT></ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST><LEDGERNAME>Accounts Receivable</LEDGERNAME><AMOUNT>1200</AMOUNT></ALLLEDGERENTRIES.LIST>
 </VOUCHER>
</TALLYMESSAGE>
</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;

describe('pure extractors', () => {
  it('folds a bank-transaction table into ONE statement row with signed shared-shape lines', () => {
    const table: ParsedTable = {
      name: 'data',
      headers: ['Date', 'Particulars', 'Cheque No', 'Debit', 'Credit', 'Balance'],
      rows: [
        ['01/08/2026', 'NEFT FROM ACME', 'UTR111', null, '1,200.00', '10,200.00'],
        ['03/08/2026', 'RENT AUG', 'CHQ778', '5000', null, '5,200.00'],
      ],
      headerRowIndex: 0,
      firstDataRowIndex: 1,
      truncated: false,
    };
    const folded = foldBankStatementTable(table, 'hdfc-august.csv')!;
    expect(folded).not.toBeNull();
    expect(folded.rows).toHaveLength(1);
    const [stmtNo, account, stmtDate, linesJson] = folded.rows[0]! as string[];
    expect(stmtNo).toBe('STMT-hdfc-august');
    expect(account).toBe('hdfc-august');
    expect(stmtDate).toBe('2026-08-03');
    const lines = JSON.parse(linesJson!) as { date: string; amount: number; reference: string }[];
    expect(lines[0]).toMatchObject({ date: '2026-08-01', amount: 1200, reference: 'UTR111' });
    expect(lines[1]).toMatchObject({ date: '2026-08-03', amount: -5000, reference: 'CHQ778' }); // withdrawal negative
  });

  it('leaves a non-bank table untouched (conservative detection)', () => {
    const customers: ParsedTable = {
      name: 'data',
      headers: ['Customer Name', 'Email'],
      rows: [['Acme', 'a@acme.example']],
      headerRowIndex: 0,
      firstDataRowIndex: 1,
      truncated: false,
    };
    expect(foldBankStatementTable(customers, 'customers.csv')).toBeNull();
  });

  it('extracts Tally vouchers with the negative-is-debit convention; non-Tally XML → null', () => {
    const t = extractTallyVouchers(TALLY_XML)!;
    expect(t).not.toBeNull();
    expect(t.rows).toHaveLength(2);
    const [number, date, memo, linesJson] = t.rows[0]! as string[];
    expect(number).toBe('JV-101');
    expect(date).toBe('2026-08-01');
    expect(memo).toBe('Journal: August rent');
    const lines = JSON.parse(linesJson!) as { account: string; debit: number; credit: number }[];
    expect(lines).toEqual([
      { account: 'Rent Expense', debit: 5000, credit: 0 },
      { account: 'HDFC Bank', debit: 0, credit: 5000 },
    ]);
    expect(extractTallyVouchers('<catalog><item><name>x</name></item><item><name>y</name></item></catalog>')).toBeNull();
  });
});

/* ── The real pipeline ─────────────────────────────────────────────────────── */

const DESCRIPTORS: EnterpriseModuleDescriptor[] = [
  {
    id: 'finance-bank-statements',
    title: 'Bank Statements',
    singular: 'Bank Statement',
    plural: 'Bank Statements',
    icon: 'database',
    description: 'test',
    titleField: 'statementNumber',
    permissions: { read: 'operations:read', write: 'operations:manage' },
    fields: [
      { key: 'statementNumber', label: 'Statement #', type: 'text', required: true },
      { key: 'bankAccount', label: 'Bank Account', type: 'text', required: true },
      { key: 'statementDate', label: 'Statement Date', type: 'date' },
      { key: 'lines', label: 'Lines (JSON)', type: 'textarea' },
    ],
  },
  {
    id: 'finance-journal-entries',
    title: 'Journal',
    singular: 'Journal Entry',
    plural: 'Journal Entries',
    icon: 'doc',
    description: 'test',
    titleField: 'entryNumber',
    permissions: { read: 'operations:read', write: 'operations:manage' },
    fields: [
      { key: 'entryNumber', label: 'Entry #', type: 'text', required: true },
      { key: 'entryDate', label: 'Date', type: 'date' },
      { key: 'memo', label: 'Memo', type: 'text' },
      { key: 'lines', label: 'Lines (JSON)', type: 'textarea' },
    ],
  },
];

describe('aggregated imports through the real pipeline', () => {
  let dir: string;
  let stores: Map<string, EnterpriseRecordStore>;
  let sub: DataPlaneSubsystem;

  const call = async (channel: IpcChannelName, payload: unknown): Promise<unknown> => {
    const handler = sub.handlers.find((h) => h.channel === channel);
    if (!handler) throw new Error(`no handler for ${channel}`);
    return handler.handler(handler.schema.parse(payload));
  };
  const analyze = async (filename: string, body: string): Promise<DataPlanePlanSummary> =>
    (await call(IpcChannel.DataPlaneAnalyze, {
      filename,
      contentBase64: Buffer.from(body, 'utf8').toString('base64'),
    })) as DataPlanePlanSummary;
  const importAll = async (plan: DataPlanePlanSummary): Promise<DataPlaneRunResult> =>
    (await call(IpcChannel.DataPlaneImport, {
      planId: plan.planId,
      approvals: plan.tables.map((t) => ({ tableName: t.tableName, approved: true })),
      reason: 'Checked against the bank/Tally source.',
    })) as DataPlaneRunResult;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-agg-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    const granted = new Set<EnterprisePermission>(['data:read', 'data:import', 'data:approve', 'operations:read', 'operations:manage']);
    stores = new Map(
      DESCRIPTORS.map((d) => [
        d.id,
        new EnterpriseRecordStore(join(dir, `${d.id}.json`), d.id, d.id).bindScope(() => TEST_TENANT_SCOPE),
      ]),
    );
    await Promise.all([...stores.values()].map((s) => s.load()));
    sub = initDataPlane({
      userDataDir: dir,
      storeFor: (id) => stores.get(id) ?? null,
      actor: () => ACTOR,
      tenantId: () => TEST_TENANT_SCOPE.tenantId,
      now: () => T0,
      audit: () => undefined,
      authorize: (permission) => {
        if (!granted.has(permission)) throw new Error(`Missing permission ${permission}`);
      },
      modules: () => DESCRIPTORS,
      saveExport: async (name) => `/tmp/${name}`,
      onImported: () => undefined,
    });
    sub.relationships.bindScope(() => ({ tenantId: TEST_TENANT_SCOPE.tenantId, workspaceId: TEST_TENANT_SCOPE.workspaceId }));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('bank CSV → ONE statement record whose lines the module parser accepts', async () => {
    const plan = await analyze('hdfc-august.csv', BANK_CSV);
    expect(plan.tables).toHaveLength(1);
    expect(plan.tables[0]!.entityId).toBe('bank_statement');
    expect(plan.tables[0]!.requiresApproval).toBe(true);

    const run = await importAll(plan);
    expect(run.tables[0]!.status).toBe('imported');
    const records = stores.get('finance-bank-statements')!.list();
    expect(records).toHaveLength(1); // ONE statement, not three transaction records
    const parsed = parseBankStatementLines(String(records[0]!.fields.lines));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.lines).toHaveLength(3);
      expect(parsed.lines.reduce((s, l) => s + l.amount, 0)).toBe(1200 - 5000 + 800);
    }
    expect(records[0]!.metadata.importSourceTrust).toBe('unverified-source');
  });

  it('Tally XML → one DRAFT journal entry per voucher whose lines the GL parser accepts', async () => {
    const plan = await analyze('tally-daybook.xml', TALLY_XML);
    expect(plan.tables).toHaveLength(1);
    expect(plan.tables[0]!.entityId).toBe('journal_entry');

    const run = await importAll(plan);
    expect(run.tables[0]!.status).toBe('imported');
    const records = stores.get('finance-journal-entries')!.list();
    expect(records).toHaveLength(2);
    const jv = records.find((r) => r.title === 'JV-101')!;
    const parsed = parseGlJournalLines(String(jv.fields.lines));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.lines.reduce((s, l) => s + l.debit, 0)).toBe(5000);
      expect(parsed.lines.reduce((s, l) => s + l.credit, 0)).toBe(5000); // balanced voucher
    }
    // Drafts: nothing here posts — no postedAt, no GL side effects. The post
    // action's full guard (accounts, balance, closed periods) is the gate.
    expect(jv.fields.postedAt ?? '').toBe('');
    expect(jv.metadata.importSourceTrust).toBe('unverified-source');
  });
});

/* ── NP-011 slice B: GSTR-2B → vendor-bill DRAFTS ─────────────────────────── */

import { extractGstr2bBills } from './aggregations';

const GSTR_2B = JSON.stringify({
  data: {
    docdata: {
      b2b: [
        {
          ctin: '22AAAAA0000A1Z5',
          trdnm: 'Supplies Co',
          inv: [
            { inum: 'SC-901', dt: '03-08-2026', val: 1180, txval: 1000, igst: 180, cgst: 0, sgst: 0, cess: 0 },
            { inum: 'SC-902', dt: '05-08-2026', val: 590, txval: 500, igst: 0, cgst: 45, sgst: 45, cess: 0 },
          ],
        },
      ],
    },
  },
});

describe('NP-011 slice B — GSTR-2B extraction (pure)', () => {
  it('emits one vendor-bill row per document; derived rate approximate, source amounts verbatim in Notes', () => {
    const t = extractGstr2bBills(JSON.parse(GSTR_2B))!;
    expect(t).not.toBeNull();
    expect(t.rows).toHaveLength(2);
    const [billNo, vendor, gstin, subtotal, rate, date, notes] = t.rows[0]! as (string | number)[];
    expect(billNo).toBe('SC-901');
    expect(vendor).toBe('Supplies Co');
    expect(gstin).toBe('22AAAAA0000A1Z5');
    expect(subtotal).toBe(1000);
    expect(rate).toBe(18);
    expect(date).toBe('2026-08-03');
    expect(String(notes)).toContain('taxable 1000, IGST 180, CGST 0, SGST 0, cess 0');
    expect(String(notes)).toContain('these figures are the filing truth');
  });

  it('returns null for JSON that is not a GST return', () => {
    expect(extractGstr2bBills({ customers: [{ name: 'Acme' }] })).toBeNull();
    expect(extractGstr2bBills([1, 2, 3])).toBeNull();
  });
});

describe('NP-011 slice B — GSTR-2B through the real pipeline', () => {
  let dir: string;
  let stores: Map<string, EnterpriseRecordStore>;
  let sub: DataPlaneSubsystem;

  const BILL_DESCRIPTOR: EnterpriseModuleDescriptor = {
    id: 'finance-vendor-bills',
    title: 'Vendor Bills',
    singular: 'Vendor Bill',
    plural: 'Vendor Bills',
    icon: 'doc',
    description: 'test',
    titleField: 'billNumber',
    permissions: { read: 'operations:read', write: 'operations:manage' },
    fields: [
      { key: 'billNumber', label: 'Bill #', type: 'text', required: true },
      { key: 'vendor', label: 'Vendor', type: 'text', required: true },
      { key: 'vendorGstin', label: 'Vendor GSTIN', type: 'text' },
      { key: 'amount', label: 'Subtotal', type: 'number', required: true },
      { key: 'taxRate', label: 'Tax Rate %', type: 'number' },
      { key: 'billDate', label: 'Bill Date', type: 'date' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
  };

  const call = async (channel: IpcChannelName, payload: unknown): Promise<unknown> => {
    const handler = sub.handlers.find((h) => h.channel === channel);
    if (!handler) throw new Error(`no handler for ${channel}`);
    return handler.handler(handler.schema.parse(payload));
  };

  beforeEach(async () => {
    dir = join(tmpdir(), `np-gstr-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    const granted = new Set<EnterprisePermission>(['data:read', 'data:import', 'data:approve', 'operations:read', 'operations:manage']);
    stores = new Map([
      [
        'finance-vendor-bills',
        new EnterpriseRecordStore(join(dir, 'bills.json'), 'finance-vendor-bills', 'finance-vendor-bills').bindScope(() => TEST_TENANT_SCOPE),
      ],
    ]);
    await Promise.all([...stores.values()].map((s) => s.load()));
    sub = initDataPlane({
      userDataDir: dir,
      storeFor: (id) => stores.get(id) ?? null,
      actor: () => ACTOR,
      tenantId: () => TEST_TENANT_SCOPE.tenantId,
      now: () => T0,
      audit: () => undefined,
      authorize: (permission) => {
        if (!granted.has(permission)) throw new Error(`Missing permission ${permission}`);
      },
      modules: () => [BILL_DESCRIPTOR],
      saveExport: async (name) => `/tmp/${name}`,
      onImported: () => undefined,
    });
    sub.relationships.bindScope(() => ({ tenantId: TEST_TENANT_SCOPE.tenantId, workspaceId: TEST_TENANT_SCOPE.workspaceId }));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('GSTR-2B JSON → vendor-bill DRAFTS with the honesty label; the approve action stays the gate', async () => {
    const plan = (await call(IpcChannel.DataPlaneAnalyze, {
      filename: 'GSTR2B_082026.json',
      contentBase64: Buffer.from(GSTR_2B, 'utf8').toString('base64'),
    })) as DataPlanePlanSummary;
    expect(plan.tables).toHaveLength(1);
    expect(plan.tables[0]!.entityId).toBe('vendor_bill');
    expect(plan.tables[0]!.requiresApproval).toBe(true);

    const run = (await call(IpcChannel.DataPlaneImport, {
      planId: plan.planId,
      approvals: plan.tables.map((t) => ({ tableName: t.tableName, approved: true })),
      reason: 'Downloaded from the GST portal.',
    })) as DataPlaneRunResult;
    expect(run.tables[0]!.status).toBe('imported');

    const bills = stores.get('finance-vendor-bills')!.list();
    expect(bills).toHaveLength(2);
    const b1 = bills.find((r) => r.title === 'SC-901')!;
    expect(b1.fields.vendorGstin).toBe('22AAAAA0000A1Z5');
    expect(b1.fields.amount).toBe(1000);
    expect(String(b1.fields.notes)).toContain('filing truth');
    // DRAFTS: no approval stamp exists — the module's approve action is the gate.
    expect(String(b1.fields.approvedAt ?? '')).toBe('');
    expect(b1.metadata.importSourceTrust).toBe('unverified-source');
  });
});
