/**
 * Phase 6 Stage 11 — the federation model: the ten question resolvers, the
 * SEVEN-WAY resolver disjointness (S5 brief/worksummary + S6 + S7 + S8 + S9 +
 * S10 + S11, both directions — including the two Stage 10 exclusions added
 * this stage), and the ten answers riding the existing 'intelligence' kind.
 */
import { describe, expect, it } from 'vitest';
import { EFED_QUESTION_KEYS } from '@neuropause/shared';
import { resolveInsightQuestion } from '../insight/insightModel';
import { resolveKnowledgeQuestion } from '../knowledgeAssets/knowledgeModel';
import { resolveAutomationQuestion } from '../automationPlatform/automationModel';
import { resolveOperationsQuestion } from '../operationsPlatform/operationsModel';
import { resolveStrategyQuestion } from '../strategyPlatform/strategyModel';
import { resolveBriefRequest, resolveWorkSummary } from '../assistant/assistantModel';
import { buildTrustReport } from './trustModel';
import { buildExchangeReport, buildPartnersReport } from './partnerExchange';
import { buildSharedAutomation } from './sharedAutomation';
import { buildSharedKnowledge } from './sharedKnowledge';
import { buildSharedOperations } from './sharedOperations';
import { buildSharedStrategy } from './sharedStrategy';
import { composeFederationBoardReport, composeFederationDashboard, type EfedDashboardInputs } from './federationDashboard';
import { answerFederationQuestion, resolveFederationQuestion, type FederationQuestionContext } from './federationModel';
import type { EfedSharingReport } from '@neuropause/shared';

const NOW = '2026-07-31T12:00:00.000Z';

const FED_CASES: [string, string][] = [
  ['Federation status, please', 'federation-status'],
  ['How is our federation?', 'federation-status'],
  ['Which partners do we trust?', 'partner-trust'],
  ['Show me the trust evidence', 'partner-trust'],
  ['What is in the exchange?', 'exchange-catalog'],
  ['Exchange catalog, please', 'exchange-catalog'],
  ['What knowledge do we share with partners?', 'shared-knowledge'],
  ['Show shared knowledge', 'shared-knowledge'],
  ['Which playbooks could we share?', 'shared-automation'],
  ['Show the workflow templates', 'shared-automation'],
  ['What are we exposing to partners?', 'partner-exposure'],
  ['Partner-facing exposure, please', 'partner-exposure'],
  ['Which joint initiatives do we run with partners?', 'joint-initiatives'],
  ['Show partner initiatives', 'joint-initiatives'],
  ['What is our federation governance state?', 'federation-governance'],
  ['Any delegated approvals pending?', 'federation-governance'],
  ['Intelligence network posture?', 'federation-network'],
  ['Prepare the federation report', 'federation-report'],
  ['Prepare the federation board brief', 'federation-report'],
];

describe('resolveFederationQuestion — the ten questions', () => {
  it('matches each phrasing to its key', () => {
    for (const [text, key] of FED_CASES) expect(resolveFederationQuestion(text), text).toBe(key);
  });

  it('every published question key is reachable', () => {
    const reached = new Set(FED_CASES.map(([, k]) => k));
    for (const k of EFED_QUESTION_KEYS) expect(reached.has(k), k).toBe(true);
  });

  it('returns null for non-federation asks', () => {
    for (const text of ['draft an email', 'Which objectives are at risk?', 'Show me the initiative portfolio', 'Prepare the board brief', '']) {
      expect(resolveFederationQuestion(text), text).toBeNull();
    }
  });
});

