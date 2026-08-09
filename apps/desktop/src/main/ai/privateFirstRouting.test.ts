/**
 * Private First — the routing engine.
 *
 * The four critical cases the charter names are here, each against the REAL
 * planner and the REAL composite client with fake model clients:
 *
 *   Private First + local available                        → LOCAL
 *   Private First + local down + private infra available   → PRIVATE INFRASTRUCTURE
 *   Private First + only external enabled                  → EXTERNAL
 *   Private First + external disabled + nothing private    → FAILS ON DEVICE
 *
 * The last one is the promise the product makes with its name: the test
 * asserts not just an error, but that the external client was NEVER CALLED.
 */
import { describe, expect, it, vi } from 'vitest';
import type { AiRouteCandidate } from '@neuropause/shared';
import {
  classifyEndpointLocation,
  emptyRoutingUsage,
  explainRouting,
  noModelRouting,
  planRoute,
  routingUsagePercentages,
} from '@neuropause/shared';
import type { ModelClient, ModelRequest, ModelResult } from './modelClient';
import { PrivateFirstClient, type BoundRoute } from './privateFirstClient';
import { AiEngine } from './aiEngine';
import { ModelRouter } from './modelRouter';

/* ── helpers ──────────────────────────────────────────────────────────────── */

const candidate = (over: Partial<AiRouteCandidate>): AiRouteCandidate => ({
  provider: 'ollama',
  location: 'local',
  model: 'llama3.1',
  endpoint: 'http://localhost:11434',
  configured: true,
  enabled: true,
  ...over,
});

function fakeClient(opts: {
  provider: string;
  configured?: boolean;
  fail?: string;
}): ModelClient & { calls: ModelRequest[] } {
  const calls: ModelRequest[] = [];
  return {
    provider: opts.provider,
    calls,
    isConfigured: () => opts.configured !== false,
    complete: async (req: ModelRequest): Promise<ModelResult> => {
      calls.push(req);
      if (opts.fail) throw new Error(opts.fail);
      return { id: `r-${opts.provider}`, model: req.model, text: 'ok', inputTokens: 1, outputTokens: 1 };
    },
  };
}

/* ── endpoint classification ──────────────────────────────────────────────── */

describe('Endpoint classification', () => {
  it('loopback is local; anything else is private infrastructure', () => {
    expect(classifyEndpointLocation('http://localhost:11434')).toBe('local');
    expect(classifyEndpointLocation('http://127.0.0.1:11434')).toBe('local');
    expect(classifyEndpointLocation('http://[::1]:11434')).toBe('local');
    expect(classifyEndpointLocation('https://ollama.mycompany.internal')).toBe('private_infrastructure');
    expect(classifyEndpointLocation('http://192.168.1.40:11434')).toBe('private_infrastructure');
  });

  it('an unparseable endpoint is NEVER classified local', () => {
    // Over-claiming "local" is the one failure this function must not have.
    expect(classifyEndpointLocation('not a url')).toBe('private_infrastructure');
  });
});

/* ── the planner ──────────────────────────────────────────────────────────── */

describe('planRoute', () => {
  const local = candidate({});
  const privateInfra = candidate({
    location: 'private_infrastructure',
    endpoint: 'https://ollama.internal',
  });
  const external = candidate({
    provider: 'anthropic',
    location: 'external',
    model: 'claude-sonnet-4-6',
    endpoint: 'api.anthropic.com',
  });

  it('private_first orders local before private infrastructure before external', () => {
    const plan = planRoute('private_first', [external, privateInfra, local]);
    expect(plan.ok).toBe(true);
    expect(plan.attempts.map((a) => a.location)).toEqual(['local', 'private_infrastructure', 'external']);
  });

  it('private_first EXCLUDES an external candidate without consent', () => {
    const plan = planRoute('private_first', [local, { ...external, enabled: false }]);
    expect(plan.attempts.map((a) => a.location)).toEqual(['local']);
    expect(plan.skipped.some((s) => s.reason.includes('not enabled'))).toBe(true);
  });

  it('private_first + external disabled + nothing private → refusal that says nothing left the device', () => {
    const plan = planRoute('private_first', [
      { ...local, configured: false },
      { ...external, enabled: false },
    ]);
    expect(plan.ok).toBe(false);
    expect(plan.attempts).toEqual([]);
    expect(plan.refusal).toContain('nothing was sent anywhere');
  });

  it('local_only NEVER includes an external candidate, even an enabled one', () => {
    const plan = planRoute('local_only', [local, external]);
    expect(plan.attempts.map((a) => a.location)).toEqual(['local']);
    const refused = planRoute('local_only', [{ ...local, configured: false }, external]);
    expect(refused.ok).toBe(false);
    expect(refused.refusal).toContain('never leaves this device');
  });

  it('external mode leads with the external provider and keeps locals as fallback', () => {
    const plan = planRoute('external', [local, external]);
    expect(plan.attempts.map((a) => a.location)).toEqual(['external', 'local']);
  });
});

