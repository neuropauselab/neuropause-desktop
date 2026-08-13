import { describe, expect, it, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConversationStore, MAX_CONVERSATIONS, MAX_MESSAGES } from './conversationStore';
import type { AssistantConversation, AssistantEnvelope } from '@neuropause/shared';
import { TEST_TENANT_SCOPE } from '../tenancy/testScope';

let dir = '';
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'np-assistant-'));
});

function file(): string {
  return join(dir, 'conversations.json');
}

function envelope(intent: AssistantEnvelope['intent']['intent']): AssistantEnvelope {
  return {
    correlationId: 'asst_t',
    mode: 'ask',
    intent: { intent, confidence: 0.6, matched: [] },
    clarification: null,
    text: 'answer',
    findings: [],
    recommendations: [],
    draft: null,
    navigation: null,
    plan: null,
    sources: [],
    toolCalls: [],
    confidence: 0.6,
    grounded: true,
    aiOffline: false,
    unavailable: [],
    assumptions: [],
    reasoningSummary: null,
    trace: {
      correlationId: 'asst_t',
      mode: 'ask',
      intent: { intent, confidence: 0.6, matched: [] },
      phases: [],
      workspace: {
        workspace: null, workspaceCount: null, activeExecutions: null, pendingApprovals: null,
        connectors: null, automations: null, recentTimeline: [], memoryTotal: null,
        uiContext: null, unavailable: [],
      },
      retrieved: [],
      recalledMemories: 0,
      reasoning: null,
      toolCalls: [],
      audit: { permissionClass: 'local', aiResponseId: null, executionIds: [], timelineEventTypes: [] },
      generatedAt: 'now',
    },
    memoryCapture: null,
    generatedAt: 'now',
  };
}

function convo(id: string, at: string, extras: Partial<AssistantConversation> = {}): AssistantConversation {
  return {
    id,
    workspaceId: null,
    title: `Conversation ${id}`,
    pinned: false,
    createdAt: at,
    updatedAt: at,
    parent: null,
    messages: [
      { id: `${id}-u`, role: 'user', at, text: 'hi', envelope: null, redactions: [] },
      { id: `${id}-a`, role: 'assistant', at, text: 'answer', envelope: envelope('question'), redactions: [] },
    ],
    ...extras,
  };
}

describe('ConversationStore — durable persistence (ExecutionStore pattern)', () => {
  it('round-trips a conversation across store instances', async () => {
    const a = new ConversationStore(file()).bindScope(() => TEST_TENANT_SCOPE);
    await a.upsert(convo('c1', '2026-07-31T09:00:00.000Z'));
    const b = new ConversationStore(file()).bindScope(() => TEST_TENANT_SCOPE);
    const loaded = b.loadAllSync();
    expect(loaded).toHaveLength(1);
    expect(b.get('c1')?.title).toBe('Conversation c1');
    expect(b.get('c1')?.messages).toHaveLength(2);
  });

  it('upserts by id (no duplicates) and updates in place', async () => {
    const s = new ConversationStore(file()).bindScope(() => TEST_TENANT_SCOPE);
    await s.upsert(convo('c1', '2026-07-31T09:00:00.000Z'));
    await s.upsert({ ...convo('c1', '2026-07-31T10:00:00.000Z'), title: 'Renamed' });
    expect(s.loadAllSync()).toHaveLength(1);
    expect(s.get('c1')?.title).toBe('Renamed');
  });

  it('lists newest-updated first with pinned floating to the top', async () => {
    const s = new ConversationStore(file()).bindScope(() => TEST_TENANT_SCOPE);
    await s.upsert(convo('old', '2026-07-30T09:00:00.000Z'));
    await s.upsert(convo('new', '2026-07-31T09:00:00.000Z'));
    await s.upsert(convo('pin', '2026-07-29T09:00:00.000Z', { pinned: true }));
    const ids = s.list().map((c) => c.id);
    expect(ids).toEqual(['pin', 'new', 'old']);
  });

  it('filters by workspaceId and honors the limit', async () => {
    const s = new ConversationStore(file()).bindScope(() => TEST_TENANT_SCOPE);
    await s.upsert(convo('w1', '2026-07-31T09:00:00.000Z', { workspaceId: 'ws-a' }));
    await s.upsert(convo('w2', '2026-07-31T09:01:00.000Z', { workspaceId: 'ws-b' }));
    expect(s.list('ws-a').map((c) => c.id)).toEqual(['w1']);
    await s.upsert(convo('w3', '2026-07-31T09:02:00.000Z', { workspaceId: 'ws-a' }));
    expect(s.list('ws-a', 1)).toHaveLength(1);
  });

  it('summaries expose message count and the last assistant intent', async () => {
    const s = new ConversationStore(file()).bindScope(() => TEST_TENANT_SCOPE);
    const c = convo('c1', '2026-07-31T09:00:00.000Z');
    c.messages[1]!.envelope = envelope('analysis');
    await s.upsert(c);
    const [summary] = s.list();
    expect(summary!.messageCount).toBe(2);
    expect(summary!.lastIntent).toBe('analysis');
  });

  it('trims messages beyond the retention cap (oldest first)', async () => {
    const s = new ConversationStore(file()).bindScope(() => TEST_TENANT_SCOPE);
    const c = convo('big', '2026-07-31T09:00:00.000Z');
    c.messages = Array.from({ length: MAX_MESSAGES + 20 }, (_, i) => ({
      id: `m${i}`,
      role: 'user' as const,
      at: '2026-07-31T09:00:00.000Z',
      text: `msg ${i}`,
      envelope: null,
      redactions: [],
    }));
    await s.upsert(c);
    const stored = s.get('big')!;
    expect(stored.messages).toHaveLength(MAX_MESSAGES);
    expect(stored.messages[0]!.id).toBe('m20'); // oldest trimmed
  });

  it('caps total conversations, dropping least-recent unpinned first', async () => {
    const s = new ConversationStore(file()).bindScope(() => TEST_TENANT_SCOPE);
    await s.upsert(convo('keep-pinned', '2026-01-01T00:00:00.000Z', { pinned: true }));
    for (let i = 0; i < MAX_CONVERSATIONS + 5; i += 1) {
      await s.upsert(convo(`c${i}`, `2026-07-0${(i % 9) + 1}T00:00:0${i % 10}.000Z`));
    }
    const all = s.loadAllSync();
    expect(all.length).toBe(MAX_CONVERSATIONS);
    expect(all.some((c) => c.id === 'keep-pinned')).toBe(true);
  });

  it('delete removes and reports honestly', async () => {
    const s = new ConversationStore(file()).bindScope(() => TEST_TENANT_SCOPE);
    await s.upsert(convo('c1', '2026-07-31T09:00:00.000Z'));
    expect(await s.delete('c1')).toBe(true);
    expect(await s.delete('c1')).toBe(false);
    expect(s.get('c1')).toBeNull();
  });

  it('recovers from a corrupt file with an empty store (never throws)', () => {
    writeFileSync(file(), '{not json');
    const s = new ConversationStore(file()).bindScope(() => TEST_TENANT_SCOPE);
    expect(s.loadAllSync()).toEqual([]);
  });

  it('recovers from a wrong-shape file with an empty store', () => {
    writeFileSync(file(), JSON.stringify({ conversations: 'nope' }));
    const s = new ConversationStore(file()).bindScope(() => TEST_TENANT_SCOPE);
    expect(s.loadAllSync()).toEqual([]);
  });
});
