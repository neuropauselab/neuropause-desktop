import { describe, expect, it } from 'vitest';
import { NeuroPauseClient } from '@neuropause/sdk';
import type { Transport, TransportRequest, TransportResponse } from '@neuropause/sdk';
import { runCommand, CLI_VERSION } from './commands';
import type { CredentialStore, StoredCredentials } from './credentials';

class MockTransport implements Transport {
  calls: TransportRequest[] = [];
  constructor(private readonly canned: unknown = []) {}
  async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
    this.calls.push(req);
    return { status: 200, data: this.canned as T, headers: {} };
  }
}

function memStore(initial: StoredCredentials | null = null): { store: CredentialStore; state: { current: StoredCredentials | null } } {
  const state = { current: initial };
  return {
    state,
    store: {
      location: '/tmp/np/credentials.json',
      load: async () => state.current,
      save: async (c) => {
        state.current = c;
      },
      clear: async () => {
        const had = state.current !== null;
        state.current = null;
        return had;
      },
    },
  };
}

function harness(canned: unknown = [], creds?: CredentialStore) {
  const transport = new MockTransport(canned);
  const client = new NeuroPauseClient({ transport });
  const out: string[] = [];
  const err: string[] = [];
  return {
    transport,
    client,
    out,
    err,
    deps: {
      client,
      credentials: creds,
      now: () => 1_000_000,
      out: (l: string) => out.push(l),
      err: (l: string) => err.push(l),
    },
  };
}

