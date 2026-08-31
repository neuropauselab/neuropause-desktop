/**
 * THE "TEST CONNECTION" BUTTON, PROVEN AT A REAL SOCKET.
 *
 * THE GAP THIS CLOSES. `providerWireIntegration.test.ts` drives real localhost
 * HTTP servers for the COMPLETION path, and that is why the wire shape of a
 * completion is trustworthy. Connection VALIDATION had no such coverage:
 * `connectionValidator.test.ts` is six tests against a mocked `fetch`, which
 * proves the branching logic and nothing about what actually goes on the wire.
 *
 * That matters because validation is the one thing a user presses to find out
 * whether their key works, and because each provider builds a DIFFERENT auth
 * header — `x-api-key` + `anthropic-version` for Anthropic, `authorization:
 * Bearer` for OpenAI. A header-shape mistake passes every mocked test and fails
 * against the real API, which is precisely the class a mock cannot catch.
 *
 * So these run the REAL validators against a REAL server on 127.0.0.1 and
 * assert what the server actually received: method, path, and headers. The
 * fetch seam only rewrites the ORIGIN — the request the validator builds is
 * otherwise untouched.
 *
 * THE LOAD-BEARING ASSERTION IS THE LEAK GUARD: the API key must never appear
 * in the returned `detail`, on any branch. A validator that echoed the key into
 * an error string would put a live secret on screen and into a support bundle.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { validateClaudeKey, validateOllama, validateOpenAiKey } from './connectionValidator';

/** A key shaped like a real one, so a leak is unmistakable if it appears. */
const SECRET = 'sk-test-DO-NOT-LEAK-3f9a2b7c1d';

interface Seen {
  url: string;
  method: string;
  headers: Record<string, string | string[] | undefined>;
}

interface Stub {
  server: Server;
  base: string;
  seen: Seen[];
  /** Status the stub replies with; set per test. */
  status: number;
}

function startStub(): Promise<Stub> {
  const stub: Partial<Stub> & { seen: Seen[]; status: number } = { seen: [], status: 200 };
  const server = createServer((req, res) => {
    stub.seen.push({ url: req.url ?? '', method: req.method ?? '', headers: req.headers });
    res.writeHead(stub.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(stub.status === 200 ? { data: [] } : { error: 'stub' }));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve(Object.assign(stub, { server, base: `http://127.0.0.1:${port}` }) as Stub);
    });
  });
}

/** Rewrites only the ORIGIN, so the validator's own request shape is untouched. */
function redirectingFetch(base: string): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
      .replace('https://api.anthropic.com', base)
      .replace('https://api.openai.com', base);
    return fetch(url, init);
  }) as typeof fetch;
}

let stub: Stub;

beforeEach(async () => {
  stub = await startStub();
});
afterEach(async () => {
  await new Promise<void>((r) => stub.server.close(() => r()));
});

describe('connection validation — Anthropic, at a real socket', () => {
  it('sends the documented request shape and reports a valid key', async () => {
    stub.status = 200;
    const r = await validateClaudeKey(SECRET, redirectingFetch(stub.base));

    expect(r.ok).toBe(true);
    expect(stub.seen).toHaveLength(1);
    const [req] = stub.seen;
    // Anthropic authenticates with x-api-key and REQUIRES a version header.
    expect(req.method).toBe('GET');
    expect(req.url).toBe('/v1/models');
    expect(req.headers['x-api-key']).toBe(SECRET);
    expect(req.headers['anthropic-version']).toBe('2023-06-01');
    // It must NOT be sent as a bearer token — that is the OpenAI shape.
    expect(req.headers.authorization).toBeUndefined();
  });

  it('maps 401 to an actionable message', async () => {
    stub.status = 401;
    const r = await validateClaudeKey(SECRET, redirectingFetch(stub.base));
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('401');
  });

  it('maps 429 to a rate-limit message rather than a bare status', async () => {
    stub.status = 429;
    const r = await validateClaudeKey(SECRET, redirectingFetch(stub.base));
    expect(r.ok).toBe(false);
    expect(r.detail.toLowerCase()).toContain('rate limit');
  });

  it('never echoes the key into the detail, on ANY status', async () => {
    for (const status of [200, 401, 429, 500]) {
      stub.status = status;
      const r = await validateClaudeKey(SECRET, redirectingFetch(stub.base));
      expect(r.detail, `status ${status}`).not.toContain(SECRET);
    }
  });
});

describe('connection validation — OpenAI, at a real socket', () => {
  it('sends the documented request shape and reports a valid key', async () => {
    stub.status = 200;
    const r = await validateOpenAiKey(SECRET, redirectingFetch(stub.base));

    expect(r.ok).toBe(true);
    const [req] = stub.seen;
    expect(req.method).toBe('GET');
    expect(req.url).toBe('/v1/models');
    // OpenAI authenticates with a bearer token, NOT x-api-key.
    expect(req.headers.authorization).toBe(`Bearer ${SECRET}`);
    expect(req.headers['x-api-key']).toBeUndefined();
  });

  it('maps 401 and 429 to actionable messages', async () => {
    stub.status = 401;
    expect((await validateOpenAiKey(SECRET, redirectingFetch(stub.base))).detail).toContain('401');
    stub.status = 429;
    expect(
      (await validateOpenAiKey(SECRET, redirectingFetch(stub.base))).detail.toLowerCase(),
    ).toContain('rate limit');
  });

  it('never echoes the key into the detail, on ANY status', async () => {
    for (const status of [200, 401, 429, 500]) {
      stub.status = status;
      const r = await validateOpenAiKey(SECRET, redirectingFetch(stub.base));
      expect(r.detail, `status ${status}`).not.toContain(SECRET);
    }
  });
});

describe('connection validation — Ollama, at a real socket', () => {
  it('probes /api/tags on the configured base URL and reports reachable', async () => {
    stub.status = 200;
    const r = await validateOllama(stub.base);
    expect(r.ok).toBe(true);
    expect(stub.seen[0].url).toBe('/api/tags');
    expect(stub.seen[0].method).toBe('GET');
    // A local probe must carry no credential of any kind.
    expect(stub.seen[0].headers.authorization).toBeUndefined();
    expect(stub.seen[0].headers['x-api-key']).toBeUndefined();
  });

  it('reports an unreachable server honestly rather than claiming it is down-with-a-status', async () => {
    // Close the stub so the connection is genuinely refused — a real network
    // failure, not a simulated one.
    await new Promise<void>((res) => stub.server.close(() => res()));
    const r = await validateOllama(stub.base);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('Could not reach Ollama');
    // Re-open something so afterEach's close() is harmless.
    stub = await startStub();
  });

  it('reports a non-200 as the status it actually got', async () => {
    stub.status = 500;
    const r = await validateOllama(stub.base);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('500');
  });
});

describe('connection validation — refusals that must never touch the network', () => {
  it('an empty key is refused before any request is made', async () => {
    const r = await validateClaudeKey('', redirectingFetch(stub.base));
    expect(r.ok).toBe(false);
    expect(r.latencyMs).toBeNull();
    expect(stub.seen).toHaveLength(0); // nothing left the machine
    const o = await validateOpenAiKey('', redirectingFetch(stub.base));
    expect(o.ok).toBe(false);
    expect(stub.seen).toHaveLength(0);
  });
});
