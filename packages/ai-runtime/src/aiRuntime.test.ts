import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { ManualClock, type CloudEvent } from '@neuropause/cloud-core';
import { createAiRuntime, FakeProvider } from './index';

describe('createAiRuntime (integration)', () => {
  it('runs a governed agent→inference→tool flow: audited, observable, traceable', async () => {
    const clock = new ManualClock(0);
    const runtime = createEnterpriseRuntime({ clock });
    const ai = createAiRuntime(runtime, { clock });

    ai.providers().register(new FakeProvider('fake', ['fake-1']));
    ai.tools().register({
      name: 'lookup',
      permissions: ['db:read'],
      schema: z.object({ id: z.string() }),
      execute: async (a) => ({ row: a.id }),
    });
    ai.agents().register({
      name: 'assistant',
      kind: 'task',
      run: async (input: { question: string }, ctx) => {
        const gen = await ai.ai().generate(
          { model: 'fake-1', messages: [{ role: 'user', content: input.question }] },
          { actor: ctx.actor },
        );
        const tool = await ai.tools().call('lookup', { id: 'x1' }, { actor: ctx.actor, grants: ['db:read'] });
        return { answer: gen.result.text, tool };
      },
    });

    const aiEvents: string[] = [];
    runtime.events().subscribe('ai.*', (e: CloudEvent) => void aiEvents.push(e.type));

    const out = await ai.agents().execute<{ question: string }, { answer: string; tool: unknown }>(
      'assistant',
      { question: 'hi' },
      'usr_1',
    );
    expect(out.answer).toBe('echo: hi');
    expect(out.tool).toEqual({ row: 'x1' });

    // every kind of execution is recorded (governance)
    expect(ai.governance().history().map((r) => r.kind).sort()).toEqual(['agent', 'inference', 'tool']);
    // observable on the single event bus + timeline
    expect(aiEvents).toEqual(expect.arrayContaining(['ai.inference', 'ai.tool', 'ai.agent']));
    expect(runtime.timeline().all().filter((e) => e.type.startsWith('ai.')).length).toBeGreaterThanOrEqual(3);
    // auditable + tamper-evident
    expect(runtime.audit().verify().valid).toBe(true);
    // token usage + cost captured
    const inf = ai.governance().history().find((r) => r.kind === 'inference');
    expect(inf?.usage?.totalTokens).toBeGreaterThan(0);
    expect(inf?.cost?.usd).toBe(0); // fake-1 is free
  });

  it('exposes the full AI runtime API surface', () => {
    const runtime = createEnterpriseRuntime({ clock: new ManualClock(0) });
    const ai = createAiRuntime(runtime, { clock: new ManualClock(0) });
    expect(ai.version).toContain('preview');
    for (const fn of [
      ai.ai,
      ai.providers,
      ai.agents,
      ai.tools,
      ai.connectors,
      ai.workflows,
      ai.sessions,
      ai.memory,
      ai.context,
      ai.governance,
    ]) {
      expect(typeof fn).toBe('function');
    }
  });
});
