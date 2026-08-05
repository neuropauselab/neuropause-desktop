/**
 * Phase 6 Stage 13 — the twin platform model: the ten question resolvers, the
 * NINE-WAY resolver disjointness (S5 brief/worksummary + S6 + S7 + S8 + S9 +
 * S10 + S11 + S12 + S13, both directions), and the ten answers riding the
 * existing 'intelligence' report kind over a real composed context.
 *
 * Disjointness is the load-bearing property here, and it is checked in BOTH
 * directions: no Stage 13 phrasing may resolve through an earlier stage, and no
 * earlier stage's canonical question may resolve through Stage 13. A one-way
 * check would pass happily while a resolver quietly stole a phrase.
 *
 * FINDING #3 (real overlap, found while writing this file, fixed in
 * `twinPlatformModel.ts` as OVERLAP 5, locked by the named test below).
 * Stage 10 owns `/\b(business )?capabilit(y|ies)\b/`, which fires on the word
 * wherever it appears in the input. Stage 13's module header already declared
 * `capabilit(y|ies)` off-limits, but that had been implemented only as "do not
 * write a `capability` matcher" — and `"simulation capability"` reaches Stage
 * 13's simulation branch through `simulat…`, not through `capability`. Both
 * resolvers therefore claimed the phrase. Stage 10 is deliberately NOT narrowed
 * to fix it: the guard is added to Stage 13's own branch, exactly as overlaps
 * 3 and 4 are handled, so the earlier stage keeps the phrase unchanged.
 *
 * Observed and deliberately NOT changed: the matchers are bare-stem, so
 * `"twin drifts"` and `"the twin is drifting"` fall through to null. This is
 * house style rather than a Stage 13 defect — Stage 12's own trend matcher is
 * `/\btrends?\b/` and is equally bare — so widening it here would be scope
 * creep, not a correction. The canonical phrasings below therefore stay inside
 * the vocabulary the resolver actually claims.
 *
 * Also observed: nine of the ten answers close with an `Uncertainty` section,
 * but `twin-report` does not, because it re-emits `composeTwinReport`'s own
 * sections VERBATIM. That is the honest choice — an answer that edited the
 * report would diverge from the report the dashboard publishes — and the
 * report surfaces unreadability per section instead. Both shapes are asserted
 * rather than assumed.
 *
 * Everything here is deterministic: fixtures are literals and the composed
 * context is built once from them; no clock is read.
 */
import { describe, expect, it } from 'vitest';
import {
  ETWIN_QUESTION_KEYS,
  type EanaTrendReport,
  type EanaTrendRow,
  type EnterpriseTwinDomain,
  type EtwinQuestionKey,
  type ExecutionSession,
  type ExecutionStats,
  type RecoveryPolicy,
  type RecoveryRecord,
  type SupervisedSubsystem,
  type SupervisorStatus,
  type TwinBand,
  type TwinDomainId,
  type TwinDomains,
  type TwinSummary,
} from '@neuropause/shared';
import { resolveInsightQuestion } from '../insight/insightModel';
import { resolveKnowledgeQuestion } from '../knowledgeAssets/knowledgeModel';
import { resolveAutomationQuestion } from '../automationPlatform/automationModel';
import { resolveOperationsQuestion } from '../operationsPlatform/operationsModel';
import { resolveStrategyQuestion } from '../strategyPlatform/strategyModel';
import { resolveFederationQuestion } from '../enterpriseFederation/federationModel';
import { resolveAnalyticsQuestion } from '../analyticsPlatform/analyticsModel';
import { resolveBriefRequest, resolveWorkSummary } from '../assistant/assistantModel';
import { buildRuntimeTwin } from './runtimeTwin';
import { buildPlatformTwins, type PlatformSlices } from './platformTwins';
import { buildCoverageMap } from './stateCoverage';
import { buildSimulationInventory } from './simulationInventory';
import { buildHistoryView } from './twinHistory';
import { composeTwinDashboard, composeTwinReport, type EtwinDashboardInputs } from './twinDashboard';
import { answerTwinQuestion, resolveTwinQuestion, type TwinQuestionContext } from './twinPlatformModel';

