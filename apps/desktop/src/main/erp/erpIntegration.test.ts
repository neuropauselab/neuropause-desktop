/**
 * Phase 6 — ERP posting INTEGRATION: the adapter driving the REAL general ledger.
 *
 * This is deliberately not an adapter unit test. It builds the actual finance
 * modules (`createLedgerAccountModule`, `createJournalEntryModule`), wires
 * `postJournal` to the real `applyGlDerivedEntries`, composes the adapter onto a
 * module exactly as the composition root does, then drives a lifecycle
 * transition and asserts the **persisted journal state**.
 *
 * If the composed path is broken, these fail — which is the point: registration
 * into the running app is now verified by the gate rather than by eye.
 */
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  JOURNAL_ENTRIES_MODULE_ID,
  LEDGER_ACCOUNTS_MODULE_ID,
  type EnterpriseEntity,
  type GlDerivedEntry,
} from '@neuropause/shared';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../enterprise/framework/enterpriseModule';
import { createLedgerAccountModule } from '../enterprise/modules/finance/ledgerAccountModule';
import { createJournalEntryModule } from '../enterprise/modules/finance/journalEntryModule';
import { applyGlDerivedEntries } from '../enterprise/modules/finance/glPosting';
import { DocumentIntegration } from './documentAdapter';
import { DocumentLineStore } from './documentLines';
import { DOCUMENT_SPECS } from './documentSpecs';
import { STOCK_ACCOUNTS } from './postingRules';
import { ensureStockAccounts } from './stockAccounts';

const T0 = '2026-08-08T12:00:00.000Z';

let dir: string;
let accounts: EnterpriseModule;
let journal: EnterpriseModule;
let ctx: EnterpriseModuleActionContext;
let integration: DocumentIntegration;

