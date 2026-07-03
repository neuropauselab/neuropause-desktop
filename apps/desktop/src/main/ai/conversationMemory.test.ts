import { describe, expect, it, beforeEach } from 'vitest';
import type {
  FounderResponse,
  MemoryAuditEvent,
  MemoryItem,
  MemoryRecallQuery,
  MemoryWriteInput,
} from '@neuropause/shared';
import {
  captureFounderMemory,
  classifyMemory,
  decodeMemoryView,
  forgetMemory,
  pinMemory,
  recallForAnswer,
  screenMemory,
  searchExecutiveMemories,
  setDecisionStatus,
  type ConversationMemoryDeps,
} from './conversationMemory';

/* ── Fakes: an in-memory AI Memory store + an audit collector ──────────────── */

class FakeStore {
  items: MemoryItem[] = [];
  private seq = 0;

  remember = (input: MemoryWriteInput, now = '2026-06-30T12:00:00.000Z'): MemoryItem => {
    const item: MemoryItem = {
      id: `mem-${++this.seq}`,
      kind: input.kind,
      origin: 'explicit',
      title: input.title,
      content: input.content,
      connectorId: null,
      source: 'manual',
      entityRefs: input.entityRefs ?? [],
      tags: input.tags ?? [],
      occurredAt: input.occurredAt ?? null,
      createdAt: now,
      updatedAt: now,
      evidence: null,
      metadata: input.metadata ?? {},
    };
    this.items.push(item);
    return item;
  };

  get = (id: string): MemoryItem | null => this.items.find((i) => i.id === id) ?? null;

  forget = (ids: string[]): number => {
    const before = this.items.length;
    this.items = this.items.filter((i) => !ids.includes(i.id));
    return before - this.items.length;
  };

  update = (
    id: string,
    patch: { metadata?: Record<string, string | number | boolean | null> },
    now = NOW,
  ): MemoryItem | null => {
    const item = this.items.find((i) => i.id === id);
    if (!item) return null;
    if (patch.metadata) item.metadata = { ...item.metadata, ...patch.metadata };
    item.updatedAt = now;
    return item;
  };

  // Mimics memoryStore.recall: filter by tag/kinds, rank by word overlap when text is given.
  recall = (q: MemoryRecallQuery) => {
    let items = this.items.filter((it) => (q.tag ? it.tags.includes(q.tag) : true));
    if (q.kinds) items = items.filter((it) => q.kinds!.includes(it.kind));
    if (q.text) {
      const words = q.text.toLowerCase().split(/\s+/).filter(Boolean);
      items = items
        .map((it) => {
          const hay = `${it.title} ${it.content}`.toLowerCase();
          return { it, score: words.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0) };
        })
        .sort((a, b) => b.score - a.score)
        .map((x) => x.it);
    }
    const limited = items.slice(0, q.limit ?? 50);
    return {
      hits: limited.map((item) => ({ item, score: 1 })),
      total: items.length,
      retriever: 'fake',
    };
  };
}

let audits: MemoryAuditEvent[];
let store: FakeStore;
let deps: ConversationMemoryDeps;

beforeEach(() => {
  audits = [];
  store = new FakeStore();
  deps = {
    remember: store.remember,
    recall: store.recall,
    get: store.get,
    forget: store.forget,
    update: store.update,
    audit: (e) => audits.push(e),
  };
});

const NOW = '2026-06-30T12:00:00.000Z';

function resp(over: Partial<FounderResponse> = {}): FounderResponse {
  return {
    question: 'q',
    intent: 'general',
    intentConfidence: 0.9,
    needsClarification: false,
    clarification: null,
    executiveSummary: 'x',
    keyFindings: [],
    businessImpact: '',
    recommendations: [],
    grounded: true,
    aiOffline: false,
    model: 'llama3.1',
    confidence: 0.8,
    evidence: [],
    sourceSystems: [],
    governance: { decision: 'allow', requiresApproval: false, reasoning: '', sourceSystems: [] },
    generatedAt: NOW,
    ...over,
  };
}

/* ── Classification ────────────────────────────────────────────────────────── */