const NOW = '2026-08-01T09:00:00.000Z';

/* ── the ten questions ────────────────────────────────────────────────────── */

const ETWIN_CASES: [string, EtwinQuestionKey][] = [
  ['Twin status, please', 'twin-status'],
  ['How is the digital twin?', 'twin-status'],
  ['State of the twin?', 'twin-status'],
  ['twin overview', 'twin-status'],
  ['Show me the twin platform', 'twin-status'],
  ['Show me the runtime twin', 'runtime-twin'],
  ['Supervisor status, please', 'runtime-twin'],
  ['Which subsystems are recovering?', 'runtime-twin'],
  ['What is our recovery policy?', 'runtime-twin'],
  ['Show the execution twin', 'execution-twin'],
  ['Execute engine status', 'execution-twin'],
  ['How many active sessions?', 'execution-twin'],
  ['Any failed sessions?', 'execution-twin'],
  ['Show me the platform twins', 'platform-twins'],
  ['Which platforms are steady?', 'platform-twins'],
  ['State coverage, please', 'state-coverage'],
  ['Show me the coverage map', 'state-coverage'],
  ['What does the twin model?', 'state-coverage'],
  ['What is not modelled?', 'what-is-not-modelled'],
  ['What are the gaps in the twin?', 'what-is-not-modelled'],
  ["What's missing from the twin?", 'what-is-not-modelled'],
  ['What can we simulate?', 'simulation-capability'],
  ['Do we have what-if scenarios?', 'simulation-capability'],
  ['Show me the twin history', 'twin-history'],
  ['How many recorded days?', 'twin-history'],
  ['recorded decisions', 'twin-history'],
  ['twin drift, please', 'twin-drift'],
  ['Twin focus, please', 'twin-drift'],
  ['Prepare the twin report', 'twin-report'],
  ['twin platform summary', 'twin-report'],
];

describe('resolveTwinQuestion — the ten questions', () => {
  it('matches each phrasing to its key', () => {
    for (const [text, key] of ETWIN_CASES) expect(resolveTwinQuestion(text), text).toBe(key);
  });

  it('every published question key is reachable', () => {
    const reached = new Set(ETWIN_CASES.map(([, k]) => k));
    for (const k of ETWIN_QUESTION_KEYS) expect(reached.has(k), k).toBe(true);
  });

  it('is case- and whitespace-insensitive, so the key does not depend on how it was typed', () => {
    for (const [text, key] of ETWIN_CASES) {
      expect(resolveTwinQuestion(`  ${text.toUpperCase()}  `), text).toBe(key);
    }
  });

  it('returns null for non-twin asks, including the empty string', () => {
    for (const text of ['draft an email', 'what is the weather', 'reboot the server', '', '   ']) {
      expect(resolveTwinQuestion(text), JSON.stringify(text)).toBeNull();
    }
  });
});

/* ── nine-way disjointness, both directions ───────────────────────────────── */

