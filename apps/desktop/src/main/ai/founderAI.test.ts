import { describe, expect, it, vi } from 'vitest';
import type {
  AiContextItem,
  AiEngineRequest,
  AiEngineResponse,
  Briefing,
  FounderFinding,
  MemoryAuditEvent,
  MemoryItem,
  MemoryRecallQuery,
  MemoryWriteInput,
} from '@neuropause/shared';
import type { ContextRequest } from './contextBuilder';
import {
  answerFounder,
  classifyFounderIntent,
  defaultFounderGovernance,
  founderFindingsFromBriefing,
  founderRequiresApproval,
  type FounderAIDeps,
} from './founderAI';

/* ── fixtures ─────────────────────────────────────────────────────────────── */

function makeResponse(over: Partial<AiEngineResponse> = {}): AiEngineResponse {
  return {
    responseId: 'r1',
    worker: 'founder',
    promptId: 'founder.executive',
    promptVersion: 1,
    model: 'mock',
    text: '',
    data: null,
    evidence: [],
    confidence: 0.5,
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    latencyMs: 1,
    contextSources: [],
    grounded: true,
    ...over,
  };
}

const FINDINGS: FounderFinding[] = [
  {
    label: 'CI Health',
    text: 'CI failing on main — 8/8 failed',
    at: null,
    connectorId: 'github',
    evidence: [{ kind: 'event', id: 'e1' }],
  },
];

const CONTEXT: AiContextItem[] = [
  { source: 'mission-brief', text: 'CI failing', evidence: [{ kind: 'event', id: 'e1' }] },
];

const GROUNDED_DATA = {
  executiveSummary: 'Release at risk.',
  businessImpact: 'Timeline may slip.',
  recommendations: ['Repair CI'],
};

function makeDeps(over: Partial<FounderAIDeps> = {}): FounderAIDeps {
  return {
    buildContext: () => CONTEXT,
    run: async () =>
      makeResponse({
        grounded: true,
        model: 'llama3.1',
        confidence: 0.9,
        data: GROUNDED_DATA,
        evidence: [{ kind: 'event', id: 'e1' }],
        contextSources: ['mission-brief', 'github'],
      }),
    deterministicFindings: () => FINDINGS,
    now: () => '2026-06-30T00:00:00.000Z',
    ...over,
  };
}

/* ── intent classification ───────────────────────────────────────────────── */

describe('classifyFounderIntent', () => {
  it('maps executive questions to the right intent', () => {
    expect(classifyFounderIntent("What's blocking Release 1.0?").intent).toBe('release-status');
    expect(classifyFounderIntent('What changed overnight?').intent).toBe('timeline');
    expect(classifyFounderIntent('Which projects are unhealthy?').intent).toBe('projects');
    expect(classifyFounderIntent('What decisions require my approval?').intent).toBe('approvals');
    expect(classifyFounderIntent('What is the biggest business risk?').intent).toBe(
      'business-risk',
    );
    expect(classifyFounderIntent('Which AI workers need attention?').intent).toBe('ai-workers');
    expect(classifyFounderIntent('What did Engineering AI discover?').intent).toBe('engineering');
  });

  it('returns unclear with zero confidence when nothing matches', () => {
    const r = classifyFounderIntent('asdf qwer zxcv');
    expect(r.intent).toBe('unclear');
    expect(r.confidence).toBe(0);
  });

  it('reports the signals that fired', () => {
    const r = classifyFounderIntent('What is blocking the release?');
    expect(r.intent).toBe('release-status');
    expect(r.matched.length).toBeGreaterThan(0);
  });
});

/* ── orchestrator ────────────────────────────────────────────────────────── */

