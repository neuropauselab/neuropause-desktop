/**
 * Phase 6 Stage 10 — the strategy model: the eleven question resolvers (the
 * exact executive phrasings from the audit), null on everything else, and the
 * eleven answers riding the existing 'intelligence' report kind with honest
 * empty-state lines.
 */
import { describe, expect, it } from 'vitest';
import { STRATEGY_QUESTION_KEYS } from '@neuropause/shared';
import { buildCapabilityMap } from './capabilityMap';
import { buildRiskViews, buildStrategyHealth } from './strategyHealth';
import { composeBoardReport, composeStrategyDashboard, type DashboardInputs } from './executiveDashboard';
import { answerStrategyQuestion, resolveStrategyQuestion, type StrategyQuestionContext } from './strategyModel';
import type { BusinessValueReport, ObjectivesReport, PlanningReport, PortfolioReport } from '@neuropause/shared';

const NOW = '2026-07-31T12:00:00.000Z';

describe('resolveStrategyQuestion — the eleven executive questions', () => {
  const CASES: [string, string][] = [
    ['What is the state of our strategy?', 'strategy-status'],
    ['Strategy status, please', 'strategy-status'],
    ['Which objectives are at risk?', 'objectives-at-risk'],
    ['How are our OKRs doing?', 'objectives-at-risk'],
    ['Show me the initiative portfolio', 'initiative-portfolio'],
    ['Which decisions delivered business value?', 'business-value'],
    ['Which departments are misaligned?', 'alignment'],
    ['What should the executive team focus on this quarter?', 'executive-focus'],
    ['What are our strategic risks?', 'strategic-risks'],
    ['Show the roadmap', 'roadmap-outlook'],
    ['What are our investment priorities?', 'investment-priorities'],
    ['Prepare the board brief', 'board-brief'],
    ['Which business capability is weakest?', 'capability-analysis'],
    ['Which capabilities lack standards?', 'capability-analysis'],
  ];

  it('matches each phrasing to its key', () => {
    for (const [text, key] of CASES) expect(resolveStrategyQuestion(text), text).toBe(key);
  });

  it('returns null for non-strategy asks (and for the Stage 9 operational-objectives phrasing)', () => {
    for (const text of [
      'draft an email to the team',
      'What are our operational objectives?', // Stage 9 ops-planning — NOT ours
      'Operations status, please', // Stage 9
      'Are we meeting our SLAs?', // Stage 9
      'What is the status of my automations?', // Stage 8
      'What is our deployment policy?', // Stage 7
      'Summarize the current enterprise health', // Stage 6
      'monthly summary', // Stage 5 brief
      '',
    ]) {
      expect(resolveStrategyQuestion(text), text).toBeNull();
    }
  });

  it('every published question key is reachable by at least one phrasing', () => {
    const reached = new Set(CASES.map(([, k]) => k));
    for (const k of STRATEGY_QUESTION_KEYS) expect(reached.has(k), k).toBe(true);
  });
});

/* ── answers over a small composed context ────────────────────────────────── */

function objectives(): ObjectivesReport {
  return {
    generatedAt: NOW,
    company: [
      {
        id: 'co-reliable-execution',
        kind: 'company',
        label: 'Reliable governed execution',
        description: '',
        themeId: 'reliable-autonomous-operations',
        horizon: 'current-quarter',
        owner: null,
        unitName: 'Operations',
        companyObjectiveId: null,
        capabilityKeys: ['operations'],
        measures: [
          { kind: 'sla', ref: 'exec-success-rate', reading: 'breached', state: 'bad', detail: 'success 82% < 90%' },
        ],
        health: 'off-track',
        healthDetail: '1/1 measure(s) failing: exec-success-rate',
        rollup: [],
      },
    ],
    departments: [],
    totals: { onTrack: 0, atRisk: 0, offTrack: 1, unknown: 0 },
    gaps: [],
    unavailable: [],
  };
}

function portfolio(): PortfolioReport {
  return {
    generatedAt: NOW,
    initiatives: [
      {
        id: 'init-incident-response',
        label: 'Governed incident response',
        description: '',
        companyObjectiveId: 'co-reliable-execution',
        capabilityKeys: ['operations', 'support'],
        owner: null,
        state: 'blocked',
        stateDetail: 'milestone blocked by an SLA breach: Execution success inside its SLA',
        sources: [{ kind: 'playbook', ref: 'incident-first-response', available: true, summary: 'playbook v1 shipped' }],
        milestones: [{ id: 'm-exec-sla', label: 'Execution success inside its SLA', satisfied: false, detail: 'BREACHED' }],
        blockers: [{ reason: 'milestone blocked by an SLA breach: Execution success inside its SLA', evidence: ['m-exec-sla'] }],
        dependsOn: [],
      },
    ],
    totals: { advancing: 0, blocked: 1, stalled: 0, done: 0, unknown: 0 },
    gaps: [],
    unavailable: [],
  };
}

