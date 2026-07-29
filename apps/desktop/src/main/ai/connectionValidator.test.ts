import { describe, expect, it, vi } from 'vitest';
import { validateClaudeKey, validateOllama } from './connectionValidator';

const okFetch = (): typeof fetch => vi.fn(async () => ({ ok: true, status: 200 })) as unknown as typeof fetch;
const statusFetch = (status: number): typeof fetch =>
  vi.fn(async () => ({ ok: status >= 200 && status < 300, status })) as unknown as typeof fetch;
const throwFetch = (): typeof fetch =>
  vi.fn(async () => {
    throw new Error('network down');
  }) as unknown as typeof fetch;

describe('validateClaudeKey', () => {
  it('accepts a working key and never echoes it', async () => {
    const r = await validateClaudeKey('sk-fixture', okFetch());
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r)).not.toContain('sk-fixture');
  });
  it('rejects an empty key without a network call', async () => {
    const fetchImpl = throwFetch();
    const r = await validateClaudeKey('', fetchImpl);
    expect(r.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('reports an invalid key on 401', async () => {
    const r = await validateClaudeKey('sk-bad', statusFetch(401));
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('401');
  });
  it('reports unreachable on a network error', async () => {
    const r = await validateClaudeKey('sk-fixture', throwFetch());
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/could not reach/i);
  });
});

describe('validateOllama', () => {
  it('accepts a reachable server', async () => {
    const r = await validateOllama('http://localhost:11434', okFetch());
    expect(r.ok).toBe(true);
  });
  it('reports unreachable on error', async () => {
    const r = await validateOllama('http://localhost:11434', throwFetch());
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/could not reach/i);
  });
});