describe('answerFounder', () => {
  it('produces a grounded executive answer and preserves deterministic findings', async () => {
    const res = await answerFounder(makeDeps(), { text: 'What is blocking Release 1.0?' });
    expect(res.intent).toBe('release-status');
    expect(res.grounded).toBe(true);
    expect(res.aiOffline).toBe(false);
    expect(res.executiveSummary).toBe('Release at risk.');
    expect(res.businessImpact).toBe('Timeline may slip.');
    expect(res.recommendations).toEqual(['Repair CI']);
    expect(res.keyFindings).toHaveLength(1);
    expect(res.model).toBe('llama3.1');
    expect(res.sourceSystems).toContain('github');
    expect(res.evidence).toEqual([{ kind: 'event', id: 'e1' }]);
  });

  it('surfaces timeline references from the assembled context (Mission Brief v3)', async () => {
    const res = await answerFounder(
      makeDeps({
        buildContext: () => [
          {
            source: 'timeline',
            text: 'Deploy v2 shipped\nby CI',
            evidence: [{ kind: 'activity', id: 'tl-1' }],
          },
          { source: 'mission-brief', text: 'CI failing', evidence: [{ kind: 'event', id: 'e1' }] },
        ],
      }),
      { text: 'What is blocking Release 1.0?' },
    );
    expect(res.timelineReferences).toEqual([
      { id: 'tl-1', kind: 'activity', text: 'Deploy v2 shipped' },
    ]);
  });

  it('falls back cleanly when no model ran — findings survive, narrative is empty', async () => {
    const res = await answerFounder(
      makeDeps({
        run: async () =>
          makeResponse({ grounded: false, model: 'none', confidence: 0, data: null }),
      }),
      { text: 'What is blocking Release 1.0?' },
    );
    expect(res.grounded).toBe(false);
    expect(res.aiOffline).toBe(true);
    expect(res.executiveSummary).toBeNull();
    expect(res.businessImpact).toBeNull();
    expect(res.recommendations).toEqual([]);
    expect(res.keyFindings).toHaveLength(1);
  });

  it('asks for clarification on an ambiguous question without calling the model', async () => {
    const run = vi.fn(async () => makeResponse());
    const res = await answerFounder(makeDeps({ run }), { text: 'asdf qwer zxcv' });
    expect(res.needsClarification).toBe(true);
    expect(res.clarification).toBeTruthy();
    expect(res.intent).toBe('unclear');
    expect(run).not.toHaveBeenCalled();
  });

  it('returns an honest no-evidence answer when there are no findings and no context', async () => {
    const run = vi.fn(async () => makeResponse());
    const res = await answerFounder(
      makeDeps({ deterministicFindings: () => [], buildContext: () => [], run }),
      { text: 'What is blocking Release 1.0?' },
    );
    expect(res.executiveSummary).toContain("don't have enough evidence");
    expect(res.keyFindings).toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });

  it('builds founder-scoped context with an intent-specific query', async () => {
    const buildContext = vi.fn((_r: ContextRequest) => CONTEXT);
    await answerFounder(makeDeps({ buildContext }), { text: 'What is blocking Release 1.0?' });
    expect(buildContext).toHaveBeenCalledTimes(1);
    const arg = buildContext.mock.calls[0][0];
    expect(arg.worker).toBe('founder');
    expect(arg.query).toContain('release');
  });

  it('routes through the audited engine contract (worker / prompt / tier)', async () => {
    const run = vi.fn(async () =>
      makeResponse({ grounded: true, data: { executiveSummary: 'ok', recommendations: [] } }),
    );
    await answerFounder(makeDeps({ run }), { text: 'Give me the morning brief' });
    const req = run.mock.calls[0][0] as AiEngineRequest;
    expect(req.worker).toBe('founder');
    expect(req.promptId).toBe('founder.executive');
    expect(req.tier).toBe('balanced');
  });

  it('surfaces requiresApproval through the full answer', async () => {
    const res = await answerFounder(
      makeDeps({
        run: async () =>
          makeResponse({
            grounded: true,
            data: {
              executiveSummary: 'x',
              recommendations: ['Approve the migration', 'Repair CI'],
            },
            contextSources: ['github'],
          }),
      }),
      { text: 'What needs my approval?' },
    );
    expect(res.governance.requiresApproval).toBe(true);
    expect(res.governance.decision).toBe('allow');
  });

  it('merges finding connector provenance into source systems', async () => {
    // Context only cites mission-brief; the finding is GitHub-derived → github appears.
    const res = await answerFounder(
      makeDeps({
        run: async () =>
          makeResponse({
            grounded: true,
            data: { executiveSummary: 'x', recommendations: [] },
            contextSources: ['mission-brief'],
          }),
      }),
      { text: 'What is blocking Release 1.0?' },
    );
    expect(res.sourceSystems).toContain('mission-brief');
    expect(res.sourceSystems).toContain('github');
    expect(res.governance.sourceSystems).toContain('github');
  });
});