beforeEach(async () => {
  dir = join(tmpdir(), `np-erpint-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  accounts = createLedgerAccountModule(join(dir, 'accounts.json'));
  journal = createJournalEntryModule(join(dir, 'journal.json'), accounts.store);
  await accounts.store.load();
  await journal.store.load();

  ctx = {
    actor: () => 'system:test',
    now: () => T0,
    authorize: () => undefined,
    moduleFor: (id: string) =>
      id === LEDGER_ACCOUNTS_MODULE_ID ? accounts : id === JOURNAL_ENTRIES_MODULE_ID ? journal : null,
    emit: () => undefined,
  };

  const lines = new DocumentLineStore(join(dir, 'lines.json'));
  await lines.load();

  // Exactly the production wiring (see documentIntegrationInstance.ts).
  integration = new DocumentIntegration({
    lines,
    postJournal: async (derivation, pctx) => {
      const entry: GlDerivedEntry = {
        entryNumber: derivation.reference,
        memo: derivation.memo,
        lines: derivation.lines,
        sourceModule: pctx.record.moduleId,
        sourceRef: pctx.record.id,
      };
      await ensureStockAccounts(pctx.actionCtx);
      await applyGlDerivedEntries([entry], pctx.actionCtx);
    },
    audit: () => undefined,
    now: () => T0,
    actor: () => 'system:test',
  });
  integration.registerAll(DOCUMENT_SPECS);
});

afterEach(async () => {
  await accounts.store.flush();
  await journal.store.flush();
  await fs.rm(dir, { recursive: true, force: true });
});

function moduleStub(id: string): EnterpriseModule {
  return {
    descriptor: { id, singular: id, plural: id } as unknown as EnterpriseModule['descriptor'],
    store: {} as unknown as EnterpriseModule['store'],
    hooks: { validate: () => ({ ok: true, input: {} }) as never },
  } as EnterpriseModule;
}

function doc(over: Partial<EnterpriseEntity>): EnterpriseEntity {
  return {
    id: 'DOC-1',
    moduleId: 'procurement-receipts',
    kind: 'receipt',
    title: 'DOC-1',
    status: 'draft',
    fields: {},
    tags: [],
    metadata: { createdBy: 'buyer@np.example' },
    rev: 1,
    createdAt: T0,
    updatedAt: T0,
    ...over,
  } as unknown as EnterpriseEntity;
}

/** Sum of posted debits/credits on an account, straight from the journal store. */
function ledger(code: string): { debit: number; credit: number } {
  let debit = 0;
  let credit = 0;
  for (const rec of journal.store.list()) {
    if (rec.deletedAt) continue;
    const raw = rec.fields.lines;
    if (typeof raw !== 'string') continue;
    let parsed: { account?: string; debit?: number; credit?: number }[] = [];
    try {
      parsed = JSON.parse(raw) as typeof parsed;
    } catch {
      continue;
    }
    for (const l of parsed) {
      if (l.account !== code) continue;
      debit += Number(l.debit ?? 0);
      credit += Number(l.credit ?? 0);
    }
  }
  return { debit, credit };
}

async function fire(moduleId: string, record: EnterpriseEntity): Promise<void> {
  const attached = integration.attach(moduleStub(moduleId));
  await attached.hooks.onChange?.({ action: 'status_changed', record }, ctx);
}

// ---------------------------------------------------------------------------

describe('goods receipt posts GRNI into the REAL journal', () => {
  it('creates a persisted, balanced journal entry', async () => {
    await integration.setLines('procurement-receipts', 'GR-1', [
      { productId: 'SKU-1', description: 'Widget', quantity: 10, unitPrice: 25 },
    ]);
    await fire('procurement-receipts', doc({ id: 'GR-1', status: 'received' }));

    const entries = journal.store.list().filter((r) => !r.deletedAt);
    expect(entries.length).toBeGreaterThan(0);

    const inv = ledger(STOCK_ACCOUNTS.inventory);
    const grni = ledger(STOCK_ACCOUNTS.grni);
    expect(inv.debit).toBe(250);
    expect(grni.credit).toBe(250);
  });

  it('is idempotent against the real journal — no duplicate entry', async () => {
    await integration.setLines('procurement-receipts', 'GR-2', [
      { productId: 'SKU-1', description: 'Widget', quantity: 4, unitPrice: 50 },
    ]);
    const record = doc({ id: 'GR-2', status: 'received' });
    await fire('procurement-receipts', record);
    await fire('procurement-receipts', record);

    expect(ledger(STOCK_ACCOUNTS.inventory).debit).toBe(200);
  });

  it('writes NOTHING to the ledger when the receipt cannot be valued', async () => {
    await integration.setLines('procurement-receipts', 'GR-3', [
      { productId: 'SKU-1', description: 'Widget', quantity: 10, unitPrice: 0 },
    ]);
    await fire('procurement-receipts', doc({ id: 'GR-3', status: 'received' }));

    expect(ledger(STOCK_ACCOUNTS.inventory).debit).toBe(0);
    expect(integration.refusedPostings()).toHaveLength(1);
  });
});

describe('procure-to-pay reconciles in the REAL ledger', () => {
  it('GRNI accrued by the receipt is cleared exactly by the matched bill', async () => {
    await integration.setLines('procurement-receipts', 'GR-9', [
      { productId: 'SKU-1', description: 'Widget', quantity: 100, unitPrice: 10 },
    ]);
    await fire('procurement-receipts', doc({ id: 'GR-9', status: 'received' }));

    await integration.setLines('finance-vendor-bills', 'BILL-9', [
      { productId: 'SKU-1', description: 'Widget', quantity: 100, unitPrice: 10 },
    ]);
    await fire(
      'finance-vendor-bills',
      doc({
        id: 'BILL-9',
        moduleId: 'finance-vendor-bills',
        kind: 'vendorBill',
        status: 'posted',
        fields: { matchState: 'MATCHED', matchedValue: 1000 },
      }),
    );

    const grni = ledger(STOCK_ACCOUNTS.grni);
    const ap = ledger(STOCK_ACCOUNTS.accountsPayable);
    // The control that matters: GRNI nets to zero once invoiced.
    expect(grni.credit).toBe(1000);
    expect(grni.debit).toBe(1000);
    expect(grni.credit - grni.debit).toBe(0);
    expect(ap.credit).toBe(1000);
    expect(ledger(STOCK_ACCOUNTS.inventory).debit).toBe(1000);
  });

  it('a MISMATCHED bill leaves GRNI outstanding and posts no payable', async () => {
    await integration.setLines('procurement-receipts', 'GR-10', [
      { productId: 'SKU-1', description: 'Widget', quantity: 10, unitPrice: 10 },
    ]);
    await fire('procurement-receipts', doc({ id: 'GR-10', status: 'received' }));

    await integration.setLines('finance-vendor-bills', 'BILL-10', [
      { productId: 'SKU-1', description: 'Widget', quantity: 10, unitPrice: 10 },
    ]);
    await fire(
      'finance-vendor-bills',
      doc({
        id: 'BILL-10',
        moduleId: 'finance-vendor-bills',
        kind: 'vendorBill',
        status: 'posted',
        fields: { matchState: 'MISMATCH', matchedValue: 100 },
      }),
    );

    expect(ledger(STOCK_ACCOUNTS.grni).credit).toBe(100); // still accrued
    expect(ledger(STOCK_ACCOUNTS.grni).debit).toBe(0); // never cleared
    expect(ledger(STOCK_ACCOUNTS.accountsPayable).credit).toBe(0);
  });
});

describe('sales dispatch posts COGS into the REAL ledger', () => {
  it('debits COGS and credits inventory', async () => {
    await integration.setLines('warehouse-shipping', 'SHIP-1', [
      { productId: 'SKU-1', description: 'Widget', quantity: 5, unitPrice: 18 },
    ]);
    await fire('warehouse-shipping', doc({ id: 'SHIP-1', moduleId: 'warehouse-shipping', kind: 'shipment', status: 'shipped' }));

    expect(ledger(STOCK_ACCOUNTS.cogs).debit).toBe(90);
    expect(ledger(STOCK_ACCOUNTS.inventory).credit).toBe(90);
  });
});

describe('manufacturing posts WIP and variance into the REAL ledger', () => {
  it('material issue moves stock into WIP', async () => {
    await integration.setLines('manufacturing-executions', 'MO-1', [
      { productId: 'RAW-1', description: 'Steel', quantity: 100, unitPrice: 5 },
    ]);
    await fire(
      'manufacturing-executions',
      doc({ id: 'MO-1', moduleId: 'manufacturing-executions', kind: 'execution', status: 'in_progress' }),
    );

    expect(ledger(STOCK_ACCOUNTS.wip).debit).toBe(500);
    expect(ledger(STOCK_ACCOUNTS.inventory).credit).toBe(500);
  });

  it('completion settles WIP into finished goods with an unfavourable variance', async () => {
    await integration.setLines('manufacturing-executions', 'MO-2', [
      { productId: 'RAW-1', description: 'Steel', quantity: 100, unitPrice: 5 },
    ]);
    await fire(
      'manufacturing-executions',
      doc({
        id: 'MO-2',
        moduleId: 'manufacturing-executions',
        kind: 'execution',
        status: 'completed',
        fields: { wipAccumulated: 500, standardCost: 450 },
      }),
    );

    expect(ledger(STOCK_ACCOUNTS.finishedGoods).debit).toBe(450);
    expect(ledger(STOCK_ACCOUNTS.productionVariance).debit).toBe(50);
    expect(ledger(STOCK_ACCOUNTS.wip).credit).toBe(500);
  });
});

describe('the ledger stays internally consistent', () => {
  it('every entry the adapter posted balances in the persisted journal', async () => {
    await integration.setLines('procurement-receipts', 'GR-B', [
      { productId: 'SKU-1', description: 'Widget', quantity: 3, unitPrice: 33.33 },
    ]);
    await fire('procurement-receipts', doc({ id: 'GR-B', status: 'received' }));

    await integration.setLines('warehouse-shipping', 'SHIP-B', [
      { productId: 'SKU-1', description: 'Widget', quantity: 7, unitPrice: 1.11 },
    ]);
    await fire('warehouse-shipping', doc({ id: 'SHIP-B', moduleId: 'warehouse-shipping', kind: 'shipment', status: 'shipped' }));

    let totalDebit = 0;
    let totalCredit = 0;
    for (const rec of journal.store.list()) {
      if (rec.deletedAt) continue;
      const raw = rec.fields.lines;
      if (typeof raw !== 'string') continue;
      const parsed = JSON.parse(raw) as { debit?: number; credit?: number }[];
      const d = parsed.reduce((n, l) => n + Number(l.debit ?? 0), 0);
      const c = parsed.reduce((n, l) => n + Number(l.credit ?? 0), 0);
      expect(Math.round(d * 100)).toBe(Math.round(c * 100)); // each entry balances
      totalDebit += d;
      totalCredit += c;
    }
    expect(Math.round(totalDebit * 100)).toBe(Math.round(totalCredit * 100));
    expect(integration.postings().length).toBeGreaterThanOrEqual(2);
  });
});
