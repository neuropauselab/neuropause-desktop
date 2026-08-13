/**
 * P13C N7 — assistant conversations, two tenants.
 *
 * Conversation bodies carry assistant answers SYNTHESISED FROM TENANT DATA, and
 * the store had no boundary. Two shapes made that reachable:
 *
 *   list(null)  meant NO FILTER — every conversation on the install. The IPC
 *               schema makes `workspaceId` nullable AND optional, so `{}` was a
 *               valid payload that returned everything.
 *   get(id)     selected by bare id, so knowing a uuid was the authorization.
 *
 * Both channels were also on the PUBLIC allowlist — no auth, no permission.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AssistantConversation, TenantScope } from '@neuropause/shared';
import { ConversationStore } from '../assistant/conversationStore';
import { OTHER_TENANT_SCOPE, TEST_TENANT_SCOPE } from './testScope';

const A = TEST_TENANT_SCOPE;
const B = OTHER_TENANT_SCOPE;
const SECRET_A = 'NP-CONVERSATION-A-SECRET-99821';
const SECRET_B = 'NP-CONVERSATION-B-SECRET-31447';

let scope: TenantScope | null = A;
let dir: string;
let store: ConversationStore;

function conversation(id: string, title: string, workspaceId: string | null = null): AssistantConversation {
  return {
    id,
    workspaceId,
    title,
    pinned: false,
    createdAt: '2026-08-11T00:00:00.000Z',
    updatedAt: '2026-08-11T00:00:00.000Z',
    parent: null,
    messages: [],
  } as AssistantConversation;
}

beforeEach(async () => {
  dir = join(tmpdir(), `np-conv-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  store = new ConversationStore(join(dir, 'conversations.json')).bindScope(() => scope);
  scope = A;
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
});

async function seedBoth(): Promise<void> {
  scope = A;
  await store.upsert(conversation('c-a', SECRET_A));
  scope = B;
  await store.upsert(conversation('c-b', SECRET_B));
}

/* ── Phase 21: list(null) ───────────────────────────────────────────────── */

describe('Phase 21 — null no longer means ALL', () => {
  it('list() with no argument returns only MY conversations', async () => {
    await seedBoth();
    scope = A;
    const mine = store.list();
    expect(mine.map((c) => c.title)).toEqual([SECRET_A]);
  });

  it('list(null) — the exact payload `{}` produced — returns only mine', async () => {
    await seedBoth();
    scope = B;
    expect(store.list(null).map((c) => c.title)).toEqual([SECRET_B]);
  });

  it('leaks no marker from the other tenant in any listing shape', async () => {
    await seedBoth();
    scope = A;
    const blob = JSON.stringify([store.list(), store.list(null), store.list(undefined, 200)]);
    expect(blob).toContain(SECRET_A);
    expect(blob).not.toContain(SECRET_B);
  });

  it('naming a workspace narrows WITHIN my tenant and cannot cross it', async () => {
    scope = A;
    await store.upsert(conversation('a1', `${SECRET_A}-w1`, 'ws-1'));
    await store.upsert(conversation('a2', `${SECRET_A}-w2`, 'ws-2'));
    scope = B;
    await store.upsert(conversation('b1', SECRET_B, 'ws-1'));

    scope = A;
    expect(store.list('ws-1').map((c) => c.title)).toEqual([`${SECRET_A}-w1`]);
  });
});

/* ── Phase 22: get(id) ──────────────────────────────────────────────────── */

describe('Phase 22 — a bare conversation id is not authority', () => {
  it('B cannot get A’s conversation by id', async () => {
    await seedBoth();
    scope = B;
    expect(store.get('c-a')).toBeNull();
  });

  it('A cannot get B’s conversation by id — symmetric', async () => {
    await seedBoth();
    scope = A;
    expect(store.get('c-b')).toBeNull();
  });

  it('each tenant CAN get their own — the gate is not simply "no"', async () => {
    await seedBoth();
    scope = A;
    expect(store.get('c-a')?.title).toBe(SECRET_A);
    scope = B;
    expect(store.get('c-b')?.title).toBe(SECRET_B);
  });
});

/* ── Phase 23/24: create and delete ─────────────────────────────────────── */

describe('Phase 23/24 — ownership on write, and delete stays inside it', () => {
  it('a conversation created under A belongs to A', async () => {
    scope = A;
    await store.upsert(conversation('c1', SECRET_A));
    expect(store.get('c1')?.tenantId).toBe(A.tenantId);
  });

  it('B cannot DELETE A’s conversation', async () => {
    await seedBoth();
    scope = B;
    expect(await store.delete('c-a')).toBe(false);
    scope = A;
    expect(store.get('c-a')).not.toBeNull();
  });

  it('A deleting their own leaves B’s intact', async () => {
    await seedBoth();
    scope = A;
    expect(await store.delete('c-a')).toBe(true);
    scope = B;
    expect(store.get('c-b')).not.toBeNull();
  });

  /**
   * The write-side IDOR: `upsert` is keyed by id, so without an ownership check
   * a caller who knew an id could OVERWRITE another tenant's conversation —
   * title, messages and all.
   */
  it('B cannot overwrite A’s conversation by re-using its id', async () => {
    await seedBoth();
    scope = B;
    await store.upsert(conversation('c-a', 'HIJACKED'));

    scope = A;
    expect(store.get('c-a')?.title).toBe(SECRET_A);
    scope = B;
    expect(store.get('c-a')).toBeNull(); // and B did not acquire it either
  });
});

/* ── Fail-closed ────────────────────────────────────────────────────────── */

describe('fail-closed', () => {
  it('an unresolved tenant reads nothing and writes nothing', async () => {
    await seedBoth();
    scope = null;
    expect(store.list()).toEqual([]);
    expect(store.get('c-a')).toBeNull();

    await store.upsert(conversation('orphan', 'ORPHAN'));
    scope = A;
    expect(store.get('orphan')).toBeNull();
    scope = B;
    expect(store.get('orphan')).toBeNull();
  });

  it('an UNBOUND store denies', async () => {
    const unbound = new ConversationStore(join(dir, 'unbound.json'));
    expect(unbound.hasScope()).toBe(false);
    expect(unbound.list()).toEqual([]);
    await unbound.upsert(conversation('x', 'X'));
    expect(unbound.get('x')).toBeNull();
  });

  it('a pre-P13C unowned conversation is visible to NEITHER tenant', async () => {
    const legacy = join(dir, 'legacy.json');
    await fs.writeFile(
      legacy,
      JSON.stringify({ conversations: [conversation('c-old', 'PRE-P13C')] }),
    );
    const s = new ConversationStore(legacy).bindScope(() => scope);

    scope = A;
    expect(s.list()).toEqual([]);
    expect(s.get('c-old')).toBeNull();
    scope = B;
    expect(s.get('c-old')).toBeNull();

    // Present but unresolved — recorded, not destroyed.
    expect(s.ownershipCounts()).toEqual({ total: 1, assigned: 0, unresolved: 1 });
  });
});