/* ── governance ──────────────────────────────────────────────────────────── */

describe('founder governance', () => {
  it('flags recommendations that imply an external action', () => {
    expect(founderRequiresApproval(['Approve the migration'])).toBe(true);
    expect(founderRequiresApproval(['Merge PR #84'])).toBe(true);
    expect(founderRequiresApproval(['Review the CI logs', 'Investigate the failures'])).toBe(false);
  });

  it('allows display but flags external actions for approval', () => {
    const g = defaultFounderGovernance({
      grounded: true,
      recommendations: ['Deploy the fix'],
      sourceSystems: ['github'],
    });
    expect(g.decision).toBe('allow');
    expect(g.requiresApproval).toBe(true);
    expect(g.reasoning).toMatch(/approval/i);
    expect(g.sourceSystems).toEqual(['github']);
  });

  it('explains the offline gate when no model ran', () => {
    const g = defaultFounderGovernance({ grounded: false, recommendations: [], sourceSystems: [] });
    expect(g.requiresApproval).toBe(false);
    expect(g.reasoning).toMatch(/no model/i);
  });
});

/* ── deterministic findings from the briefing ────────────────────────────── */

describe('founderFindingsFromBriefing', () => {
  const brief: Briefing = {
    period: 'morning',
    generatedAt: '2026-06-30T00:00:00.000Z',
    range: { since: 'a', until: 'b' },
    headline: 'h',
    evidenceCount: 2,
    grounded: true,
    sections: [
      {
        id: 'ci_health',
        title: 'CI Health',
        empty: false,
        items: [
          {
            text: 'CI failing',
            detail: '8/8 failed',
            connectorId: 'github',
            at: null,
            evidence: [{ kind: 'event', id: 'e1' }],
          },
        ],
      },
      {
        id: 'meetings',
        title: 'Meetings',
        empty: false,
        items: [
          {
            text: 'Standup',
            detail: null,
            connectorId: 'cal',
            at: null,
            evidence: [{ kind: 'event', id: 'e2' }],
          },
        ],
      },
      { id: 'documents', title: 'Documents', empty: true, items: [] },
    ],
  };

  it('selects only engineering sections for engineering / release intents', () => {
    const f = founderFindingsFromBriefing(brief, 'engineering');
    expect(f).toHaveLength(1);
    expect(f[0].label).toBe('CI Health');
    expect(f[0].connectorId).toBe('github');
    expect(f[0].text).toContain('8/8 failed');
    expect(f[0].evidence).toEqual([{ kind: 'event', id: 'e1' }]);
  });

  it('selects all non-empty sections for broad executive intents', () => {
    const f = founderFindingsFromBriefing(brief, 'morning-brief');
    expect(f).toHaveLength(2);
  });

  it('respects the cap', () => {
    expect(founderFindingsFromBriefing(brief, 'morning-brief', 1)).toHaveLength(1);
  });
});

/* ── conversation memory integration ─────────────────────────────────────── */

