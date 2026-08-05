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
    const a = new InboxStore(file);
    await a.add(note('n1'));
    await a.add(note('n2'));
    const b = new InboxStore(file);
    const page = b.page();
    expect(page.total).toBe(2);
    expect(page.items[0]!.id).toBe('n2'); // newest first
    expect(page.unread).toBe(2);
  });

  it('re-delivery of the same id replaces the item and marks it unread again', async () => {
    const s = new InboxStore(file);
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
    const s = new InboxStore(file);
    for (let i = 0; i < MAX_INBOX + 25; i += 1) await s.add(note(`n${i}`));
    const page = s.page(MAX_INBOX);
    expect(page.total).toBe(MAX_INBOX);
    expect(page.items[0]!.id).toBe(`n${MAX_INBOX + 24}`);
  });

  it('markRead marks specific ids and reports the changed count', async () => {
    const s = new InboxStore(file);
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
    const s = new InboxStore(file);
    expect(s.page().total).toBe(0);
  });

  it('writes compact JSON with the items array (on-disk shape lock)', async () => {
    const s = new InboxStore(file);
    await s.add(note('n1'));
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { items: InboxNotification[] };
    expect(Array.isArray(raw.items)).toBe(true);
    expect(raw.items[0]!.id).toBe('n1');
  });
});
