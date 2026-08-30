/**
 * P13C GATE 19 — the identity store must not cry wolf on a clean macOS boot.
 *
 * `readFromDisk` used to log at ERROR for EVERY non-`loaded` read state — which
 * includes `first-run`, the benign "the file does not exist yet" case. A fresh
 * profile (or a local-mode install that has never synced an external identity)
 * has no `identity.json`, so every boot emitted a spurious ERROR — breaking the
 * "clean boot / no new errors" claim this gate audits, and diverging from
 * graphStore/memoryStore, which use the same reader and correctly exclude
 * `first-run`. These pin the fix: a missing file is silent; a genuinely
 * unreadable (corrupt) file still WARNS, never silently empties the queue.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const logSpy = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock('../logger', () => ({ createLogger: () => logSpy }));

import { IdentityStore } from './identityStore';

const NOW = (): string => '2026-08-31T00:00:00.000Z';
const tmpPath = (): string => join(tmpdir(), `identity-boot-${randomUUID()}.json`);

beforeEach(() => {
  logSpy.error.mockClear();
  logSpy.warn.mockClear();
});
afterEach(() => {
  logSpy.error.mockClear();
  logSpy.warn.mockClear();
});

describe('P13C Gate 19 — identity boot log hygiene', () => {
  it('a MISSING identity.json (first-run / fresh macOS profile) logs NOTHING — no spurious boot ERROR', async () => {
    const store = new IdentityStore(tmpPath(), NOW); // path does not exist → first-run
    await store.load();
    expect(store.isLoaded()).toBe(true);
    // The bug was an ERROR on every boot; the fix makes first-run silent.
    expect(logSpy.error).not.toHaveBeenCalled();
    expect(logSpy.warn).not.toHaveBeenCalled();
  });

  it('a CORRUPT identity.json still WARNS — a genuinely unreadable file is surfaced, never silent', async () => {
    const p = tmpPath();
    await fs.writeFile(p, '{ not valid json', 'utf8'); // → quarantined-corrupt
    const store = new IdentityStore(p, NOW);
    await store.load();
    // Surfaced (so "no open questions" is not confused with "could not read"),
    // but at WARN, not ERROR — the queue really is empty, correctly.
    expect(logSpy.warn).toHaveBeenCalledTimes(1);
    expect(logSpy.warn.mock.calls[0]?.[0]).toContain('Identity state could not be read');
    expect(logSpy.error).not.toHaveBeenCalled();
  });
});