class FakeMem {
  items: MemoryItem[] = [];
  audits: MemoryAuditEvent[] = [];
  private seq = 0;

  remember = (input: MemoryWriteInput, now = '2026-06-30T00:00:00.000Z'): MemoryItem => {
    const item: MemoryItem = {
      id: `m-${++this.seq}`,
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

  recall = (q: MemoryRecallQuery) => {
    let items = this.items.filter((it) => (q.tag ? it.tags.includes(q.tag) : true));
    if (q.text) {
      const words = q.text.toLowerCase().split(/\s+/).filter(Boolean);
      items = items
        .map((it) => ({
          it,
          s: words.reduce(
            (n, w) => n + (`${it.title} ${it.content}`.toLowerCase().includes(w) ? 1 : 0),
            0,
          ),
        }))
        .sort((a, b) => b.s - a.s)
        .map((x) => x.it);
    }
    return {
      hits: items.slice(0, q.limit ?? 50).map((item) => ({ item, score: 1 })),
      total: items.length,
      retriever: 'fake',
    };
  };

  deps() {
    return {
      remember: this.remember,
      recall: this.recall,
      get: this.get,
      forget: this.forget,
      audit: (e: MemoryAuditEvent) => this.audits.push(e),
    };
  }
}

describe('answerFounder — conversation memory', () => {
  it('captures a decision and records a "created" audit', async () => {
    const mem = new FakeMem();
    const res = await answerFounder(makeDeps({ memory: mem.deps() }), {
      text: 'I approved Release 1.0',
      conversationId: 'c1',
    });
    expect(res.memoryCapture?.outcome).toBe('stored');
    expect(res.memoryCapture?.type).toBe('decision');
    expect(mem.items).toHaveLength(1);
    expect(mem.audits.some((a) => a.action === 'created')).toBe(true);
  });

  it('refuses to store a secret and records a rejection', async () => {
    const mem = new FakeMem();
    const res = await answerFounder(makeDeps({ memory: mem.deps() }), {
      text: 'I approved using api_key = abcdef1234567890',
    });
    expect(res.memoryCapture?.outcome).toBe('rejected');
    expect(res.memoryCapture!.rejections.length).toBeGreaterThan(0);
    expect(mem.items).toHaveLength(0);
    expect(mem.audits.at(-1)?.action).toBe('rejected');
  });

  it('recalls relevant prior memories into the answer and audits a use', async () => {
    const mem = new FakeMem();
    await answerFounder(makeDeps({ memory: mem.deps() }), { text: 'I approved Release 1.0' });
    mem.audits.length = 0;
    const res = await answerFounder(makeDeps({ memory: mem.deps() }), {
      text: "what's blocking Release 1.0?",
    });
    expect(res.recalledMemories.some((m) => m.content.includes('Release 1.0'))).toBe(true);
    expect(mem.audits.some((a) => a.action === 'used')).toBe(true);
  });

  it('considers but ignores a non-statement on the clarification path', async () => {
    const mem = new FakeMem();
    const res = await answerFounder(makeDeps({ memory: mem.deps() }), { text: 'hmm' });
    expect(res.needsClarification).toBe(true);
    expect(res.memoryCapture?.outcome).toBe('ignored');
    expect(mem.items).toHaveLength(0);
  });

  it('remembers a preference even when it does not map to a question', async () => {
    const mem = new FakeMem();
    const res = await answerFounder(makeDeps({ memory: mem.deps() }), {
      text: 'Our highest priority is the mobile app',
    });
    expect(res.memoryCapture?.outcome).toBe('stored');
    expect(res.memoryCapture?.type).toBe('preference');
    expect(mem.items).toHaveLength(1);
  });

  it('works with memory disabled (no memory dep)', async () => {
    const res = await answerFounder(makeDeps(), { text: 'I approved Release 1.0' });
    expect(res.memoryCapture).toBeNull();
    expect(res.recalledMemories).toEqual([]);
  });
});
