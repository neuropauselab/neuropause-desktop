/**
 * Phase 6 Stage 5 — InboxStore: durable notification inbox in the proven
 * ExecutionStore pattern. Locks persistence round-trip, the retention cap,
 * read-state transitions, re-delivery replace semantics, and corrupt-file
 * recovery.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { InboxNotification } from '@neuropause/shared';
import { InboxStore, MAX_INBOX } from './inboxStore';
import { OTHER_TENANT_SCOPE, TEST_TENANT_SCOPE } from '../tenancy/testScope';

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'np-inbox-'));
  file = join(dir, 'inbox.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function note(id: string, over: Partial<InboxNotification> = {}): InboxNotification {
  return {
    id,
    title: `Title ${id}`,
    body: 'Body',
    priority: 'high',
    sourceKey: 'mission-brief-morning',
    deepLink: null,
    at: '2026-07-31T09:00:00.000Z',
    read: false,
    ...over,
  };
}

describe('InboxStore', () => {
  it('persists across instances (atomic write, sync load)', async () => {
    const a = new InboxStore(file).bindScope(() => TEST_TENANT_SCOPE);
    await a.add(note('n1'));
    await a.add(note('n2'));
    const b = new InboxStore(file).bindScope(() => TEST_TENANT_SCOPE);
    const page = b.page();
    expect(page.total).toBe(2);
    expect(page.items[0]!.id).toBe('n2'); // newest first
    expect(page.unread).toBe(2);
  });

  it('re-delivery of the same id replaces the item and marks it unread again', async () => {
    const s = new InboxStore(file).bindScope(() => TEST_TENANT_SCOPE);
    await s.add(note('brief', { title: 'Old' }));
    await s.markRead('all');
    expect(s.unreadCount()).toBe(0);
    await s.add(note('brief', { title: 'New' }));
    const page = s.page();
    expect(page.total).toBe(1);
    expect(page.items[0]!.title).toBe('New');
    expect(page.unread).toBe(1);
  });

  it('caps retention at MAX_INBOX, newest kept', async () => {
    const s = new InboxStore(file).bindScope(() => TEST_TENANT_SCOPE);
    for (let i = 0; i < MAX_INBOX + 25; i += 1) await s.add(note(`n${i}`));
    const page = s.page(MAX_INBOX);
    expect(page.total).toBe(MAX_INBOX);
    expect(page.items[0]!.id).toBe(`n${MAX_INBOX + 24}`);
    // The 25 that went are this tenant's OWN oldest.
    expect(page.items.map((x) => x.id)).not.toContain('n0');
  });

  /**
   * THE CAP IS PER OWNER. P13C ROUND 10 — NEW-H1.
   *
   * The test above is a single tenant and stayed green through the entire
   * finding: `items.length = MAX_INBOX` truncated ONE SHARED ARRAY and then
   * persisted it, so a tenant delivering past the cap deleted every other
   * tenant's notifications from memory and from disk. A one-tenant cap test
   * cannot see that, which is why this one exists beside it.
   *
   * The full three-organization proof — identities, disk bytes, reload, and the
   * webhook twin — is `tenancy/round10InboxWebhookRetention.test.ts`.
   */
  it('another tenant\'s flood past the cap evicts none of mine', async () => {
    let scope = OTHER_TENANT_SCOPE;
    const s = new InboxStore(file).bindScope(() => scope);
    await s.add(note('mine-1'));
    await s.add(note('mine-2'));
    expect(s.page().total).toBe(2);

    scope = TEST_TENANT_SCOPE;
    for (let i = 0; i < MAX_INBOX + 25; i += 1) await s.add(note(`flood-${i}`));
    expect(s.page(MAX_INBOX).total).toBe(MAX_INBOX);

    scope = OTHER_TENANT_SCOPE;
    expect(s.page().total).toBe(2);
    expect(s.page().items.map((x) => x.id)).toEqual(['mine-2', 'mine-1']);
    // And in the bytes, not just behind the read filter.
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { items: InboxNotification[] };
    expect(raw.items.filter((x) => x.tenantId === OTHER_TENANT_SCOPE.tenantId)).toHaveLength(2);
  });

  it('markRead marks specific ids and reports the changed count', async () => {
    const s = new InboxStore(file).bindScope(() => TEST_TENANT_SCOPE);
    await s.add(note('a'));
    await s.add(note('b'));
    await s.add(note('c'));
    expect(await s.markRead(['a', 'b'])).toBe(2);
    expect(await s.markRead(['a'])).toBe(0); // idempotent
    expect(s.unreadCount()).toBe(1);
    expect(await s.markRead('all')).toBe(1);
    expect(s.unreadCount()).toBe(0);
  });

  it('recovers from a corrupt file to an empty inbox (never crashes)', () => {
    writeFileSync(file, '{not json', 'utf8');
    const s = new InboxStore(file).bindScope(() => TEST_TENANT_SCOPE);
    expect(s.page().total).toBe(0);
  });

  it('writes compact JSON with the items array (on-disk shape lock)', async () => {
    const s = new InboxStore(file).bindScope(() => TEST_TENANT_SCOPE);
    await s.add(note('n1'));
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { items: InboxNotification[] };
    expect(Array.isArray(raw.items)).toBe(true);
    expect(raw.items[0]!.id).toBe('n1');
  });
});
