import { describe, it, expect } from 'vitest';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { ManualClock } from '@neuropause/cloud-core';
import { ConnectorGovernance } from './governance';
import { TriggerEngine } from './triggers';
import { AutomationEngine } from './automation';
import { ConnectorObservability } from './observability';

function harness() {
  const clock = new ManualClock(0);
  const runtime = createEnterpriseRuntime({ clock });
  const governance = new ConnectorGovernance(runtime, clock);
  return { clock, runtime, governance };
}

describe('TriggerEngine', () => {
  it('fires manual + event + schedule triggers through the shared bus/scheduler', async () => {
    const { runtime, clock } = harness();
    const engine = new TriggerEngine(runtime);
    const fired: string[] = [];
    engine.onFire((t) => void fired.push(t.id));
    engine.register({ id: 'manual1', kind: 'manual', automation: 'a1' });
    engine.register({ id: 'evt1', kind: 'event', eventPattern: 'thing.*', automation: 'a2' });
    engine.register({ id: 'sched1', kind: 'schedule', intervalMs: 100, automation: 'a3' });

    await engine.fire('manual1', {});
    await runtime.events().publish({ type: 'thing.happened', topic: 'x', partitionKey: 'p', version: 1, payload: {} });
    clock.advance(100);
    await runtime.scheduler().tick();

    expect(fired.sort()).toEqual(['evt1', 'manual1', 'sched1']);
  });
  it('disabled triggers do not fire', async () => {
    const { runtime } = harness();
    const engine = new TriggerEngine(runtime);
    let count = 0;
    engine.onFire(() => void count++);
    engine.register({ id: 't', kind: 'manual', automation: 'a' });
    engine.disable('t');
    await engine.fire('t', {});
    expect(count).toBe(0);
  });
});

describe('AutomationEngine', () => {
  it('runs sequential steps, records governance, produces checkpoints', async () => {
    const { runtime, governance } = harness();
    const engine = new AutomationEngine(runtime, governance);
    const order: string[] = [];
    engine.register({
      id: 'flow',
      steps: [
        { name: 's1', run: async () => void order.push('s1') },
        { name: 's2', run: async () => void order.push('s2') },
      ],
    });
    const res = await engine.run('flow', { actor: 'usr_1' });
    expect(res.ok).toBe(true);
    expect(res.completed).toEqual(['s1', 's2']);
    expect(res.checkpoints).toEqual(['s1', 's2']);
    expect(governance.history().some((r) => r.connectorId === 'automation:flow' && r.ok)).toBe(true);
    expect(runtime.audit().verify().valid).toBe(true);
  });
  it('rolls back on failure and supports checkpoint recovery (replayable)', async () => {
    const { runtime, governance } = harness();
    const engine = new AutomationEngine(runtime, governance);
    let attempt = 0;
    const undone: string[] = [];
    engine.register({
      id: 'recover',
      steps: [
        { name: 'a', run: async () => undefined, compensate: async () => void undone.push('a') },
        { name: 'b', run: async () => { if (attempt++ === 0) throw new Error('boom'); } },
      ],
    });
    const first = await engine.run('recover');
    expect(first.ok).toBe(false);
    expect(first.failed).toBe('b');
    expect(first.rolledBack).toEqual(['a']);
    expect(first.checkpoints).toEqual(['a']);

    const second = await engine.run('recover', { resumeFrom: ['a'] });
    expect(second.ok).toBe(true);
    expect(second.completed).toEqual(['a', 'b']);
  });
  it('queue: enqueue + runNext + queueDepth', async () => {
    const { runtime, governance } = harness();
    const engine = new AutomationEngine(runtime, governance);
    engine.register({ id: 'q', steps: [{ name: 's', run: async () => undefined }] });
    engine.enqueue('q');
    engine.enqueue('q');
    expect(engine.queueDepth()).toBe(2);
    expect((await engine.runNext())?.ok).toBe(true);
    expect(engine.queueDepth()).toBe(1);
    await engine.runNext();
    expect(await engine.runNext()).toBeNull();
  });
});

describe('ConnectorObservability', () => {
  it('aggregates metrics from execution samples', () => {
    const { runtime } = harness();
    const obs = new ConnectorObservability(runtime);
    obs.observe('gh', { ok: true, retries: 0, latencyMs: 10 });
    obs.observe('gh', { ok: false, retries: 2, latencyMs: 30 });
    const m = obs.metrics('gh');
    expect(m).toMatchObject({ calls: 2, errors: 1, errorRate: 0.5, retries: 2, avgLatencyMs: 20 });
    obs.setQueueDepth(5);
    expect(obs.queueDepth()).toBe(5);
    expect(runtime.observability().metrics.snapshot().counters['connector.gh.calls']).toBe(2);
  });
});