describe('classifyMemory', () => {
  it('"I approved Release 1.0" → decision, long-term', () => {
    const c = classifyMemory('I approved Release 1.0', resp(), NOW);
    expect(c.type).toBe('decision');
    expect(c.decision).toBe('longterm');
  });

  it('"We postponed launch until Friday" → action', () => {
    const c = classifyMemory('We postponed launch until Friday', resp(), NOW);
    expect(c.type).toBe('action');
  });

  it('"Our highest priority is NeuroPause" → preference', () => {
    const c = classifyMemory('Our highest priority is NeuroPause', resp(), NOW);
    expect(c.type).toBe('preference');
    expect(c.decision).toBe('longterm');
  });

  it('"Ignore this" → ignore (no memory)', () => {
    expect(classifyMemory('Ignore this', resp()).decision).toBe('ignore');
    expect(classifyMemory('forget it', resp()).decision).toBe('ignore');
    expect(classifyMemory('   ', resp()).decision).toBe('ignore');
  });

  it('substantive Q&A defaults to a conversation kept for today', () => {
    const c = classifyMemory("What's the engineering status?", resp({ grounded: true }), NOW);
    expect(c.type).toBe('conversation');
    expect(c.decision).toBe('today');
  });

  it('a project-referencing question scopes the conversation to the project', () => {
    const c = classifyMemory("What's blocking Release 1.0?", resp({ grounded: true }), NOW);
    expect(c.decision).toBe('project');
  });

  it('does not store a non-answer (clarification / no evidence)', () => {
    expect(classifyMemory('Tell me about stuff', resp({ needsClarification: true })).decision).toBe(
      'ignore',
    );
    expect(
      classifyMemory('Tell me about stuff', resp({ grounded: false, keyFindings: [] })).decision,
    ).toBe('ignore');
  });
});

/* ── Governance screen ─────────────────────────────────────────────────────── */

describe('screenMemory', () => {
  it('allows ordinary executive text', () => {
    const r = screenMemory('I approved Release 1.0 after reviewing the CI failures.');
    expect(r.allowed).toBe(true);
    expect(r.rejections).toHaveLength(0);
  });

  it('rejects passwords', () => {
    const r = screenMemory('the db password = hunter2supersecret');
    expect(r.allowed).toBe(false);
    expect(r.rejections.some((x) => x.category === 'password')).toBe(true);
  });

  it('rejects API keys (OpenAI / AWS / GitHub / Stripe styles)', () => {
    expect(screenMemory('key sk-ABCDEFGHIJKLMNOPQRSTUVWX').allowed).toBe(false);
    expect(screenMemory('AKIAIOSFODNN7EXAMPLE').allowed).toBe(false);
    expect(screenMemory('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789').allowed).toBe(false);
    expect(screenMemory('sk_live_ABCDEFGHIJKLMNOP1234').allowed).toBe(false);
  });

  it('rejects bearer/JWT tokens', () => {
    expect(screenMemory('Authorization: bearer abcdefghijklmnop1234567890').allowed).toBe(false);
    expect(
      screenMemory(
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV',
      ).allowed,
    ).toBe(false);
  });

  it('rejects private key blocks and named secrets', () => {
    expect(screenMemory('-----BEGIN RSA PRIVATE KEY-----\nMIIE').allowed).toBe(false);
    expect(screenMemory('client_secret = abcdef123456ghijkl').allowed).toBe(false);
  });

  it('rejects financial credentials (card via Luhn, SSN)', () => {
    expect(screenMemory('card 4111 1111 1111 1111').allowed).toBe(false); // valid Luhn test card
    expect(screenMemory('ssn 123-45-6789').allowed).toBe(false);
    // a long but non-Luhn number is not flagged as a card
    expect(
      screenMemory('order number 1234567890123456').rejections.some((x) =>
        x.detail.includes('card'),
      ),
    ).toBe(false);
  });

  it('flags obvious medical information (best-effort)', () => {
    expect(screenMemory('patient record shows a diagnosis of hypertension').allowed).toBe(false);
  });
});

/* ── Memory (capture) ──────────────────────────────────────────────────────── */

