import { describe, it, expect } from 'vitest';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { ManualClock, type CloudEvent } from '@neuropause/cloud-core';
import { ProviderRegistry, FakeProvider } from './providers';
import { GovernanceRecorder, estimateCost } from './governance';
import { InferencePipeline } from './inference';

function harness() {
  const clock = new ManualClock(1000);
  const runtime = createEnterpriseRuntime({ clock });
  const providers = new ProviderRegistry();
  providers.register(new FakeProvider('fake', ['fake-1']));
  const governance = new GovernanceRecorder(runtime, clock);
  const pipeline = new InferencePipeline(runtime, providers, governance);
  return { clock, runtime, providers, governance, pipeline };
}

describe('provider framework', () => {
  it('registers, lists, and routes by model or explicit id', () => {
    const r = new ProviderRegistry();
    r.register(new FakeProvider('a', ['m1']));
    r.register(new FakeProvider('b', ['m2']));
    expect(r.list()).toHaveLength(2);
    expect(r.route('m1').id).toBe('a');
    expect(r.route('m2', 'b').id).toBe('b');
    expect(() => r.route('nope')).toThrow(/no registered provider/);
    expect(() => r.route('m1', 'ghost')).toThrow(/not registered/);
  });
  it('rejects duplicate provider registration', () => {
    const r = new ProviderRegistry();
    r.register(new FakeProvider('a'));
    expect(() => r.register(new FakeProvider('a'))).toThrow(/already registered/);
  });
});

describe('governed inference', () => {
  it('generates and records governance on the single bus + audit + timeline', async () => {
    const { runtime, pipeline, governance } = harness();
    const events: string[] = [];
    runtime.events().subscribe('ai.*', (e: CloudEvent) => void events.push(e.type));

    const { result, record } = await pipeline.generate(
      { model: 'fake-1', messages: [{ role: 'user', content: 'hello' }] },
      { actor: 'usr_1' },
    );

    expect(result.text).toBe('echo: hello');
    expect(result.usage.totalTokens).toBeGreaterThan(0);
    expect(record.traceId.startsWith('trace_')).toBe(true);
    expect(record.provider).toBe('fake');
    expect(record.ok).toBe(true);
    expect(events).toContain('ai.inference'); // event bus
    expect(governance.history()).toHaveLength(1);
    expect(runtime.audit().verify().valid).toBe(true); // audit chain intact
    expect(runtime.timeline().all().some((e) => e.type === 'ai.inference')).toBe(true); // timeline
  });

  it('cannot bypass audit — a failed generation is still recorded', async () => {
    const { runtime, providers, governance, pipeline } = harness();
    providers.register(
      new FakeProvider('boom', ['bad'], () => {
        throw new Error('provider down');
      }),
    );
    await expect(pipeline.generate({ model: 'bad', messages: [] })).rejects.toThrow('provider down');
    const failed = governance.history().find((r) => r.kind === 'inference' && !r.ok);
    expect(failed).toBeDefined();
    expect(runtime.audit().list().some((a) => a.action === 'ai.inference.error')).toBe(true);
  });

  it('estimates cost from token usage', () => {
    expect(estimateCost('fake-1', { promptTokens: 100, completionTokens: 100, totalTokens: 200 }).usd).toBe(0);
    const c = estimateCost('gpt-x', { promptTokens: 1000, completionTokens: 1000, totalTokens: 2000 });
    expect(c.usd).toBeCloseTo(0.018, 6);
  });
});
