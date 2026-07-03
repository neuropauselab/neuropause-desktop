import { describe, expect, it } from 'vitest';
import type {
  AiContextItem,
  AiEngineResponse,
  Briefing,
  BriefingItem,
  BriefingSection,
  BriefingSectionId,
} from '@neuropause/shared';
import type { ContextRequest } from './contextBuilder';
import {
  analyzeEngineering,
  classifyRequiresApproval,
  defaultGovernance,
  engineeringFactsFromBriefing,
  type EngineeringAIDeps,
} from './engineeringAI';

const NOW = '2026-06-30T00:00:00.000Z';

function response(p: Partial<AiEngineResponse>): AiEngineResponse {
  return {
    responseId: 'r',
    worker: 'engineering',
    promptId: 'engineering.summary',
    promptVersion: 1,
    model: p.model ?? 'mock',
    text: p.text ?? '',
    data: p.data ?? null,
    evidence: p.evidence ?? [],
    confidence: p.confidence ?? 0.5,
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    latencyMs: 1,
    contextSources: p.contextSources ?? [],
    grounded: p.grounded ?? true,
  };
}

function deps(over: Partial<EngineeringAIDeps> & { run: EngineeringAIDeps['run'] }): EngineeringAIDeps {
  return {
    buildContext: over.buildContext ?? ((): AiContextItem[] => []),
    run: over.run,
    deterministicFacts: over.deterministicFacts ?? ((): [] => []),
    governance: over.governance,
    now: over.now ?? ((): string => NOW),
  };
}

function section(id: BriefingSectionId, items: BriefingItem[]): BriefingSection {
  return { id, title: id, items, empty: items.length === 0 };
}
function bitem(text: string, evidenceId: string): BriefingItem {
  return { text, detail: null, connectorId: 'github', at: NOW, evidence: [{ kind: 'activity', id: evidenceId }] };
}
function briefingOf(sections: BriefingSection[]): Briefing {
  return {
    period: 'morning',
    generatedAt: NOW,
    range: { since: NOW, until: NOW },
    headline: 'h',
    sections,
    evidenceCount: 0,
    grounded: true,
  };
}

describe('classifyRequiresApproval', () => {
  it('flags actions that imply external side-effects', () => {
    expect(classifyRequiresApproval('Merge PR #12 into main')).toBe(true);
    expect(classifyRequiresApproval('Re-run the failing CI workflow')).toBe(true);
    expect(classifyRequiresApproval('Investigate the failing test logs')).toBe(false);
    expect(classifyRequiresApproval(null)).toBe(false);
  });
});

describe('defaultGovernance', () => {
  it('allows read-only display and flags approval only for action recommendations', () => {
    const advisory = defaultGovernance({ grounded: true, recommendedAction: 'Investigate logs', contextSources: ['github'] });
    expect(advisory.decision).toBe('allow');
    expect(advisory.requiresApproval).toBe(false);
    expect(advisory.sourceSystems).toEqual(['github']);

    const action = defaultGovernance({ grounded: true, recommendedAction: 'Deploy the hotfix', contextSources: [] });
    expect(action.requiresApproval).toBe(true);

    const offline = defaultGovernance({ grounded: false, recommendedAction: null, contextSources: [] });
    expect(offline.reasoning).toContain('No model was reachable');
  });
});

describe('engineeringFactsFromBriefing', () => {
  it('extracts only engineering sections (non-empty) with evidence', () => {
    const facts = engineeringFactsFromBriefing(
      briefingOf([
        section('engineering_risk', [bitem('CI unstable on main', 'risk-1')]),
        section('ci_health', [bitem('8/8 runs failed', 'ci-1')]),
        section('pr_health', []), // empty → skipped
        section('completed', [bitem('shipped a thing', 'done-1')]), // non-engineering → skipped
      ]),
    );
    const ids = facts.flatMap((f) => f.evidence.map((e) => e.id));
    expect(ids).toContain('risk-1');
    expect(ids).toContain('ci-1');
    expect(ids).not.toContain('done-1');
    expect(facts.every((f) => typeof f.label === 'string' && f.text.length > 0)).toBe(true);
  });
});

describe('analyzeEngineering', () => {
  it('produces the AI synthesis when a model runs (grounded)', async () => {
    const analysis = await analyzeEngineering(
      deps({
        run: async () =>
          response({
            grounded: true,
            model: 'llama3.1',
            confidence: 0.8,
            contextSources: ['github', 'knowledge-graph'],
            evidence: [{ kind: 'activity', id: 'run-1' }],
            data: {
              rootCause: 'Flaky integration test',
              engineeringRisk: 'main is red',
              recommendedAction: 'Investigate the failing test',
              businessImpact: 'Blocks the release',
              confidence: 0.8,
            },
          }),
        deterministicFacts: () => [{ label: 'CI health', text: '8/8 failed', at: NOW, evidence: [{ kind: 'activity', id: 'run-1' }] }],
      }),
      { subject: 'neurocover-focus' },
    );

    expect(analysis.grounded).toBe(true);
    expect(analysis.aiOffline).toBe(false);
    expect(analysis.rootCause).toBe('Flaky integration test');
    expect(analysis.recommendedAction).toBe('Investigate the failing test');
    expect(analysis.model).toBe('llama3.1');
    expect(analysis.facts).toHaveLength(1); // deterministic facts always present
    expect(analysis.governance.decision).toBe('allow');
    expect(analysis.governance.requiresApproval).toBe(false);
    expect(analysis.evidence.some((e) => e.id === 'run-1')).toBe(true);
  });

  it('falls back to deterministic facts with an AI-offline flag when no model is reachable', async () => {
    const analysis = await analyzeEngineering(
      deps({
        run: async () => response({ grounded: false, model: 'none', contextSources: ['github'], evidence: [{ kind: 'task', id: 'pr-9' }] }),
        deterministicFacts: () => [{ label: 'Engineering risk', text: 'CI unstable', at: NOW, evidence: [] }],
      }),
    );

    expect(analysis.grounded).toBe(false);
    expect(analysis.aiOffline).toBe(true);
    expect(analysis.rootCause).toBeNull();
    expect(analysis.recommendedAction).toBeNull();
    expect(analysis.facts).toHaveLength(1); // facts still render
    expect(analysis.governance.reasoning).toContain('No model was reachable');
    // context evidence still carried through on the fallback path
    expect(analysis.evidence.some((e) => e.id === 'pr-9')).toBe(true);
  });

  it('drives retrieval from the subject when given, else a default engineering query', async () => {
    let captured: ContextRequest | null = null;
    const make = (subject?: string): Promise<unknown> =>
      analyzeEngineering(
        deps({
          buildContext: (r) => {
            captured = r;
            return [];
          },
          run: async () => response({ grounded: true, data: { recommendedAction: 'ok' } }),
        }),
        subject ? { subject } : {},
      );

    await make('neurocover-focus');
    expect(captured!.query).toBe('neurocover-focus');
    expect(captured!.worker).toBe('engineering');

    await make();
    expect(captured!.query).toContain('engineering health');
  });

  it('marks approval-required when the model recommends an action', async () => {
    const analysis = await analyzeEngineering(
      deps({ run: async () => response({ grounded: true, data: { recommendedAction: 'Merge the fix into main', confidence: 0.6 } }) }),
    );
    expect(analysis.governance.requiresApproval).toBe(true);
    expect(analysis.recommendedAction).toBe('Merge the fix into main');
  });
});
