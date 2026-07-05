import { describe, expect, it, vi } from 'vitest';
import type { AutomationRule } from '@neuropause/shared';
import {
  AutomationRunner,
  eventMatchesTrigger,
  selectRulesForEvent,
  type AutomationEvent,
} from './automationRunner';
import { AutomationRunHistory } from './automationRunHistory';

function rule(over: Partial<AutomationRule> = {}): AutomationRule {
  return {
    id: 'auto:1',
    name: 'Notify on investor email',
    trigger: { type: 'connector-event', connectorId: 'gmail', event: 'message.received' },
    conditions: [{ field: 'from', operator: 'contains', value: 'investor' }],
    conditionLogic: 'all',
    actions: [{ id: 'a1', type: 'notify', label: 'Notify', connectorId: 'desktop' }],
    status: 'active',
    createdAt: '2026-01-10T00:00:00.000Z',
    updatedAt: '2026-01-10T00:00:00.000Z',
    ...over,
  };
}

const connectorEvent: AutomationEvent = {
  source: 'connector',
  connectorId: 'gmail',
  event: 'message.received',
  payload: { from: 'investor@x.com' },
};

describe('eventMatchesTrigger (V4.7)', () => {
  it('matches connector triggers on connector + event', () => {
    expect(eventMatchesTrigger(rule(), connectorEvent)).toBe(true);
  });
  it('rejects a different connector', () => {
    expect(eventMatchesTrigger(rule(), { ...connectorEvent, connectorId: 'slack' })).toBe(false);
  });
  it('matches manual + schedule by source', () => {
    expect(
      eventMatchesTrigger(rule({ trigger: { type: 'manual' } }), { source: 'manual', payload: {} }),
    ).toBe(true);
    expect(
      eventMatchesTrigger(rule({ trigger: { type: 'schedule', schedule: 'daily' } }), {
        source: 'schedule',
        payload: {},
      }),
    ).toBe(true);
  });
});

describe('selectRulesForEvent (V4.7)', () => {
  it('selects active rules whose trigger + conditions pass', () => {
    const rules = [rule({ id: 'a' }), rule({ id: 'b', status: 'paused' })];
    const selected = selectRulesForEvent(rules, connectorEvent);
    expect(selected.map((r) => r.id)).toEqual(['a']);
  });
  it('excludes rules whose conditions fail', () => {
    const selected = selectRulesForEvent([rule()], {
      ...connectorEvent,
      payload: { from: 'friend@x.com' },
    });
    expect(selected).toHaveLength(0);
  });
});

describe('AutomationRunner (V4.7)', () => {
  it('runs actions in order and records a successful run', async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true });
    const recordRun = vi.fn().mockResolvedValue(null);
    const emitCompleted = vi.fn();
    let t = 1000;
    const runner = new AutomationRunner(() => [rule()], {
      execute,
      recordRun,
      emitCompleted,
      now: () => (t += 10),
    });
    const record = await runner.runById('auto:1', { from: 'investor@x.com' });
    expect(record?.ok).toBe(true);
    expect(record?.actions).toHaveLength(1);
    expect(execute).toHaveBeenCalledOnce();
    expect(recordRun).toHaveBeenCalledOnce();
    expect(emitCompleted).toHaveBeenCalledOnce();
  });

  it('stops the chain on first failing action and marks the run failed', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, message: 'boom' })
      .mockResolvedValue({ ok: true });
    const emitCompleted = vi.fn();
    const runner = new AutomationRunner(
      () => [
        rule({
          actions: [
            { id: 'a1', type: 'notify', label: 'one' },
            { id: 'a2', type: 'connector-write', label: 'two', connectorId: 'notion' },
            { id: 'a3', type: 'notify', label: 'three' },
          ],
        }),
      ],
      { execute, emitCompleted },
    );
    const record = await runner.runById('auto:1');
    expect(record?.ok).toBe(false);
    expect(record?.error).toBe('boom');
    expect(record?.actions).toHaveLength(2); // stopped after the failure
    expect(execute).toHaveBeenCalledTimes(2);
    expect(emitCompleted).not.toHaveBeenCalled(); // only emits on success
  });

  it('dispatch runs all matching rules for an event', async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true });
    const runner = new AutomationRunner(
      () => [rule({ id: 'a' }), rule({ id: 'b' }), rule({ id: 'c', status: 'paused' })],
      { execute },
    );
    const records = await runner.dispatch(connectorEvent);
    expect(records).toHaveLength(2); // a + b, not the paused c
  });

  it('runById returns null for an unknown/inactive rule', async () => {
    const runner = new AutomationRunner(() => [rule()], {
      execute: vi.fn().mockResolvedValue({ ok: true }),
    });
    expect(await runner.runById('missing')).toBeNull();
  });

  it('catches a throwing action and records the error', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('kaboom'));
    const runner = new AutomationRunner(() => [rule()], { execute });
    const record = await runner.runById('auto:1');
    expect(record?.ok).toBe(false);
    expect(record?.error).toContain('kaboom');
  });
});

describe('AutomationRunHistory (V4.7)', () => {
  function record(ok: boolean, ms: number, id = 'r'): Parameters<AutomationRunHistory['add']>[0] {
    return {
      id,
      ruleId: 'auto:1',
      ruleName: 'x',
      triggeredBy: 'manual',
      startedAt: '2026-01-10T00:00:00.000Z',
      completedAt: '2026-01-10T00:00:01.000Z',
      ok,
      durationMs: ms,
      actions: [],
    };
  }

  it('derives a monitor snapshot from records', () => {
    const h = new AutomationRunHistory();
    h.add(record(true, 100, 'r1'));
    h.add(record(false, 200, 'r2'));
    h.add(record(true, 300, 'r3'));
    const m = h.monitor();
    expect(m.completed).toBe(2);
    expect(m.failed).toBe(1);
    expect(m.averageRuntimeMs).toBe(200);
    expect(m.lastExecution).toBeDefined();
  });

  it('reflects paused count', () => {
    const h = new AutomationRunHistory();
    h.setPaused(3);
    expect(h.monitor().paused).toBe(3);
  });

  it('bounds history to newest-first', () => {
    const h = new AutomationRunHistory();
    h.add(record(true, 10, 'old'));
    h.add(record(true, 20, 'new'));
    expect(h.list()[0].id).toBe('new');
  });
});