describe('NINE-WAY resolver disjointness (both directions)', () => {
  const OTHERS: [string, (t: string) => unknown][] = [
    ['S5-brief', (t) => resolveBriefRequest(t)],
    ['S5-worksummary', (t) => (resolveWorkSummary(t) ? 'ws' : null)],
    ['S6-insight', (t) => resolveInsightQuestion(t)],
    ['S7-knowledge', (t) => resolveKnowledgeQuestion(t)],
    ['S8-automation', (t) => resolveAutomationQuestion(t)],
    ['S9-operations', (t) => resolveOperationsQuestion(t)],
    ['S10-strategy', (t) => resolveStrategyQuestion(t)],
    ['S11-federation', (t) => resolveFederationQuestion(t)],
    ['S12-analytics', (t) => resolveAnalyticsQuestion(t)],
  ];

  it('covers all eight earlier resolver sets — a stage missing from this list is an untested overlap', () => {
    expect(OTHERS).toHaveLength(9);
    expect(OTHERS.map(([l]) => l)).toEqual([
      'S5-brief',
      'S5-worksummary',
      'S6-insight',
      'S7-knowledge',
      'S8-automation',
      'S9-operations',
      'S10-strategy',
      'S11-federation',
      'S12-analytics',
    ]);
  });

  it('every twin phrasing resolves through NO earlier stage', () => {
    for (const [text] of ETWIN_CASES) {
      for (const [label, resolve] of OTHERS) {
        expect(resolve(text), `${label} must not match "${text}"`).toBeFalsy();
      }
    }
  });

  it('every earlier stage keeps its canonical questions — the twin resolver stays silent on them', () => {
    const CANONICAL = [
      'morning brief', // S5
      'Summarize the current enterprise health', // S6
      'What risks do you predict?', // S6 (prediction stays with insight)
      'What is our deployment policy?', // S7
      'What is the status of my automations?', // S8
      'Are we meeting our SLAs?', // S9
      'Capacity status, please', // S9
      'Which objectives are at risk?', // S10
      'Prepare the board brief', // S10
      'Which business capability is weakest?', // S10
      'Federation status, please', // S11
      'Intelligence network posture?', // S11
      'Which partners do we trust?', // S11
      'Analytics status, please', // S12
      'Show me the KPI catalog', // S12
      'Show me our trends', // S12 (trend vocabulary stays with analytics)
      'Which KPIs are regressing?', // S12
      'What can the platform predict?', // S12
      'Decision intelligence, please', // S12
      'What is our benchmark position?', // S12
      'Prepare the analytics report', // S12
      'What data do we record?', // S12
    ];
    for (const text of CANONICAL) expect(resolveTwinQuestion(text), text).toBeNull();
  });

  it('each canonical question still reaches the stage that owns it — silence here would be a false pass', () => {
    const OWNED: [string, string][] = [
      ['morning brief', 'S5-brief'],
      ['Summarize the current enterprise health', 'S6-insight'],
      ['What is our deployment policy?', 'S7-knowledge'],
      ['What is the status of my automations?', 'S8-automation'],
      ['Are we meeting our SLAs?', 'S9-operations'],
      ['Which business capability is weakest?', 'S10-strategy'],
      ['Which partners do we trust?', 'S11-federation'],
      ['Show me our trends', 'S12-analytics'],
    ];
    for (const [text, owner] of OWNED) {
      const resolve = OTHERS.find(([l]) => l === owner)![1];
      expect(resolve(text), `${owner} must still own "${text}"`).toBeTruthy();
    }
  });
});

/* ── the five routed-around overlaps ──────────────────────────────────────── */

