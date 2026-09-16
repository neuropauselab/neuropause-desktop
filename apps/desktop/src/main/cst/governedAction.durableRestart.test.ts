/**
 * P13C H-FINDING-4 (Option C) — restart-durable single-use through the FULL governed-action path.
 *
 * Each "restart" builds a FRESH DurableIdempotencyStore from the SAME file path (no shared memory),
 * then runs governedAction again. The durable intent recovered from disk drives the CST kernel's
 * replay/reconciliation control flow, so a previously-admitted consequential action does NOT produce
 * a second effect after restart. Effect count is the injected action's own counter.
 *
 * Scope: SINGLE-PROCESS restart durability, atomic-rename persistence. NOT fsync/power-loss, NOT
 * cross-process. mail.send and the canonical identity formula are unchanged.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { governedAction, createGovernedActionPorts, type GovernedActionArgs } from './governedAction';
import { DurableIdempotencyStore } from './durableIdempotencyStore';
import { NetworkError, type HttpClient, type RateGate } from '../unified/sync/http';
import { type WriteAction } from '../connectors/m365/actionSdk';

const RATE = {} as unknown as RateGate;
const okHttp = { deleteJson: async () => ({ data: {}, headers: {}, status: 204 }) } as unknown as HttpClient;

function stubAction(run: WriteAction['run'], id = 'calendar.delete'): WriteAction {
  return { id, label: 'Delete meeting', domain: 'calendar', scopes: ['Calendars.ReadWrite'], mutates: true, run };
}

let dir: string;
let path: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nps-gov-restart-'));
  path = join(dir, 'm365-governed-actions.json');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Build governed-action args backed by a FRESH durable store at the shared path (models a restart). */
function argsFor(state: { calls: number }, over: Partial<GovernedActionArgs> = {}): GovernedActionArgs {
  return {
    action: stubAction(async () => {
      state.calls += 1;
      return { ok: true, summary: 'Deleted meeting e1' };
    }),
    connectorId: 'microsoft-entra',
    accountId: 'acct-1',
    params: { eventId: 'e1' },
    confirmed: true,
    tenantId: 'org-test',
    actorId: 'user-1',
    ownsAccount: true,
    grantedScopes: ['Calendars.ReadWrite'],
    getToken: async () => 'tok',
    makeHttp: () => okHttp,
    rate: RATE,
    now: () => '2026-01-01T00:00:00.000Z',
    ports: createGovernedActionPorts(new DurableIdempotencyStore(path)),
    ...over,
  };
}

describe('governedAction — single-process restart durability (Option C)', () => {
  it('admitted action + RESTART + exact replay ⇒ NO second effect', async () => {
    const s = { calls: 0 };
    const first = await governedAction(argsFor(s)); // process A
    expect(first.semanticOutcome).toBe('ACKNOWLEDGED');
    expect(s.calls).toBe(1);
    // process B: brand-new store from the same file hydrates the DONE intent.
    const replay = await governedAction(argsFor(s));
    expect(s.calls).toBe(1); // durable single-use: no second effect after restart
    expect(replay.effectCalls).toBe(0);
    expect(replay.semanticOutcome).not.toBe('ACKNOWLEDGED'); // suppressed/HOLD, not a fresh ack
  });

  it('RESTART + reordered-key replay ⇒ same canonical identity ⇒ NO second effect', async () => {
    const s = { calls: 0 };
    await governedAction(argsFor(s, { params: { eventId: 'e1', reason: 'cleanup' } }));
    expect(s.calls).toBe(1);
    const replay = await governedAction(argsFor(s, { params: { reason: 'cleanup', eventId: 'e1' } }));
    expect(s.calls).toBe(1);
    expect(replay.effectCalls).toBe(0);
  });

  it('RESTART + DIFFERENT consequential params ⇒ different identity ⇒ executes independently', async () => {
    const s = { calls: 0 };
    await governedAction(argsFor(s, { params: { eventId: 'e1' } }));
    const second = await governedAction(argsFor(s, { params: { eventId: 'e2' } }));
    expect(s.calls).toBe(2);
    expect(second.effectCalls).toBe(1);
  });

  it('RESTART after a NetworkError (UNKNOWN) ⇒ replay reconciles/HOLDs, NEVER re-executes', async () => {
    const s = { calls: 0 };
    const first = await governedAction(
      argsFor(s, { action: stubAction(async () => { s.calls += 1; throw new NetworkError('aborted'); }) }),
    );
    expect(first.semanticOutcome).toBe('UNKNOWN');
    expect(s.calls).toBe(1);
    // Restart + replay: the durable intent prevents a blind duplicate; the effect is NOT retried.
    const replay = await governedAction(argsFor(s));
    expect(s.calls).toBe(1);
    expect(replay.effectCalls).toBe(0);
  });

  it('fresh/empty durable store ⇒ a new action executes normally', async () => {
    const s = { calls: 0 };
    const g = await governedAction(argsFor(s));
    expect(g.semanticOutcome).toBe('ACKNOWLEDGED');
    expect(s.calls).toBe(1);
  });

  it('concurrent duplicates within one process (durable ports) ⇒ exactly one effect', async () => {
    const s = { calls: 0 };
    const ports = createGovernedActionPorts(new DurableIdempotencyStore(path));
    await Promise.all([governedAction(argsFor(s, { ports })), governedAction(argsFor(s, { ports }))]);
    expect(s.calls).toBe(1);
  });
});