function emptyValue(): BusinessValueReport {
  return {
    generatedAt: NOW,
    decisions: [],
    totals: { delivered: 0, partial: 0, notYetObserved: 0, unmeasurable: 0 },
    disclosure: 'no currency — computed only',
    unavailable: [],
  };
}

function planning(): PlanningReport {
  return { generatedAt: NOW, horizons: [], unavailable: [] };
}

function mkCtx(): StrategyQuestionContext {
  const capabilities = buildCapabilityMap({
    nowIso: NOW,
    signals: { domains: null, kpis: null, s9Services: null, readiness: null, minedTypes: null, compliance: null, slaStatuses: null, apFindings: null, decisions: null },
    objectives: [],
    initiatives: [],
    units: null,
    users: null,
    knowledgeMatch: null,
    failures: {},
  });
  const health = buildStrategyHealth({
    nowIso: NOW,
    objectives: objectives(),
    capabilities,
    layers: { insightBand: 'healthy', knowledge: null, automation: null, operations: null, p14: null },
    risks: { slaStatuses: null, readiness: null, apFindings: null, incidentDomains: null },
    units: [{ id: 'u1', name: 'Design' }],
    failures: {},
  });
  const inputs: DashboardInputs = {
    nowIso: NOW,
    objectives: objectives(),
    portfolio: portfolio(),
    value: emptyValue(),
    planning: planning(),
    capabilities,
    health,
    kpis: [],
  };
  return {
    objectives: objectives(),
    portfolio: portfolio(),
    value: emptyValue(),
    planning: planning(),
    capabilities,
    health,
    dashboard: composeStrategyDashboard(inputs),
    board: composeBoardReport(inputs),
    nowIso: NOW,
  };
}

describe('answerStrategyQuestion — evidence-cited, honest', () => {
  it("every answer rides the existing 'intelligence' report kind, grounded, with sections", () => {
    const ctx = mkCtx();
    for (const key of STRATEGY_QUESTION_KEYS) {
      const r = answerStrategyQuestion(key, ctx);
      expect(r.kind, key).toBe('intelligence');
      expect(r.grounded, key).toBe(true);
      expect(r.sections.length, key).toBeGreaterThan(0);
    }
  });

  it('objectives-at-risk names the failing objective with its computed detail and evidence', () => {
    const r = answerStrategyQuestion('objectives-at-risk', mkCtx());
    const answer = r.sections.find((s) => s.title === 'Answer')!;
    expect(answer.lines[0]).toContain('Reliable governed execution');
    expect(answer.lines[0]).toContain('OFF-TRACK');
    const evidence = r.sections.find((s) => s.title === 'Evidence')!;
    expect(evidence.lines[0]).toContain('exec-success-rate');
  });

  it('business-value with an empty decision store answers honestly — no value history to compute', () => {
    const r = answerStrategyQuestion('business-value', mkCtx());
    expect(r.sections.find((s) => s.title === 'Answer')!.lines[0]).toContain('no value history to compute');
    expect(r.sections.find((s) => s.title === 'Uncertainty')!.lines[0]).toContain('no currency');
  });

  it('strategic-risks with quiet signals states the honest all-quiet line', () => {
    const r = answerStrategyQuestion('strategic-risks', mkCtx());
    expect(r.sections.find((s) => s.title === 'Answer')!.lines[0]).toContain('No strategic risk is currently substantiated');
    expect(r.sections.find((s) => s.title === 'Registered but quiet')!.lines).toHaveLength(5);
  });

  it('alignment names the unbound unit as misaligned', () => {
    const r = answerStrategyQuestion('alignment', mkCtx());
    expect(r.sections.find((s) => s.title === 'Answer')!.lines[0]).toContain('Design');
  });

  it('board-brief returns the composed board report verbatim (title + sections)', () => {
    const ctx = mkCtx();
    const r = answerStrategyQuestion('board-brief', ctx);
    expect(r.title).toBe(ctx.board.title);
    expect(r.sections.map((s) => s.title)).toEqual(ctx.board.sections.map((s) => s.title));
  });

  it('capability-analysis reports unsupported capabilities and the no-weakness honesty line', () => {
    const r = answerStrategyQuestion('capability-analysis', mkCtx());
    const answer = r.sections.find((s) => s.title === 'Answer')!;
    expect(answer.lines[0]).toContain('No capability is judged weak');
    expect(answer.lines.some((l) => l.includes('Unsupported by initiatives'))).toBe(true);
    expect(r.sections.find((s) => s.title === 'Capabilities')!.lines).toHaveLength(12);
  });

  it('executive-focus with no horizons reports no focus items honestly', () => {
    const r = answerStrategyQuestion('executive-focus', mkCtx());
    expect(r.sections.find((s) => s.title === 'Answer')!.lines[0]).toContain('No focus items');
  });
});