describe('the routed-around overlaps stay routed around', () => {
  it('OVERLAP 1 — "how is the enterprise twin" belongs to Stage 6, not Stage 13', () => {
    expect(resolveInsightQuestion('How is the enterprise twin?')).toBeTruthy();
    expect(resolveTwinQuestion('How is the enterprise twin?')).toBeNull();
    // …while the phrasing without `enterprise` in front of `twin` is Stage 13's.
    expect(resolveTwinQuestion('How is the digital twin?')).toBe('twin-status');
    expect(resolveInsightQuestion('How is the digital twin?')).toBeFalsy();
  });

  it('OVERLAP 2 — "data coverage map" belongs to Stage 12, not Stage 13', () => {
    expect(resolveAnalyticsQuestion('data coverage map')).toBe('data-coverage');
    expect(resolveTwinQuestion('data coverage map')).toBeNull();
    expect(resolveAnalyticsQuestion('What data coverage do we have?')).toBe('data-coverage');
    expect(resolveTwinQuestion('What data coverage do we have?')).toBeNull();
    // …while a coverage map that is not a DATA coverage map is Stage 13's.
    expect(resolveTwinQuestion('Show me the coverage map')).toBe('state-coverage');
    expect(resolveAnalyticsQuestion('Show me the coverage map')).toBeNull();
  });

  it('OVERLAP 3 — simulating a playbook or an automation belongs to Stage 8, not Stage 13', () => {
    for (const text of ['Simulate the incident playbook', 'simulate the daily-ops-review playbook']) {
      expect(resolveAutomationQuestion(text), text).toBe('simulate-automation');
      expect(resolveTwinQuestion(text), text).toBeNull();
    }
    // …while simulating nothing in particular is Stage 13's.
    expect(resolveTwinQuestion('What can we simulate?')).toBe('simulation-capability');
    expect(resolveAutomationQuestion('What can we simulate?')).toBeFalsy();
  });

  it('OVERLAP 4 — "disaster recovery policy" belongs to Stage 9, not Stage 13', () => {
    expect(resolveOperationsQuestion('What is our disaster recovery policy?')).toBeTruthy();
    expect(resolveTwinQuestion('What is our disaster recovery policy?')).toBeNull();
    // …while a plain recovery policy — the supervisor's — is Stage 13's.
    expect(resolveTwinQuestion('What is our recovery policy?')).toBe('runtime-twin');
    expect(resolveOperationsQuestion('What is our recovery policy?')).toBeFalsy();
  });

  /**
   * FINDING #3, test-locked. Before the fix this phrase resolved to BOTH
   * `simulation-capability` (Stage 13, via `simulat…`) and `capability-analysis`
   * (Stage 10, via `capabilit(y|ies)`) — a genuine two-way overlap that the
   * module header wrongly believed it had avoided by not writing a `capability`
   * matcher. Stage 10 keeps the phrase; Stage 13 declines it.
   */
  it('OVERLAP 5 — "simulation capability" belongs to Stage 10, not Stage 13 (FINDING #3)', () => {
    expect(resolveStrategyQuestion('simulation capability')).toBe('capability-analysis');
    expect(resolveTwinQuestion('simulation capability')).toBeNull();

    for (const text of [
      'What simulation capabilities do we have?',
      'Do we have a what-if capability?',
      'simulate — which capability?',
    ]) {
      expect(resolveStrategyQuestion(text), text).toBe('capability-analysis');
      expect(resolveTwinQuestion(text), text).toBeNull();
    }

    // The guard is scoped to the word `capabilit(y|ies)`, so every simulation
    // phrasing that does NOT borrow Stage 10's noun is unaffected.
    for (const text of ['What can we simulate?', 'Do we have what-if scenarios?', 'simulation, please']) {
      expect(resolveTwinQuestion(text), text).toBe('simulation-capability');
    }
  });

  it('leaves Stage 10 exactly as wide as it was — the fix narrowed Stage 13, never an earlier stage', () => {
    for (const text of [
      'Which business capability is weakest?',
      'capability map',
      'Show me our capabilities',
      'simulation capability',
    ]) {
      expect(resolveStrategyQuestion(text), text).toBe('capability-analysis');
    }
  });
});

/* ── a real composed context ──────────────────────────────────────────────── */

function mkSession(over: Partial<ExecutionSession> & { id: string; kind: ExecutionSession['kind'] }): ExecutionSession {
  return {
    label: `session ${over.id}`,
    state: 'completed',
    steps: [],
    currentStep: -1,
    startedAt: '2026-07-31T12:00:00.000Z',
    completedAt: '2026-07-31T12:00:05.000Z',
    durationMs: 5_000,
    error: null,
    resultSummary: null,
    result: null,
    ...over,
  };
}

function mkRecord(over: Partial<RecoveryRecord> & { id: string; subsystem: SupervisedSubsystem }): RecoveryRecord {
  return {
    reason: 'unhealthy',
    startedAt: '2026-07-31T12:00:00.000Z',
    durationMs: 120,
    ok: true,
    detail: null,
    ...over,
  };
}

const POLICIES: Record<SupervisedSubsystem, RecoveryPolicy> = {
  runtime: 'automatic',
  platform: 'manual',
  automation: 'automatic',
  voice: 'disabled',
  backend: 'automatic',
};

const STATS: ExecutionStats = {
  active: 1,
  queued: 0,
  completed: 6,
  failed: 2,
  cancelled: 1,
  successRate: 0.75,
  averageRuntimeMs: 4_100,
};

