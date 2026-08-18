import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The store imports `app` from electron; tests pass an explicit dir so getPath is
// never called, but mock electron so the import resolves cleanly under vitest.
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));

import { localPrincipalStore } from './localPrincipalStore';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'np-local-principal-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('localPrincipalStore.loadOrCreate (FG-6 condition 2 / pin 3)', () => {
  it('first run mints a valid principal and persists it (enveloped)', async () => {
    const p = await localPrincipalStore.loadOrCreate(dir);
    expect(p.id).toMatch(/[0-9a-f-]{16,}/i);
    expect(typeof p.displayName).toBe('string');
    expect(p.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const file = join(dir, 'local-principal.json');
    expect(existsSync(file)).toBe(true);
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    expect(raw.schemaVersion).toBe(1);
    expect(raw.principal.id).toBe(p.id);
  });

  it('is idempotent — the id is STABLE across restarts (never re-mints)', async () => {
    const first = await localPrincipalStore.loadOrCreate(dir);
    const second = await localPrincipalStore.loadOrCreate(dir);
    const third = await localPrincipalStore.loadOrCreate(dir);
    expect(second.id).toBe(first.id);
    expect(third.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
  });

  it('two different profiles get two different ids', async () => {
    const other = mkdtempSync(join(tmpdir(), 'np-local-principal-b-'));
    try {
      const a = await localPrincipalStore.loadOrCreate(dir);
      const b = await localPrincipalStore.loadOrCreate(other);
      expect(a.id).not.toBe(b.id);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});