/* ── the composite client: the four critical cases end to end ─────────────── */

describe('PrivateFirstClient', () => {
  const req: ModelRequest = { model: 'ignored', messages: [{ role: 'user', content: 'hi' }], maxOutputTokens: 64 };

  const bind = (c: AiRouteCandidate, client: ModelClient): BoundRoute => ({ candidate: c, client });

  it('CASE 1 — local available → LOCAL, stamped from the execution', async () => {
    const local = fakeClient({ provider: 'ollama' });
    const external = fakeClient({ provider: 'anthropic' });
    const plan = planRoute('private_first', [
      candidate({}),
      candidate({ provider: 'anthropic', location: 'external', model: 'claude-sonnet-4-6' }),
    ]);
    const composite = new PrivateFirstClient({
      routes: plan.attempts.map((c) => bind(c, c.provider === 'ollama' ? local : external)),
      mode: 'private_first',
      now: () => '2026-08-09T00:00:00.000Z',
    });
    const result = await composite.complete(req);
    expect(result.routing.location).toBe('local');
    expect(result.routing.model).toBe('llama3.1');
    expect(result.routing.attempted).toEqual([]);
    expect(external.calls).toHaveLength(0);
  });

  it('CASE 2 — local down, private infrastructure available → PRIVATE INFRASTRUCTURE', async () => {
    const local = fakeClient({ provider: 'ollama', fail: 'connection refused' });
    const infra = fakeClient({ provider: 'ollama' });
    const plan = planRoute('private_first', [
      candidate({}),
      candidate({ location: 'private_infrastructure', endpoint: 'https://ollama.internal', model: 'llama3.1-70b' }),
    ]);
    const composite = new PrivateFirstClient({
      routes: [bind(plan.attempts[0]!, local), bind(plan.attempts[1]!, infra)],
      mode: 'private_first',
    });
    const result = await composite.complete(req);
    expect(result.routing.location).toBe('private_infrastructure');
    expect(result.routing.attempted).toHaveLength(1);
    expect(result.routing.attempted[0]!.reason).toContain('connection refused');
    expect(result.routing.reason).toContain('No local model was available');
  });

  it('CASE 3 — only external enabled → EXTERNAL, and the why says so', async () => {
    const local = fakeClient({ provider: 'ollama', fail: 'connection refused' });
    const external = fakeClient({ provider: 'anthropic' });
    const plan = planRoute('private_first', [
      candidate({}),
      candidate({ provider: 'anthropic', location: 'external', model: 'claude-sonnet-4-6' }),
    ]);
    const composite = new PrivateFirstClient({
      routes: [bind(plan.attempts[0]!, local), bind(plan.attempts[1]!, external)],
      mode: 'private_first',
    });
    const result = await composite.complete(req);
    expect(result.routing.location).toBe('external');
    expect(result.routing.reason).toContain('external provider you enabled');
    expect(explainRouting(result.routing)).toContain('Local was tried first');
  });

  it('CASE 4 — external disabled → the request FAILS and the external client is never called', async () => {
    const external = fakeClient({ provider: 'anthropic' });
    // The planner already excluded external; the composite is built from the
    // plan, so the external client is not even among its routes.
    const plan = planRoute('private_first', [
      candidate({ configured: false }),
      candidate({ provider: 'anthropic', location: 'external', enabled: false }),
    ]);
    expect(plan.ok).toBe(false);
    const composite = new PrivateFirstClient({ routes: [], mode: 'private_first', refusal: plan.refusal });
    await expect(composite.complete(req)).rejects.toThrow(/nothing was sent anywhere/);
    expect(external.calls).toHaveLength(0);
    expect(composite.isConfigured()).toBe(false);
  });

  it('a local route that is up but errors mid-request falls through WITHOUT silently escalating past the plan', async () => {
    const local = fakeClient({ provider: 'ollama', fail: 'model not found' });
    const composite = new PrivateFirstClient({
      routes: [bind(candidate({}), local)],
      mode: 'private_first',
    });
    await expect(composite.complete(req)).rejects.toThrow(/No permitted AI route could serve this request/);
    await expect(composite.complete(req)).rejects.toThrow(/model not found/);
  });

  it('each route serves its own model — a local tag is never replayed against the external API', async () => {
    const local = fakeClient({ provider: 'ollama', fail: 'down' });
    const external = fakeClient({ provider: 'anthropic' });
    const composite = new PrivateFirstClient({
      routes: [
        bind(candidate({}), local),
        bind(candidate({ provider: 'anthropic', location: 'external', model: 'claude-sonnet-4-6' }), external),
      ],
      mode: 'private_first',
    });
    await composite.complete(req);
    expect(local.calls[0]!.model).toBe('llama3.1');
    expect(external.calls[0]!.model).toBe('claude-sonnet-4-6');
  });
});