/** The one recovery the supervisor recorded this process — it failed. */
const LAST_RECOVERY: RecoveryRecord = mkRecord({
  id: 'r1',
  subsystem: 'backend',
  ok: false,
  detail: 'restart failed',
  startedAt: '2026-07-31T23:00:00.000Z',
});

const STATUS: SupervisorStatus = {
  policies: POLICIES,
  recovering: ['backend'],
  // `lastRecovery` is the RECORD itself, not a timestamp — the supervisor hands
  // over the whole thing and Stage 13 carries it through without flattening it.
  lastRecovery: LAST_RECOVERY,
  recoveryCount: 3,
  recentFailures: 1,
};

function mkDomain(id: TwinDomainId, name: string, entityCount: number, band: TwinBand): EnterpriseTwinDomain {
  return {
    id,
    name,
    description: `${name} domain`,
    entityCount,
    band,
    status: 'ok',
    metrics: [],
    source: 'twinModel',
    live: true,
  };
}

const DOMAINS: TwinDomains = {
  domains: [
    mkDomain('enterprise', 'Enterprise', 12, 'healthy'),
    mkDomain('organization', 'Organization', 34, 'watch'),
  ],
  totalEntities: 46,
  healthyDomains: 1,
  degradedDomains: 1,
};

const SLICES: PlatformSlices = {
  s6Insight: { findings: 4, criticalOrHigh: 1 },
  s7Knowledge: { assets: 20, gaps: 0 },
  s8Automation: { automations: 8, failures: 0 },
  s9Operations: { posture: 'stable', bottlenecks: 0 },
  s10Strategy: { objectives: 6, atRisk: 0 },
  s11Federation: null, // unreadable this pass — must stay `unknown`, never `steady`
  s12Analytics: { kpis: 24, regressing: 0 },
};

/** Row shapes copied from the real Stage 12 producer, not invented. */
const TREND_ROWS: EanaTrendRow[] = [
  {
    seriesId: 'org-health-history',
    label: 'Org health (90-day daily history)',
    kind: 'daily-history',
    windowLabel: '2026-05-03 → 2026-08-01 (91 recorded day(s))',
    from: 62,
    to: 71,
    delta: 9,
    direction: 'improving',
    detail: '62 → 71 (+9) over the recorded window (stable within ±2)',
  },
  {
    seriesId: 'decision:dec-1:Support load',
    label: 'Consolidate vendors — Support load',
    kind: 'decision-window',
    windowLabel: 'the decision window (Stage 10, measured)',
    from: 55,
    to: 55,
    delta: 0,
    direction: 'stable',
    detail: '55 → 55 over the decision window',
  },
  {
    seriesId: 'twin-overall-health',
    label: 'Twin overall health',
    kind: 'point-in-time',
    windowLabel: 'this pass only',
    from: null,
    to: null,
    delta: null,
    direction: 'unavailable',
    detail: 'computed per read — no series is retained',
  },
];

const TRENDS: EanaTrendReport = {
  generatedAt: NOW,
  rows: TREND_ROWS,
  totals: { improving: 1, stable: 1, regressing: 0, unavailable: 1 },
  disclosure: 'Stage 12 trend disclosure.',
  unavailable: [],
};

const TWIN: TwinSummary = {
  generatedAt: NOW,
  domainCount: 9,
  totalEntities: 450,
  overallHealth: 71,
  healthBand: 'watch',
  overallRisk: 29,
  riskBand: 'watch',
  criticalImpactNodes: 2,
  openDecisions: 3,
  liveDomains: 8,
};

/**
 * One composed context, built from the literals above through the REAL builders
 * — so an answer that misreads a composed shape fails here rather than passing
 * against a hand-written view that happens to match its expectations.
 */
