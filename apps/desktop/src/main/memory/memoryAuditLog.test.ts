/**
 * P13C Round 7 — `MemoryAuditLog` gained a tenant boundary: it had none, its
 * channel was PUBLIC, and `detail` carries assistant-written record titles. An
 * unbound log now denies every read, so these suites act AS one tenant.
 * Cross-tenant behaviour is asserted in `tenancy/e2e/round7Tenancy.test.ts`.
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MemoryAuditEvent } from '@neuropause/shared';
import { MemoryAuditLog } from './memoryAuditLog';

function ev(over: Partial<MemoryAuditEvent> = {}): MemoryAuditEvent {
  return {
    id: `a-${Math.random().toString(36).slice(2)}`,
    action: 'created',
    memoryId: 'mem-1',
    at: '2026-06-30T12:00:00.000Z',
    detail: 'x',
    decision: 'longterm',
    rejections: [],
    ...over,
  };
}

describe('MemoryAuditLog', () => {
  let dir: string;
  let path: string;
  let audit: MemoryAuditLog;

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'mem-audit-'));
    path = join(dir, 'memory-audit.json');
    audit = new MemoryAuditLog(path).bindScope(() => ({ tenantId: 'org-alpha', workspaceId: 'ws-alpha' }));
    await audit.load();
  });

  afterEach(async () => {
    await audit.flush();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('records events newest-first and filters by action and memory id', async () => {
    audit.record(ev({ action: 'created', memoryId: 'mem-1' }));
    audit.record(ev({ action: 'used', memoryId: null }));
    audit.record(ev({ action: 'forgotten', memoryId: 'mem-1' }));

    const all = audit.page();
    expect(all.total).toBe(3);
    expect(all.entries[0]!.action).toBe('forgotten'); // newest first

    expect(audit.page({ action: 'created' }).total).toBe(1);
    expect(audit.page({ memoryId: 'mem-1' }).total).toBe(2);
  });

  it('records a rejection with its governance result', async () => {
    audit.record(
      ev({
        action: 'rejected',
        memoryId: null,
        decision: 'longterm',
        rejections: [{ category: 'password', detail: 'pw' }],
      }),
    );
    const page = audit.page({ action: 'rejected' });
    expect(page.entries[0]!.rejections).toHaveLength(1);
    expect(page.entries[0]!.rejections[0]!.category).toBe('password');
  });

  it('persists across reloads', async () => {
    audit.record(ev({ action: 'created' }));
    await audit.flush();

    const b = new MemoryAuditLog(path).bindScope(() => ({ tenantId: 'org-alpha', workspaceId: 'ws-alpha' }));
    await b.load();
    expect(b.size()).toBe(1);
    expect(b.page().entries[0]!.action).toBe('created');
  });

  it('paginates with limit and offset', async () => {
    for (let i = 0; i < 5; i++) audit.record(ev({ detail: `e${i}` }));
    const page = audit.page({ limit: 2, offset: 1 });
    expect(page.total).toBe(5);
    expect(page.entries).toHaveLength(2);
  });
});
