import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime, type EnterpriseRuntime } from '@neuropause/runtime';
import { createAutomationPlatform, type AutomationPlatform } from './platform';
import type { WorkflowDefinition } from './types';

describe('Modules 2,5,6 — Automation Engine, Scheduler, Events, Notifications', () => {
  let runtime: EnterpriseRuntime;
  let auto: AutomationPlatform;
  let clock: ManualClock;
  const T = 'tenant-acme';
  const trivial = (id: string): WorkflowDefinition => ({ id, name: id, version: 1, mode: 'sequential', steps: [{ name: 'a', kind: 'action', action: async () => 'x' }] });

  beforeAll(() => {
    clock = new ManualClock(1_000_000);
    runtime = createEnterpriseRuntime({ clock });
    auto = createAutomationPlatform(runtime, { clock });
  });
  afterAll(() => {
    auto.events().stop();
  });

  it('orders a priority queue and honors delayed execution', async () => {
    auto.workflows().register(trivial('p'));
    auto.automation().enqueue({ workflowId: 'p', tenantId: T, actor: 'a', priority: 'low' });
    auto.automation().enqueue({ workflowId: 'p', tenantId: T, actor: 'a', priority: 'urgent' });
    auto.automation().enqueue({ workflowId: 'p', tenantId: T, actor: 'a', priority: 'normal', delayMs: 100_000 });
    expect(auto.automation().queued()[0].priority).toBe('urgent');
    expect(auto.automation().queueDepth()).toBe(3);
    const ran = await auto.automation().runDue(); // the delayed job isn't ready
    expect(ran.length).toBe(2);
    expect(auto.automation().queueDepth()).toBe(1);
  });

  it('fires recurring scheduled workflows on tick', async () => {
    auto.workflows().register(trivial('sched'));
    auto.scheduler().schedule({ workflowId: 'sched', tenantId: T, actor: 'system', everyMs: 1000 });
    const fired1 = auto.scheduler().tick();
    expect(fired1.length).toBeGreaterThanOrEqual(1);
    clock.advance(2500); // 2 more intervals become due
    const fired2 = auto.scheduler().tick();
    expect(fired2.length).toBe(2);
    const execs = await auto.scheduler().drain();
    expect(execs.filter((e) => e.trigger === 'scheduled').length).toBeGreaterThanOrEqual(3); // 1 + 2 fired above
  });

  it('conditional + manual triggers', async () => {
    auto.workflows().register(trivial('cond'));
    expect(auto.automation().conditionalTrigger('cond', () => false, { tenantId: T, actor: 'a' })).toBeNull();
    expect(auto.automation().conditionalTrigger('cond', () => true, { tenantId: T, actor: 'a' })).not.toBeNull();
    auto.automation().manualTrigger('cond', { tenantId: T, actor: 'a' });
    const ran = await auto.automation().drain();
    expect(ran.length).toBeGreaterThanOrEqual(2);
  });

  it('reacts to internal runtime events (live), and marks external SaaS patterns infra-pending', async () => {
    auto.workflows().register(trivial('on-event'));
    const rx = auto.events().on('custom.thing', 'on-event', { tenantId: T, actor: 'system' });
    expect(rx.live).toBe(true);
    const external = auto.events().on('webhook.github', 'on-event', { tenantId: T, actor: 'system' });
    expect(external.live).toBe(false); // external SaaS webhook delivery is infra-pending
    const depthBefore = auto.automation().queueDepth();
    await runtime.events().publish({ type: 'custom.thing', topic: 'test', partitionKey: T, version: 1, payload: { x: 1 } });
    expect(auto.automation().queueDepth()).toBeGreaterThan(depthBefore);
    expect(auto.events().liveReactions().some((r) => r.pattern === 'custom.thing')).toBe(true);
  });

  it('delivers in-app notifications and honestly queues external channels as infra-pending', async () => {
    const inApp = await auto.notifications().send({ tenantId: T, channel: 'in-app', to: 'ada', subject: 'Hi', body: 'there' });
    expect(inApp.status).toBe('sent');
    const email = await auto.notifications().send({ tenantId: T, channel: 'email', to: 'ada@x.test', subject: 'Hi', body: 'there' });
    expect(email.status).toBe('queued');
    expect(email.detail).toContain('infra-pending');
    const digest = await auto.notifications().digest(T, 'ada', [{ subject: 'a', body: '1' }, { subject: 'b', body: '2' }]);
    expect(digest.status).toBe('sent');
    const esc = await auto.notifications().escalate(inApp.id);
    expect(esc!.priority).toBe('urgent');
    expect(auto.notifications().preferences('nobody').channels).toEqual(['in-app']);
  });
});