describe('SEVEN-WAY resolver disjointness (both directions)', () => {
  const OTHERS: [string, (t: string) => unknown][] = [
    ['S5-brief', (t) => resolveBriefRequest(t)],
    ['S5-worksummary', (t) => (resolveWorkSummary(t) ? 'ws' : null)],
    ['S6-insight', (t) => resolveInsightQuestion(t)],
    ['S7-knowledge', (t) => resolveKnowledgeQuestion(t)],
    ['S8-automation', (t) => resolveAutomationQuestion(t)],
    ['S9-operations', (t) => resolveOperationsQuestion(t)],
    ['S10-strategy', (t) => resolveStrategyQuestion(t)],
  ];

  it('every federation phrasing resolves through NO earlier stage', () => {
    for (const [text] of FED_CASES) {
      for (const [label, resolve] of OTHERS) {
        expect(resolve(text), `${label} must not match "${text}"`).toBeFalsy();
      }
    }
  });

  it('every earlier stage keeps its canonical questions — the federation resolver stays silent on them', () => {
    const CANONICAL = [
      'morning brief', // S5
      'Summarize the current enterprise health', // S6
      'What is our deployment policy?', // S7
      'What is the status of my automations?', // S8
      'Are we meeting our SLAs?', // S9
      'What are our operational objectives?', // S9 (the Stage 10 exclusion)
      'Which objectives are at risk?', // S10
      'Show me the initiative portfolio', // S10
      'Prepare the board brief', // S10
      'Which business capability is weakest?', // S10
    ];
    for (const text of CANONICAL) expect(resolveFederationQuestion(text), text).toBeNull();
  });

  it('the two Stage 10 exclusions route qualified phrasings HERE and nowhere else', () => {
    expect(resolveStrategyQuestion('Which joint initiatives do we run with partners?')).toBeNull();
    expect(resolveFederationQuestion('Which joint initiatives do we run with partners?')).toBe('joint-initiatives');
    expect(resolveStrategyQuestion('Prepare the federation board brief')).toBeNull();
    expect(resolveFederationQuestion('Prepare the federation board brief')).toBe('federation-report');
    // The unqualified forms stay with Stage 10, untouched.
    expect(resolveStrategyQuestion('Show me the initiative portfolio')).toBe('initiative-portfolio');
    expect(resolveStrategyQuestion('Prepare the board brief')).toBe('board-brief');
  });
});

/* ── answers over a small composed context ────────────────────────────────── */

function mkCtx(): FederationQuestionContext {
  const trust = buildTrustReport({
    nowIso: NOW,
    signals: { peers: [], trusts: [], invitations: [], artifacts: [], audit: [], policies: [] },
    failures: {},
  });
  const partners = buildPartnersReport({
    nowIso: NOW,
    records: { home: null, peers: [], invitations: [], shares: [], summary: null, artifacts: [] },
    trust,
    failures: {},
  });
  const exchange = buildExchangeReport({
    nowIso: NOW,
    artifacts: [],
    locals: { playbooks: [], knowledgeAssets: [], governancePolicies: [], connectors: [], workers: [] },
    failures: {},
  });
  const sharing: EfedSharingReport = {
    generatedAt: NOW,
    knowledge: buildSharedKnowledge({ artifacts: [], shares: [], knowledgeAssets: [], failures: {} }),
    automation: buildSharedAutomation({ artifacts: [], playbooks: [], apFindings: null, failures: {} }),
    operations: buildSharedOperations({ shares: [], s9Services: [], slaStatuses: [], readiness: null, capacityPressure: null, failures: {} }),
    strategy: buildSharedStrategy({ initiatives: [], capabilities: null, shares: [], artifacts: [], failures: {} }),
    unavailable: [],
  };
  const inputs: EfedDashboardInputs = { nowIso: NOW, partners, trust, exchange, sharing, governance: null, network: null, kpis: [] };
  return {
    partners,
    trust,
    exchange,
    sharing,
    dashboard: composeFederationDashboard(inputs),
    board: composeFederationBoardReport(inputs),
    nowIso: NOW,
  };
}

describe('answerFederationQuestion — evidence-cited, honest empty states', () => {
  it("every answer rides the existing 'intelligence' report kind, grounded, with sections", () => {
    const ctx = mkCtx();
    for (const key of EFED_QUESTION_KEYS) {
      const r = answerFederationQuestion(key, ctx);
      expect(r.kind, key).toBe('intelligence');
      expect(r.grounded, key).toBe(true);
      expect(r.sections.length, key).toBeGreaterThan(0);
    }
  });

  it('federation-status states the records-not-connectivity disclosure', () => {
    const r = answerFederationQuestion('federation-status', mkCtx());
    expect(r.title).toContain('records, not live connectivity');
  });

  it('partner-trust with no partners answers honestly', () => {
    const r = answerFederationQuestion('partner-trust', mkCtx());
    expect(r.sections.find((s) => s.title === 'Answer')!.lines[0]).toContain('No partner relationships');
  });

  it('joint-initiatives with an empty intersection states it, never pads', () => {
    const r = answerFederationQuestion('joint-initiatives', mkCtx());
    expect(r.sections.find((s) => s.title === 'Answer')!.lines[0]).toContain('stated honestly, not padded');
  });

  it('federation-governance and federation-network state unreadable slices', () => {
    expect(answerFederationQuestion('federation-governance', mkCtx()).sections[0].lines[0]).toContain('unreadable');
    expect(answerFederationQuestion('federation-network', mkCtx()).sections[0].lines[0]).toContain('unreadable');
  });

  it('federation-report returns the composed board report verbatim', () => {
    const ctx = mkCtx();
    const r = answerFederationQuestion('federation-report', ctx);
    expect(r.title).toBe(ctx.board.title);
    expect(r.sections.map((s) => s.title)).toEqual(ctx.board.sections.map((s) => s.title));
  });
});
