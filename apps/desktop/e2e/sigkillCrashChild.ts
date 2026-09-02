#!/usr/bin/env -S node --import tsx
/**
 * ERP Session 41 — REAL-PROCESS SIGKILL crash-recovery child.
 *
 * A separate OS process that runs the REAL production platform-command core — `DurableCommandJournal`
 * (with S40 intent-first + S38 stale-PROCESSING recovery), `DurableJsonStore`, `dispatchOutbox`,
 * `DeliveredEventLog` — against REAL durable files under a temp profile dir. It is driven by the
 * `sigkillCrashRecovery.e2e.cjs` parent, which sends this process an ACTUAL OS `SIGKILL` at a precise
 * crash boundary (the process prints `READY` and then hangs, so the kill lands exactly there).
 *
 * NOT Electron, NOT the packaged app: this is the Electron-FREE platform core (proven independent by
 * S19/S21) exercised in a real OS process killed with a real signal — the strongest crash evidence
 * achievable off-macOS. The packaged-Electron kill is the operator's Mac step (sigkillPackaged.e2e.cjs).
 *
 * The "domain effect" is a durable order record written through the SAME `DurableJsonStore` primitive
 * the enterprise module stores use, so a crash after the effect leaves a real durable effect on disk.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DurableCommandJournal, type JournalRunInput } from '../src/main/platform/command/durableCommandJournal';
import { DurableJsonStore } from '../src/main/platform/persistence/durableJsonStore';
import { dispatchOutbox } from '../src/main/platform/command/outboxDispatcher';
import { DeliveredEventLog } from '../src/main/platform/command/deliveredEventLog';

interface Order { id: string; tenantId: string; orderNumber: string }

const [dir, phase, key = 'k', tenant = 'tenant-A', orderNo = 'SO-1'] = process.argv.slice(2);
mkdirSync(dir, { recursive: true });

const journal = new DurableCommandJournal(join(dir, 'platform-command-journal.json'));
const orders = new DurableJsonStore<Order>(join(dir, `orders-${tenant}.json`));
const sink = new DeliveredEventLog(join(dir, 'platform-delivered-events.json'));

/** The durable domain effect (a real atomic write through the shared store primitive). */
const effect: JournalRunInput['execute'] = async () => {
  const id = `ord_${randomUUID()}`;
  await orders.put({ id, tenantId: tenant, orderNumber: orderNo });
  return { ok: true, data: { id }, aggregateId: id, aggregateType: 'SalesOrder' };
};
const run = (execute: JournalRunInput['execute']) =>
  journal.run({ tenantId: tenant, idempotencyKey: key, commandId: `cmd-${key}`, commandType: 'CreateSalesOrder', correlationId: `corr-${key}`, actor: 'operator@np.dev', source: 'test', execute });

let keepAliveTimer: NodeJS.Timeout | undefined;
/**
 * Signal the parent that the crash boundary is reached, then TRULY BLOCK FOREVER so the crash-window
 * state (intent IN_FLIGHT, uncommitted, etc.) is frozen exactly here until the parent's OS SIGKILL
 * lands. Returns a never-resolving promise (so an awaiting `execute` never proceeds) and holds the
 * event loop open with a timer (so the process does not exit on its own before the kill).
 */
function readyAndHang(): Promise<never> {
  console.log('READY');
  keepAliveTimer = setInterval(() => undefined, 1000); // keep the event loop alive for the kill
  return new Promise<never>(() => undefined); // never resolves — only the SIGKILL ends this process
}
async function orderCount(): Promise<number> {
  await orders.reload();
  return orders.all().filter((o) => o.tenantId === tenant).length;
}
function result(data: unknown): void {
  console.log('RESULT ' + JSON.stringify(data));
}

async function main(): Promise<void> {
  switch (phase) {
    // ── crash windows (reach the boundary, print READY, hang for the real SIGKILL) ──────────────
    case 'before-effect':
      // intent reserved BEFORE execute; hang before the domain effect runs
      void run(async () => { await readyAndHang(); return { ok: false }; }).catch(() => undefined);
      break;
    case 'after-effect':
      // domain effect DURABLE; hang before the journal commit (the S40 dual-write window)
      void run(async () => { await effect(); await readyAndHang(); return { ok: false }; }).catch(() => undefined);
      break;
    case 'after-commit': {
      // committed record + PENDING outbox durable; hang before delivery (the S38/relay window)
      await run(effect);
      await readyAndHang();
      break;
    }
    case 'processing': {
      // committed, then outbox marked PROCESSING (persisted); hang mid-delivery (the S38 orphan window)
      await run(effect);
      const rec = journal.records(tenant)[0];
      await journal.markProcessing(rec.id);
      await readyAndHang();
      break;
    }

    // ── clean phases (do the work, print RESULT, exit 0) ────────────────────────────────────────
    case 'commit-ok': {
      const r = await run(effect);
      result({ ok: r.ok, records: journal.records(tenant).length, orders: await orderCount() });
      process.exit(0);
      break;
    }
    case 'recover': {
      // A FRESH process (new bootEpoch) recovers: reconcile orphaned intents + stale PROCESSING, then
      // drive the EXISTING relay once. Reports the durable state through governed reads only.
      await journal.load();
      const reconciledIntents = await journal.reconcileOrphanedIntents();
      const reclaimedProcessing = await journal.reconcileStaleProcessing();
      await dispatchOutbox(journal, (e) => sink.record(e));
      await journal.load();
      await sink.reload();
      result({
        records: journal.records(tenant).length,
        outbox: journal.records(tenant).map((r) => r.outbox.status),
        held: journal.heldIntents(tenant).map((h) => h.idempotencyKey),
        delivered: sink.count(tenant),
        orders: await orderCount(),
        reconciledIntents,
        reclaimedProcessing,
      });
      process.exit(0);
      break;
    }
    case 'retry': {
      // A same-key retry AFTER recovery must NOT re-execute the domain effect (returns HOLD if orphaned).
      const r = await run(effect);
      result({ ok: r.ok, error: r.error, replayed: r.replayed, orders: await orderCount() });
      process.exit(0);
      break;
    }
    case 'active-processing': {
      // ACTIVE PROCESSING safety: a record this SAME process just marked PROCESSING (current bootEpoch)
      // must NOT be reclaimed by reconciliation (no time threshold).
      await run(effect);
      const rec = journal.records(tenant)[0];
      await journal.markProcessing(rec.id);
      const reclaimed = await journal.reconcileStaleProcessing();
      result({ status: journal.records(tenant)[0].outbox.status, reclaimed: reclaimed.reclaimed });
      process.exit(0);
      break;
    }
    default:
      console.error(`unknown phase: ${phase}`);
      process.exit(2);
  }
}

main().catch((e) => {
  console.error('CHILD_ERR ' + (e instanceof Error ? e.message : String(e)));
  if (keepAliveTimer) clearInterval(keepAliveTimer);
  process.exit(1);
});