function mkCtx(): TwinQuestionContext {
  const runtime = buildRuntimeTwin({
    nowIso: NOW,
    execution: {
      registeredKinds: ['decision', 'task'],
      active: [mkSession({ id: 'a1', kind: 'decision', state: 'running', completedAt: null, durationMs: null })],
      history: [
        mkSession({ id: 'h1', kind: 'task' }),
        mkSession({ id: 'h2', kind: 'task', state: 'failed', error: 'boom' }),
      ],
      stats: STATS,
    },
    supervisor: { status: STATUS, history: [LAST_RECOVERY] },
    failures: { 'p15-topology': 'topology read threw' },
  });

  const platforms = buildPlatformTwins({
    nowIso: NOW,
    domains: DOMAINS,
    slices: SLICES,
    failures: { 's11-federation': 'federation slice threw' },
  });

  const coverage = buildCoverageMap({
    nowIso: NOW,
    domains: DOMAINS,
    runtime: { activeSessions: 1, registeredKinds: 2 },
    failures: {},
  });

  const simulation = buildSimulationInventory({
    nowIso: NOW,
    predictions: [{ kind: 'approval-backlog' }],
    scenarios: { count: 5 },
    forecasts: { registered: 3 },
    failures: {},
  });

  const history = buildHistoryView({
    nowIso: NOW,
    trends: TRENDS,
    recordedDays: 91,
    recordedDecisions: 4,
    failures: {},
  });

  const inputs: EtwinDashboardInputs = {
    nowIso: NOW,
    twin: TWIN,
    runtime,
    platforms,
    coverage,
    simulation,
    history,
  };

  return {
    runtime,
    platforms,
    coverage,
    simulation,
    history,
    dashboard: composeTwinDashboard(inputs),
    report: composeTwinReport(inputs),
    nowIso: NOW,
  };
}

const CTX = mkCtx();

/* ── the ten answers ──────────────────────────────────────────────────────── */

describe('answerTwinQuestion — the contract every answer keeps', () => {
  it('answers every published key on the intelligence kind, grounded, with a title and sections', () => {
    for (const key of ETWIN_QUESTION_KEYS) {
      const a = answerTwinQuestion(key, CTX);
      expect(a.kind, key).toBe('intelligence');
      expect(a.grounded, key).toBe(true);
      expect(a.title.length, key).toBeGreaterThan(0);
      expect(a.sections.length, key).toBeGreaterThan(0);
    }
  });

  it('emits no empty section — a heading with nothing under it is a claim of content that is not there', () => {
    for (const key of ETWIN_QUESTION_KEYS) {
      for (const s of answerTwinQuestion(key, CTX).sections) {
        expect(s.lines.length, `${key} / ${s.title}`).toBeGreaterThan(0);
        expect(s.title.length, key).toBeGreaterThan(0);
      }
    }
  });

  it('closes the nine composed answers with an Uncertainty section', () => {
    for (const key of ETWIN_QUESTION_KEYS) {
      if (key === 'twin-report') continue;
      const sections = answerTwinQuestion(key, CTX).sections;
      expect(sections[sections.length - 1].title, key).toBe('Uncertainty');
    }
  });

  it('re-emits the twin report verbatim rather than editing it — which is why it has no Uncertainty section', () => {
    const a = answerTwinQuestion('twin-report', CTX);
    expect(a.title).toBe(CTX.report.title);
    // `report()` drops empty sections, so the answer is the report's non-empty
    // sections, in order, with their lines untouched.
    expect(a.sections).toEqual(CTX.report.sections.filter((s) => s.lines.length > 0));
    expect(a.sections.some((s) => s.title === 'Uncertainty')).toBe(false);
    // …and every section of the report the dashboard publishes survives, so
    // nothing is quietly dropped on the way to the assistant.
    expect(a.sections).toHaveLength(CTX.report.sections.length);
  });

  it('is deterministic — the same key over the same context answers identically', () => {
    for (const key of ETWIN_QUESTION_KEYS) {
      expect(answerTwinQuestion(key, CTX), key).toEqual(answerTwinQuestion(key, CTX));
    }
  });
});