function jwt(payload: unknown): string {
  const enc = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(payload)}.sig`;
}

describe('CLI — core', () => {
  it('prints help with no command', async () => {
    const h = harness();
    expect(await runCommand([], h.deps)).toBe(0);
    expect(h.out.join('\n')).toMatch(/neuropause <command>/);
  });

  it('prints the version', async () => {
    const h = harness();
    await runCommand(['version'], h.deps);
    expect(h.out[0]).toBe(CLI_VERSION);
  });

  it('returns a non-zero code on an unknown command', async () => {
    const h = harness();
    expect(await runCommand(['frobnicate'], h.deps)).toBe(1);
  });
});

describe('CLI — ecosystem', () => {
  it('lists marketplace listings via the client', async () => {
    const h = harness([{ id: 'lst_1' }]);
    expect(await runCommand(['marketplace', 'list'], h.deps)).toBe(0);
    expect(h.transport.calls[0]).toMatchObject({ path: '/marketplace/listings' });
  });

  it('filters plugins out of the marketplace listing', async () => {
    const h = harness([{ id: 'a', kind: 'plugin' }, { id: 'b', kind: 'connector' }]);
    await runCommand(['plugins'], h.deps);
    expect(JSON.parse(h.out.join('\n'))).toEqual([{ id: 'a', kind: 'plugin' }]);
  });

  it('publishes from a manifest file', async () => {
    const h = harness({ id: 'ver_1', status: 'in_review' });
    const manifest = JSON.stringify({ kind: 'connector', name: 'C', version: '1.0.0', entry: 'c.js', permissions: [], capabilities: [], dependencies: [], network: [], metadata: {} });
    const code = await runCommand(['publish', 'lst_1', 'm.json'], { ...h.deps, readFile: async () => manifest });
    expect(code).toBe(0);
    expect(h.out.join('\n')).toMatch(/Submitted C 1\.0\.0/);
  });
});

describe('CLI — enterprise API', () => {
  it('lists modules', async () => {
    const h = harness([]);
    await runCommand(['modules'], h.deps);
    expect(h.transport.calls[0]).toMatchObject({ method: 'GET', path: '/modules', scope: 'records:read' });
  });

  it('lists records for a module', async () => {
    const h = harness({ data: [], total: 0, limit: 25, nextCursor: null });
    await runCommand(['records', 'crm-contacts', '--status', 'active', '--limit', '10'], h.deps);
    expect(h.transport.calls[0]).toMatchObject({ method: 'GET', path: '/modules/crm-contacts/records', query: { status: 'active', limit: 10 } });
  });

  it('creates a record from a JSON file', async () => {
    const h = harness({ id: 'rec_1' });
    const code = await runCommand(['records', 'crm-contacts', 'create', 'r.json'], { ...h.deps, readFile: async () => '{"title":"Acme"}' });
    expect(code).toBe(0);
    expect(h.transport.calls[0]).toMatchObject({ method: 'POST', path: '/modules/crm-contacts/records', body: { title: 'Acme' } });
  });

  it('maps a positional query onto module search', async () => {
    const h = harness({ data: [], total: 0, limit: 25, nextCursor: null });
    await runCommand(['records', 'crm-contacts', 'search', 'acme'], h.deps);
    expect(h.transport.calls[0]).toMatchObject({ path: '/modules/crm-contacts/search', query: { q: 'acme' } });
  });

  it('drives the graph, context, timeline, search, automation, health, metrics', async () => {
    const cases: Array<[string[], string]> = [
      [['graph', 'counts'], '/graph/counts'],
      [['graph', 'neighbors', 'n1', '--limit', '5'], '/graph/nodes/n1/neighbors'],
      [['context', 'erp:crm:1'], '/context/erp%3Acrm%3A1'],
      [['timeline', '--limit', '20'], '/timeline'],
      [['search', 'invoice'], '/search'],
      [['automation', 'monitor'], '/automation/monitor'],
      [['health'], '/health'],
      [['metrics', '--windowDays', '30'], '/metrics'],
    ];
    for (const [argv, path] of cases) {
      const h = harness({});
      expect(await runCommand(argv, h.deps)).toBe(0);
      expect(h.transport.calls[0]?.path).toBe(path);
    }
  });

  it('errors (non-zero) when a required argument is missing', async () => {
    const h = harness();
    expect(await runCommand(['records', 'crm', 'get'], h.deps)).toBe(1);
    expect(h.err.join('\n')).toMatch(/usage: neuropause records/);
  });
});

describe('CLI — observability', () => {
  it('fetches OTLP logs and traces with a limit', async () => {
    const logs = harness({ resourceLogs: [] });
    await runCommand(['logs', '--limit', '50'], logs.deps);
    expect(logs.transport.calls[0]).toMatchObject({ path: '/observability/logs', query: { limit: 50 } });

    const traces = harness({ resourceSpans: [] });
    await runCommand(['traces'], traces.deps);
    expect(traces.transport.calls[0]).toMatchObject({ path: '/observability/traces' });
  });

  it('diagnostics composes the health snapshot + gateway metrics', async () => {
    const h = harness({ score: 90 });
    expect(await runCommand(['diagnostics'], h.deps)).toBe(0);
    expect(h.transport.calls.map((c) => c.path)).toEqual(['/observability/health', '/metrics']);
    expect(JSON.parse(h.out.join('\n'))).toHaveProperty('health');
  });
});

describe('CLI — auth', () => {
  it('stores an API key on login --api-key', async () => {
    const m = memStore();
    const h = harness([], m.store);
    expect(await runCommand(['login', '--api-key', 'npk_live_abc', '--base-url', 'https://api.example.com'], h.deps)).toBe(0);
    expect(m.state.current).toMatchObject({ kind: 'api_key', token: 'npk_live_abc', baseUrl: 'https://api.example.com' });
  });

  it('exchanges client credentials for an access token', async () => {
    const m = memStore();
    const h = harness({ access_token: jwt({ sub: 'dev_1', org: 'org_1', scopes: ['records:read'], exp: 2000 }), token_type: 'Bearer', expires_in: 3600, scope: 'records:read' }, m.store);
    const code = await runCommand(['login', '--client-id', 'cid', '--client-secret', 'sec', '--scope', 'records:read'], h.deps);
    expect(code).toBe(0);
    expect(h.transport.calls[0]).toMatchObject({ method: 'POST', path: '/oauth/token' });
    expect(m.state.current).toMatchObject({ kind: 'access_token', scope: 'records:read', expiresAt: 1_000_000 + 3600 * 1000 });
  });

  it('whoami reports the stored identity without leaking the secret', async () => {
    const token = jwt({ sub: 'dev_7', org: 'org_7', scopes: ['graph:read'], exp: 2000 });
    const m = memStore({ kind: 'access_token', token, savedAt: 'now' });
    const h = harness([], m.store);
    await runCommand(['whoami'], h.deps);
    const printed = JSON.parse(h.out.join('\n'));
    expect(printed).toMatchObject({ developerId: 'dev_7', tenant: 'org_7' });
    expect(printed.token).toContain('…');
    expect(printed.token).not.toBe(token);
    expect(String(printed.token).length).toBeLessThan(token.length);
  });

  it('logout clears and reports idempotently', async () => {
    const m = memStore({ kind: 'api_key', token: 'x', savedAt: 'now' });
    const h = harness([], m.store);
    expect(await runCommand(['logout'], h.deps)).toBe(0);
    expect(m.state.current).toBeNull();
    expect(h.out.join('\n')).toMatch(/Logged out/);
  });

  it('whoami without a login is a non-zero exit', async () => {
    const m = memStore(null);
    const h = harness([], m.store);
    expect(await runCommand(['whoami'], h.deps)).toBe(1);
  });
});