describe('captureFounderMemory', () => {
  it('stores a decision with the right kind, scope, status, and metadata', () => {
    const r = captureFounderMemory(deps, {
      question: 'I approved Release 1.0',
      response: resp(),
      conversationId: 'c1',
      now: NOW,
    });
    expect(r.outcome).toBe('stored');
    expect(store.items).toHaveLength(1);
    const v = r.memory!;
    expect(v.type).toBe('decision');
    expect(v.scope).toBe('longterm');
    expect(v.status).toBe('open'); // decisions start open
    expect(v.project).toBe('Release 1.0');
    expect(v.sourceConversation).toBe('c1');
    expect(store.items[0]!.kind).toBe('decision');
    expect(store.items[0]!.tags).toContain('exec');
  });

  it('does not store an ignored exchange', () => {
    const r = captureFounderMemory(deps, { question: 'ignore this', response: resp(), now: NOW });
    expect(r.outcome).toBe('ignored');
    expect(store.items).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  it('refuses to store a secret and records the governance rejection', () => {
    const r = captureFounderMemory(deps, {
      question: 'I approved using api_key = abcdef1234567890',
      response: resp(),
      now: NOW,
    });
    expect(r.outcome).toBe('rejected');
    expect(store.items).toHaveLength(0);
    expect(r.rejections.length).toBeGreaterThan(0);
    expect(audits.at(-1)!.action).toBe('rejected');
    expect(audits.at(-1)!.rejections.length).toBeGreaterThan(0);
  });

  it('derives the connector from the answer source systems', () => {
    const r = captureFounderMemory(deps, {
      question: 'I approved Release 1.0',
      response: resp({ sourceSystems: ['mission-brief', 'github'] }),
      now: NOW,
    });
    expect(r.memory!.connectorId).toBe('github');
  });

  it('carries entity evidence into entityRefs', () => {
    captureFounderMemory(deps, {
      question: 'I approved Release 1.0',
      response: resp({
        evidence: [
          { kind: 'entity', id: 'ent-1' },
          { kind: 'event', id: 'ev-1' },
        ],
      }),
      now: NOW,
    });
    expect(store.items[0]!.entityRefs).toEqual(['ent-1']);
  });
});

/* ── Recall (for an answer) ────────────────────────────────────────────────── */

describe('recallForAnswer', () => {
  beforeEach(() => {
    captureFounderMemory(deps, { question: 'I approved Release 1.0', response: resp(), now: NOW });
    captureFounderMemory(deps, {
      question: 'Our highest priority is the mobile app',
      response: resp(),
      now: NOW,
    });
    audits.length = 0;
  });

  it('retrieves the most relevant memory for the question', () => {
    const hits = recallForAnswer(deps, {
      question: 'what did I decide about Release 1.0?',
      limit: 1,
      now: NOW,
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.content).toContain('Release 1.0');
  });

  it('excludes expired memories', () => {
    // a "today" conversation captured yesterday should be expired now
    captureFounderMemory(deps, {
      question: 'status of the dashboard yesterday',
      response: resp({ grounded: true }),
      now: '2026-06-29T09:00:00.000Z',
    });
    const hits = recallForAnswer(deps, { question: 'dashboard', limit: 10, now: NOW });
    expect(hits.some((h) => h.content.includes('dashboard'))).toBe(false);
  });

  it('audits a single "used" event when memories are recalled', () => {
    recallForAnswer(deps, { question: 'Release 1.0', limit: 5, now: NOW });
    expect(audits.filter((a) => a.action === 'used')).toHaveLength(1);
  });
});

/* ── Search (Memory panel) ─────────────────────────────────────────────────── */

describe('searchExecutiveMemories', () => {
  beforeEach(() => {
    captureFounderMemory(deps, {
      question: 'I approved Release 1.0',
      response: resp({ sourceSystems: ['github'] }),
      now: NOW,
    });
    captureFounderMemory(deps, {
      question: 'We postponed the launch until Friday',
      response: resp(),
      now: NOW,
    });
    captureFounderMemory(deps, {
      question: 'Our highest priority is the mobile app',
      response: resp(),
      now: NOW,
    });
  });

  it('filters to decisions only', () => {
    const out = searchExecutiveMemories(deps, { decisionsOnly: true }, NOW);
    expect(out.every((v) => v.type === 'decision')).toBe(true);
    expect(out).toHaveLength(1);
  });

  it('filters by type', () => {
    expect(searchExecutiveMemories(deps, { type: 'preference' }, NOW)).toHaveLength(1);
    expect(searchExecutiveMemories(deps, { type: 'action' }, NOW)).toHaveLength(1);
  });

  it('filters by open decision status', () => {
    const open = searchExecutiveMemories(deps, { decisionsOnly: true, status: 'open' }, NOW);
    expect(open).toHaveLength(1);
    expect(
      searchExecutiveMemories(deps, { decisionsOnly: true, status: 'resolved' }, NOW),
    ).toHaveLength(0);
  });

  it('filters by connector and by keyword', () => {
    expect(searchExecutiveMemories(deps, { connectorId: 'github' }, NOW)).toHaveLength(1);
    const kw = searchExecutiveMemories(deps, { text: 'launch' }, NOW);
    expect(kw.some((v) => v.content.includes('launch'))).toBe(true);
  });

  it('filters by project', () => {
    const out = searchExecutiveMemories(deps, { project: 'Release 1.0' }, NOW);
    expect(out).toHaveLength(1);
    expect(out[0]!.project).toBe('Release 1.0');
  });
});

/* ── Audit ─────────────────────────────────────────────────────────────────── */

describe('audit trail', () => {
  it('records created on store', () => {
    captureFounderMemory(deps, { question: 'I approved Release 1.0', response: resp(), now: NOW });
    expect(audits.map((a) => a.action)).toContain('created');
  });

  it('records forgotten on forget', () => {
    const r = captureFounderMemory(deps, {
      question: 'I approved Release 1.0',
      response: resp(),
      now: NOW,
    });
    const ok = forgetMemory(deps, r.memory!.id, NOW);
    expect(ok).toBe(true);
    expect(store.items).toHaveLength(0);
    expect(audits.at(-1)!.action).toBe('forgotten');
    expect(audits.at(-1)!.memoryId).toBe(r.memory!.id);
  });

  it('records rejected with the governance result', () => {
    captureFounderMemory(deps, {
      question: 'token is bearer abcdefghijklmnop1234567890',
      response: resp(),
      now: NOW,
    });
    const last = audits.at(-1)!;
    expect(last.action).toBe('rejected');
    expect(last.memoryId).toBeNull();
    expect(last.rejections.length).toBeGreaterThan(0);
  });
});

/* ── decode guard ──────────────────────────────────────────────────────────── */

describe('decodeMemoryView', () => {
  it('returns null for a non-executive memory item', () => {
    const item = store.remember({ kind: 'note', title: 't', content: 'c' }, NOW);
    expect(decodeMemoryView(item)).toBeNull();
  });
});

/* ── pin / resolve ─────────────────────────────────────────────────────────── */

describe('pinMemory + setDecisionStatus', () => {
  it('pins a memory and audits "pinned", and the pin shows up in a pinned search', () => {
    const r = captureFounderMemory(deps, {
      question: 'I approved Release 1.0',
      response: resp(),
      now: NOW,
    });
    const id = r.memory!.id;
    const pinned = pinMemory(deps, id, true, NOW);
    expect(pinned?.pinned).toBe(true);
    expect(audits.at(-1)!.action).toBe('pinned');
    expect(searchExecutiveMemories(deps, { pinnedOnly: true }, NOW).map((v) => v.id)).toContain(id);
    // unpin
    expect(pinMemory(deps, id, false, NOW)?.pinned).toBe(false);
    expect(searchExecutiveMemories(deps, { pinnedOnly: true }, NOW)).toHaveLength(0);
  });

  it('resolves an open decision and audits "updated"', () => {
    const r = captureFounderMemory(deps, {
      question: 'I approved Release 1.0',
      response: resp(),
      now: NOW,
    });
    const id = r.memory!.id;
    expect(
      searchExecutiveMemories(deps, { decisionsOnly: true, status: 'open' }, NOW),
    ).toHaveLength(1);

    const resolved = setDecisionStatus(deps, id, 'resolved', NOW);
    expect(resolved?.status).toBe('resolved');
    expect(audits.at(-1)!.action).toBe('updated');
    expect(
      searchExecutiveMemories(deps, { decisionsOnly: true, status: 'open' }, NOW),
    ).toHaveLength(0);
    expect(
      searchExecutiveMemories(deps, { decisionsOnly: true, status: 'resolved' }, NOW),
    ).toHaveLength(1);
  });

  it('returns null for an unknown id', () => {
    expect(pinMemory(deps, 'nope', true, NOW)).toBeNull();
    expect(setDecisionStatus(deps, 'nope', 'resolved', NOW)).toBeNull();
  });
});