describe('the answers cite the composed views, never a recomputation', () => {
  const linesOf = (key: EtwinQuestionKey): string =>
    answerTwinQuestion(key, CTX)
      .sections.flatMap((s) => s.lines)
      .join('\n');

  it('twin-status carries P15’s own health and band verbatim', () => {
    const text = linesOf('twin-status');
    expect(text).toContain('9 domain(s)');
    expect(text).toContain('450 entity(ies)');
    expect(text).toContain('overall health 71 (watch)');
    expect(text).toContain('2 critical impact node(s)');
    expect(text).toContain('3 open decision(s)');
  });

  it('runtime-twin reports the supervisor’s own status and the recovering subsystem', () => {
    const text = linesOf('runtime-twin');
    expect(text).toContain('1 subsystem(s) recovering now');
    expect(text).toContain('3 recorded recovery(ies)');
    expect(text).toContain('1 recent failure(s)');
    expect(text).toContain('backend');
    expect(text).toContain('RECOVERING');
    // The policy is the supervisor's, not a Stage 13 default.
    expect(text).toContain('platform: policy manual');
  });

  it('execution-twin reports the engine’s own statistics, not a recomputed success rate', () => {
    const text = linesOf('execution-twin');
    expect(text).toContain('6 completed');
    expect(text).toContain('2 failed');
    expect(text).toContain('1 cancelled');
    expect(text).toContain('success rate 0.75');
    // Per-kind counts are Stage 13's only derivation, and they count what was
    // observed: one failed `task` session in the recorded history.
    expect(text).toContain('task: 0 active · 2 historical · 1 failed');
  });

  it('platform-twins reports the unreadable platform as unknown, never as steady', () => {
    const text = linesOf('platform-twins');
    expect(text).toContain('UNKNOWN');
    expect(CTX.platforms.totals.unknown).toBe(1);
    const federation = CTX.platforms.platforms.find((p) => p.id.includes('federation'))!;
    expect(federation.state).toBe('unknown');
    expect(text).toContain(federation.label);
  });

  it('state-coverage sorts every registered state kind into exactly one status bucket', () => {
    const t = CTX.coverage.totals;
    expect(t.modelledByTwin + t.modelledElsewhere + t.notModelled).toBe(t.total);
    const text = linesOf('state-coverage');
    expect(text).toContain(`${t.total} state kind(s)`);
    expect(text).toContain(`${t.notModelled} not modelled anywhere`);
  });

  it('what-is-not-modelled names a gap only where the coverage map recorded one, with its evidence', () => {
    const gaps = CTX.coverage.rows.filter((r) => r.status === 'not-modelled');
    const a = answerTwinQuestion('what-is-not-modelled', CTX);
    const answer = a.sections.find((s) => s.title === 'Answer')!;
    expect(answer.lines).toHaveLength(gaps.length);
    const evidence = a.sections.find((s) => s.title === 'Evidence for each gap')!;
    for (const g of gaps) {
      expect(evidence.lines.some((l) => l.includes(g.evidence)), g.label).toBe(true);
    }
  });

  it('simulation-capability states the invocation count as zero of the registered total', () => {
    const text = linesOf('simulation-capability');
    expect(text).toContain(`Stage 13 invoked 0 of ${CTX.simulation.totals.registered} registered capabilit(ies)`);
    expect(CTX.simulation.entries.every((e) => e.invoked === false)).toBe(true);
    // The unobservable entry is declared as unobservable, not counted as zero.
    expect(text).toContain('null is not zero');
  });

  it('twin-history reports Stage 12’s totals and both store counts', () => {
    const text = linesOf('twin-history');
    expect(text).toContain('1 improving');
    expect(text).toContain('1 stable');
    expect(text).toContain('91 recorded day(s)');
    expect(text).toContain('4 recorded decision(s)');
    // The point-in-time series is declared untrendable rather than given a delta.
    expect(text).toContain('Twin overall health');
  });

  it('twin-drift reports the composition’s own blind spots and says that is what it means', () => {
    const a = answerTwinQuestion('twin-drift', CTX);
    const text = a.sections.flatMap((s) => s.lines).join('\n');
    expect(text).toContain('federation slice threw');
    expect(text).toContain('topology read threw');
    const uncertainty = a.sections.find((s) => s.title === 'Uncertainty')!;
    expect(uncertainty.lines[0]).toContain('not a computed divergence metric');
  });
});

