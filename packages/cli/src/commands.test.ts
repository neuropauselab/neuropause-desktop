import { describe, expect, it } from 'vitest';
import { NeuroPauseClient } from '@neuropause/sdk';
import type { Transport, TransportRequest, TransportResponse } from '@neuropause/sdk';
import { runCommand, CLI_VERSION } from './commands';

class MockTransport implements Transport {
  calls: TransportRequest[] = [];
  constructor(private readonly canned: unknown = []) {}
  async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
    this.calls.push(req);
    return { status: 200, data: this.canned as T, headers: {} };
  }
}

function harness(canned: unknown = []) {
  const transport = new MockTransport(canned);
  const client = new NeuroPauseClient({ transport });
  const out: string[] = [];
  const err: string[] = [];
  return { transport, client, out, err, deps: { client, out: (l: string) => out.push(l), err: (l: string) => err.push(l) } };
}

describe('CLI', () => {
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

  it('lists marketplace listings via the client', async () => {
    const h = harness([{ id: 'lst_1' }]);
    expect(await runCommand(['marketplace', 'list'], h.deps)).toBe(0);
    expect(h.transport.calls[0]).toMatchObject({ path: '/marketplace/listings' });
  });

  it('publishes from a manifest file', async () => {
    const h = harness({ id: 'ver_1', status: 'in_review' });
    const manifest = JSON.stringify({ kind: 'connector', name: 'C', version: '1.0.0', entry: 'c.js', permissions: [], capabilities: [], dependencies: [], network: [], metadata: {} });
    const code = await runCommand(['publish', 'lst_1', 'm.json'], { ...h.deps, readFile: async () => manifest });
    expect(code).toBe(0);
    expect(h.out.join('\n')).toMatch(/Submitted C 1\.0\.0/);
  });

  it('returns a non-zero code on an unknown command', async () => {
    const h = harness();
    expect(await runCommand(['frobnicate'], h.deps)).toBe(1);
  });
});
