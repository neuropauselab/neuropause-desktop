/**
 * The Decision Records + Holds IPC surface, driven through the REAL handlers.
 *
 * These are the handlers the renderer actually calls, exercised with the real
 * stores over real files and the real Zod schemas — so a contract drift (a
 * renamed field, a rejected payload, a hold that resolves without leaving a
 * trace) fails here rather than on screen.
 *
 * Two properties are load-bearing:
 *  - `assessmentLive: false` must reach the renderer. An empty holds list from
 *    an unbound assessor looks exactly like an all-clear, and presenting it as
 *    one would be the most dangerous lie this surface could tell.
 *  - Resolving a hold must WRITE its own Decision Record. Otherwise the trail
 *    has a gap between "held" and "and then what happened".
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  DecisionRecord,
  DecisionRecordDetail,
  HoldCenterView,
  HoldRecord,
  IpcChannelName,
} from '@neuropause/shared';
import { IpcChannel, RUNTIME_INVOKABLE_CHANNELS } from '@neuropause/shared';
import { initDecisions } from './index';
import { DecisionRecordStore } from './decisionService';
import { HoldStore } from './holdStore';
import { RUNTIME_CHANNEL_PERMISSIONS } from '../ipc/runtimeAuthz';

const T0 = '2026-08-09T12:00:00.000Z';

describe('Decision + Hold IPC', () => {
  let dir: string;
  let decisions: DecisionRecordStore;
  let holds: HoldStore;
  let call: (channel: IpcChannelName, payload: unknown) => Promise<unknown>;
  let audits: string[];
  let live: boolean;

  const openHold = (): HoldRecord =>
    holds.open({
      title: 'Delete customer "Acme Ltd"',
      subject: 'crm-customers/rec_1 (Acme Ltd)',
      reason: 'high_risk',
      why: '1 live dependency.',
      known: ['1 record in finance resolves to "Acme Ltd"'],
      unknown: ['Whether it is still needed.'],
      resolution: 'Archive this record instead.',
      ifProceeding: 'The link stops resolving.',
    });

  beforeEach(async () => {
    dir = join(tmpdir(), `np-dec-ipc-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    audits = [];
    live = true;
    decisions = new DecisionRecordStore(join(dir, 'decisions.json'), () => T0);
    holds = new HoldStore(join(dir, 'holds.json'), () => T0);
    await Promise.all([decisions.load(), holds.load()]);

    const { handlers } = initDecisions({
      decisionRecords: decisions,
      holds,
      assessmentLive: () => live,
      relationshipsDeclared: () => 12,
      actor: () => 'tester@example.com',
      audit: (action, target, summary) => audits.push(`${action}|${target}|${summary}`),
    });
    const byChannel = new Map(handlers.map((h) => [h.channel as string, h]));
    call = async (channel, payload) => {
      const handler = byChannel.get(channel);
      if (!handler) throw new Error(`no handler for ${channel}`);
      return handler.handler(handler.schema.parse(payload));
    };
  });

  afterEach(async () => {
    await Promise.all([holds.flush(), decisions.flush()]);
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });

  it('every channel is registered, classified and reachable', () => {
    for (const channel of [
      IpcChannel.DecisionRecordList,
      IpcChannel.DecisionRecordGet,
      IpcChannel.HoldList,
      IpcChannel.HoldResolve,
    ]) {
      expect(RUNTIME_INVOKABLE_CHANNELS).toContain(channel);
      expect(RUNTIME_CHANNEL_PERMISSIONS[channel]).toBeTruthy();
    }
    // Reads read; the one channel that changes state takes the manage scope.
    expect(RUNTIME_CHANNEL_PERMISSIONS[IpcChannel.HoldList]).toBe('governance:read');
    expect(RUNTIME_CHANNEL_PERMISSIONS[IpcChannel.HoldResolve]).toBe('governance:manage');
  });

  it('hold:list separates open from resolved and reports assessment health', async () => {
    const hold = openHold();
    let view = (await call(IpcChannel.HoldList, {})) as HoldCenterView;
    expect(view.open.map((h) => h.id)).toEqual([hold.id]);
    expect(view.resolved).toEqual([]);
    expect(view.assessmentLive).toBe(true);
    expect(view.relationshipsDeclared).toBe(12);

    await call(IpcChannel.HoldResolve, { id: hold.id, outcome: 'took_alternative' });
    view = (await call(IpcChannel.HoldList, {})) as HoldCenterView;
    expect(view.open).toEqual([]);
    expect(view.resolved.map((h) => h.id)).toEqual([hold.id]);
  });

  it('an unbound assessor is reported as such — an empty list is NOT an all-clear', async () => {
    live = false;
    const view = (await call(IpcChannel.HoldList, {})) as HoldCenterView;
    expect(view.open).toEqual([]);
    expect(view.assessmentLive).toBe(false);
  });

  it('resolving writes its own Decision Record, audits, and is not repeatable', async () => {
    const hold = openHold();
    const resolved = (await call(IpcChannel.HoldResolve, {
      id: hold.id,
      outcome: 'took_alternative',
      note: 'Archived instead.',
    })) as HoldRecord | null;

    expect(resolved?.status).toBe('resolved');
    expect(resolved?.resolvedOutcome).toBe('took_alternative');
    expect(resolved?.resolvedNote).toBe('Archived instead.');

    const records = (await call(IpcChannel.DecisionRecordList, {})) as DecisionRecord[];
    expect(records).toHaveLength(1);
    expect(records[0]!.requestedAction).toBe('Resolve hold: Delete customer "Acme Ltd"');
    expect(records[0]!.actor).toBe('tester@example.com');
    expect(records[0]!.holdId).toBe(hold.id);
    // The evidence carried forward is what was known AT HOLD TIME, not now.
    expect(records[0]!.assessment.evidence[0]!.detail).toContain('Acme Ltd');
    expect(audits[0]).toContain('hold.resolved');

    // A second resolve is a no-op: no phantom hold, no second record.
    expect(await call(IpcChannel.HoldResolve, { id: hold.id, outcome: 'cancelled' })).toBeNull();
    expect(((await call(IpcChannel.DecisionRecordList, {})) as DecisionRecord[]).length).toBe(1);
  });

  it('an omitted note falls back to the outcome label, never to an empty string', async () => {
    const hold = openHold();
    const resolved = (await call(IpcChannel.HoldResolve, {
      id: hold.id,
      outcome: 'cancelled',
      note: '   ',
    })) as HoldRecord | null;
    expect(resolved?.resolvedNote).toBe('Cancelled');
  });

  it('decisionRecord:get reconstructs the subject history and its hold', async () => {
    const hold = openHold();
    await call(IpcChannel.HoldResolve, { id: hold.id, outcome: 'cancelled' });
    const [record] = (await call(IpcChannel.DecisionRecordList, {})) as DecisionRecord[];

    const detail = (await call(IpcChannel.DecisionRecordGet, {
      id: record!.id,
    })) as DecisionRecordDetail | null;
    expect(detail?.record.id).toBe(record!.id);
    expect(detail?.hold?.id).toBe(hold.id);
    expect(detail?.subjectHistory.map((r) => r.id)).toEqual([record!.id]);
  });

  it('an unknown id is null, not a throw — a missing record is a normal answer', async () => {
    expect(await call(IpcChannel.DecisionRecordGet, { id: 'dec_nope' })).toBeNull();
    expect(await call(IpcChannel.HoldResolve, { id: 'hold_nope', outcome: 'cancelled' })).toBeNull();
  });

  it('the schemas reject junk before a handler ever sees it', () => {
    expect(() => HoldResolveParse({ id: 'x', outcome: 'exploded' })).toThrow();
    expect(() => HoldResolveParse({ id: '', outcome: 'cancelled' })).toThrow();
    expect(() => HoldResolveParse({ id: 'x', outcome: 'cancelled', extra: 1 })).toThrow();
  });
});

// Imported lazily to keep the assertion above readable.
function HoldResolveParse(payload: unknown): unknown {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
  const { HoldResolveRequest } = require('@neuropause/shared');
  return HoldResolveRequest.parse(payload);
}
