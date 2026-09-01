/**
 * ERP Session 4 — QA disposition → inventory: RED-GAP REPRODUCTION (characterization).
 *
 * This pins the CURRENT, truthful behavior: a Quality Inspection disposition
 * (pass/fail/rework/reject) posts NO stock movement and NO GL entry, and the
 * inspection carries no product/warehouse of its own — so a rejected quantity is
 * never taken out of (or held in) inventory. It is executable evidence of the
 * RED gap, and a guard: when the disposition→inventory behavior is decided and
 * implemented (Session 4-fix), these assertions are the ones that must flip, and
 * they must flip DELIBERATELY (not by a naive reuse of the scrap path). See
 * certification/ERP-SESSION4-QA-DISPOSITION-DECISION.md for the pending decision.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8'),
  },
}));

import {
  IpcChannel,
  QUALITY_INSPECTIONS_MODULE_ID,
  STOCK_MOVEMENTS_MODULE_ID,
  JOURNAL_ENTRIES_MODULE_ID,
  type EnterpriseEntity,
  type EnterprisePermission,
  type PlatformEventInput,
} from '@neuropause/shared';
import { EnterpriseModuleRegistry, buildModuleHandlers } from '../../framework/moduleRegistry';
import type { SecureHandlerDef } from '../../../ipc/secureBridge';
import { createProductModule } from '../inventory/productModule';
import { createStockMovementModule } from '../inventory/stockMovementModule';
import { createQualityModule, QUALITY_INSPECTION_DESCRIPTOR } from './qualityModule';
import { createJournalEntryModule } from '../finance/journalEntryModule';
import { createLedgerAccountModule } from '../finance/ledgerAccountModule';

const T0 = '2026-08-31T12:00:00.000Z';
const paths: string[] = [];
const tmp = (tag: string): string => {
  const p = join(tmpdir(), `np-${tag}-${randomUUID()}.json`);
  paths.push(p);
  return p;
};

interface Rec { publish: PlatformEventInput[]; audit: { action: string }[]; broadcast: { channel: string }[]; authorized: EnterprisePermission[] }
let rec: Rec;
let scope: { tenantId: string; workspaceId: string } | null;
let registry: EnterpriseModuleRegistry;
let handlers: SecureHandlerDef[];

function spyCtx() {
  return {
    authorize: (p: EnterprisePermission) => rec.authorized.push(p),
    audit: (e: { action: string; target: string; summary: string }) => rec.audit.push(e),
    publish: (i: PlatformEventInput) => rec.publish.push(i),
    broadcast: (channel: string) => rec.broadcast.push({ channel }),
    notify: () => undefined,
    actor: () => 'inspector@np.dev',
    now: () => T0,
  };
}

beforeEach(() => {
  rec = { publish: [], audit: [], broadcast: [], authorized: [] };
  scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
  registry = new EnterpriseModuleRegistry();
  const accounts = createLedgerAccountModule(tmp('acct'));
  for (const m of [
    createProductModule(tmp('prod')),
    createStockMovementModule(tmp('mv')),
    createQualityModule(tmp('qa')),
    accounts,
    createJournalEntryModule(tmp('jrnl'), accounts.store),
  ]) registry.register(m);
  registry.bindScope(() => scope);
  handlers = buildModuleHandlers(registry, spyCtx());
});
afterEach(async () => {
  for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined);
});

function handler(channel: string): (p: unknown) => Promise<unknown> {
  const def = handlers.find((d) => d.channel === channel);
  if (!def) throw new Error(`no handler for ${channel}`);
  return def.handler as (p: unknown) => Promise<unknown>;
}
const createIn = (moduleId: string, fields: Record<string, unknown>) =>
  handler(IpcChannel.EnterpriseModuleCreate)({ moduleId, fields }) as Promise<{ ok: boolean; record?: EnterpriseEntity; errors?: Record<string, string> }>;
const listOf = (moduleId: string) => registry.get(moduleId)!.store.list().filter((r) => r.status !== 'deleted');

describe('Session 4 RED gap — a QA disposition has no inventory or GL effect today', () => {
  it('a rejected inspection posts NO stock movement and NO journal entry', async () => {
    // A product exists in stock; the inspection rejects 5 units.
    await createIn('inventory-products', { sku: 'FG-1', name: 'Finished', standardCost: 20 });
    const insp = await createIn(QUALITY_INSPECTIONS_MODULE_ID, {
      inspectionNumber: 'QC-1', productionOrder: 'MO-1', stage: 'final',
      inspectedQuantity: 10, passedQuantity: 5, failedQuantity: 5, result: 'reject', status: 'inspected',
    });
    expect(insp.ok).toBe(true);
    // qualityScore is computed (the only thing a disposition does today).
    expect(Number(insp.record!.fields.qualityScore)).toBeGreaterThanOrEqual(0);

    // THE GAP: nothing moved and nothing posted.
    expect(listOf(STOCK_MOVEMENTS_MODULE_ID), 'no stock movement from a reject').toHaveLength(0);
    expect(listOf(JOURNAL_ENTRIES_MODULE_ID), 'no GL entry from a reject').toHaveLength(0);
  });

  it('the same holds for fail / rework (no disposition moves stock today)', async () => {
    for (const result of ['fail', 'rework'] as const) {
      await createIn(QUALITY_INSPECTIONS_MODULE_ID, {
        inspectionNumber: `QC-${result}`, productionOrder: 'MO-1', stage: 'final',
        inspectedQuantity: 4, passedQuantity: 2, failedQuantity: 1, reworkQuantity: 1, result, status: 'inspected',
      });
    }
    expect(listOf(STOCK_MOVEMENTS_MODULE_ID)).toHaveLength(0);
    expect(listOf(JOURNAL_ENTRIES_MODULE_ID)).toHaveLength(0);
  });

  it('structural cause — the inspection carries no product or warehouse field', () => {
    // The record cannot post a movement because it has no product/warehouse of
    // its own; its only link to the goods is a free-text `productionOrder` number.
    const fieldKeys = QUALITY_INSPECTION_DESCRIPTOR.fields.map((f) => f.key);
    expect(fieldKeys).not.toContain('product');
    expect(fieldKeys).not.toContain('warehouse');
    expect(fieldKeys).toContain('productionOrder'); // free text, unresolved today
    // And the module exposes no action to post a disposition.
    expect(QUALITY_INSPECTION_DESCRIPTOR.actions ?? []).toHaveLength(0);
  });
});