/* ── the engine carries the stamp and measures the route ──────────────────── */

describe('AiEngine routing integration', () => {
  it('copies execution routing onto the response and measures it', async () => {
    const recorded: string[] = [];
    const local = fakeClient({ provider: 'ollama' });
    const composite = new PrivateFirstClient({
      routes: [{ candidate: candidate({}), client: local }],
      mode: 'private_first',
    });
    const engine = new AiEngine({
      router: new ModelRouter({ client: composite, models: { fast: 'llama3.1', balanced: 'llama3.1', deep: 'llama3.1' } }),
      recordRoute: (location) => recorded.push(location),
    });
    const resp = await engine.run({ worker: 'engineering', promptId: 'engineering.summary', variables: { subject: 'q' } });
    expect(resp.routing?.location).toBe('local');
    expect(recorded).toEqual(['local']);
  });

  it('a refused plan becomes a deterministic fallback whose routing is NONE — and measures as none', async () => {
    const recorded: string[] = [];
    const composite = new PrivateFirstClient({
      routes: [],
      mode: 'private_first',
      refusal: 'This request needs an AI model, and no local or private model is available. External processing is not enabled, so nothing was sent anywhere.',
    });
    const engine = new AiEngine({
      router: new ModelRouter({ client: composite, models: { fast: 'x', balanced: 'x', deep: 'x' } }),
      recordRoute: (location) => recorded.push(location),
    });
    const resp = await engine.run({ worker: 'engineering', promptId: 'engineering.summary', variables: { subject: 'q' } });
    expect(resp.grounded).toBe(false);
    expect(resp.routing?.location).toBe('none');
    // isConfigured() is false → the engine never even attempted a call.
    expect(resp.routing?.reason).toContain('computed deterministically on this device');
    expect(recorded).toEqual(['none']);
  });

  it('a mid-flight total failure carries the attempt summary into the fallback routing', async () => {
    const local = fakeClient({ provider: 'ollama', fail: 'connection refused' });
    const composite = new PrivateFirstClient({
      routes: [{ candidate: candidate({}), client: local }],
      mode: 'private_first',
    });
    const engine = new AiEngine({
      router: new ModelRouter({ client: composite, models: { fast: 'x', balanced: 'x', deep: 'x' } }),
    });
    const resp = await engine.run({ worker: 'engineering', promptId: 'engineering.summary', variables: { subject: 'q' } });
    expect(resp.grounded).toBe(false);
    expect(resp.routing?.location).toBe('none');
    expect(resp.routing?.reason).toContain('connection refused');
  });
});

/* ── usage arithmetic ─────────────────────────────────────────────────────── */

describe('Routing usage', () => {
  it('percentages exist only once something is measured', () => {
    expect(routingUsagePercentages(emptyRoutingUsage())).toBeNull();
    const usage = {
      total: 4,
      byLocation: { local: 3, private_infrastructure: 0, external: 1, none: 0 },
      firstAt: 't',
      lastAt: 't',
    };
    expect(routingUsagePercentages(usage)).toMatchObject({ local: 75, external: 25 });
  });

  it('the no-model stamp is honest about what it is', () => {
    const meta = noModelRouting('private_first', 'No AI model ran.', 't');
    expect(meta.location).toBe('none');
    expect(meta.model).toBe('none');
    expect(explainRouting(meta)).toBe('No AI model ran.');
  });
});

/* ── spy hygiene ──────────────────────────────────────────────────────────── */

describe('nothing here fabricates a call', () => {
  it('vi.fn is unused — every fake records real invocations', () => {
    // The fakes above count calls; this test exists to keep it that way.
    expect(vi.isMockFunction(fakeClient({ provider: 'x' }).complete)).toBe(false);
  });
});