describe('an unreadable pass answers with declarations, never with zeros', () => {
  /** Every composed input at its unreadable extreme. */
  const BLIND: TwinQuestionContext = (() => {
    const runtime = buildRuntimeTwin({
      nowIso: NOW,
      execution: null,
      supervisor: null,
      failures: { 'execute-engine': 'engine read threw', 'runtime-supervisor': 'supervisor read threw' },
    });
    const platforms = buildPlatformTwins({
      nowIso: NOW,
      domains: null,
      slices: {
        s6Insight: null,
        s7Knowledge: null,
        s8Automation: null,
        s9Operations: null,
        s10Strategy: null,
        s11Federation: null,
        s12Analytics: null,
      },
      failures: { 'p15-twin': 'domains read threw' },
    });
    const coverage = buildCoverageMap({ nowIso: NOW, domains: null, runtime: null, failures: {} });
    const simulation = buildSimulationInventory({
      nowIso: NOW,
      predictions: null,
      scenarios: null,
      forecasts: null,
      failures: {},
    });
    const history = buildHistoryView({
      nowIso: NOW,
      trends: null,
      recordedDays: null,
      recordedDecisions: null,
      failures: { 's12-analytics': 'trend report threw' },
    });
    const inputs: EtwinDashboardInputs = {
      nowIso: NOW,
      twin: null,
      runtime,
      platforms,
      coverage,
      simulation,
      history,
    };
    return {
      runtime,
      platforms,
      coverage,
      simulation,
      history,
      dashboard: composeTwinDashboard(inputs),
      report: composeTwinReport(inputs),
      nowIso: NOW,
    };
  })();

  it('still answers all ten keys — an unreadable pass produces an answer, not a crash', () => {
    for (const key of ETWIN_QUESTION_KEYS) {
      const a = answerTwinQuestion(key, BLIND);
      expect(a.kind, key).toBe('intelligence');
      expect(a.sections.length, key).toBeGreaterThan(0);
    }
  });

  it('says the twin was unreadable rather than reporting a health of 0', () => {
    const text = answerTwinQuestion('twin-status', BLIND)
      .sections.flatMap((s) => s.lines)
      .join('\n');
    expect(text).toContain('unreadable this pass — no health is assumed');
    expect(text).not.toContain('overall health 0');
  });

  it('says the engine and the supervisor were unreadable rather than reporting an idle runtime', () => {
    const exec = answerTwinQuestion('execution-twin', BLIND)
      .sections.flatMap((s) => s.lines)
      .join('\n');
    expect(exec).toContain('not readable this pass');
    expect(exec).not.toContain('0 active session(s)');

    const sup = answerTwinQuestion('runtime-twin', BLIND)
      .sections.flatMap((s) => s.lines)
      .join('\n');
    expect(sup).toContain('not readable this pass');
  });

  it('carries the null-not-zero rollup into the dashboard the answers read from', () => {
    expect(BLIND.dashboard.runtime.failed).toBeNull();
    expect(BLIND.dashboard.runtime.recovering).toBeNull();
    expect(BLIND.dashboard.runtime.available).toBe(false);
  });

  it('reports every platform as unknown — none of the seven rounds up to steady', () => {
    expect(BLIND.platforms.totals.unknown).toBe(BLIND.platforms.totals.platforms);
    expect(BLIND.platforms.totals.steady).toBe(0);
    expect(BLIND.platforms.platforms.every((p) => p.state === 'unknown')).toBe(true);
  });

  it('names each failed read in the drift answer, with the reason it was handed', () => {
    const text = answerTwinQuestion('twin-drift', BLIND)
      .sections.flatMap((s) => s.lines)
      .join('\n');
    for (const reason of ['engine read threw', 'supervisor read threw', 'domains read threw', 'trend report threw']) {
      expect(text, reason).toContain(reason);
    }
  });

  it('answers with declarations that stay deterministic', () => {
    for (const key of ETWIN_QUESTION_KEYS) {
      expect(answerTwinQuestion(key, BLIND), key).toEqual(answerTwinQuestion(key, BLIND));
    }
  });
});
