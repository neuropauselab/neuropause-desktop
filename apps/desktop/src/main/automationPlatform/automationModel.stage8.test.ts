/**
 * Phase 6 Stage 8 — the automation model: the six question resolvers (disjoint
 * from the Stage 5/6/7 resolvers AND from the Stage 4/5 operational intent),
 * the STRUCTURAL Principle D lock (composeExplainability throws on an
 * incomplete envelope), the policies view, the dashboard, and the six answers
 * (read-only; the execute answer is a gated-flow pointer, never an execution).
 */
import { describe, expect, it } from 'vitest';
import type { AutomationCatalog, AutomationMonitorReport, AutomationPlan, PlaybookDefinition } from '@neuropause/shared';
import { resolveBriefRequest, resolveMeetingPrep, resolveWorkSummary } from '../assistant/assistantModel';
import { PLAYBOOK_REGISTRY, POLICY_DEFAULTS_REGISTRY } from './automationRegistry';
import { compilePlaybook } from './playbookComposer';
import { planRollback } from './rollbackPlanner';
import { resolvePolicy } from './policyResolver';
import { buildCatalog } from './automationCatalog';
import {
  answerAutomationQuestion,
  composeAutomationDashboard,
  composeExplainability,
  composePoliciesView,
  resolveAutomationQuestion,
  type AutomationQuestionContext,
} from './automationModel';

const NOW_ISO = '2026-07-15T09:00:00.000Z';
const NOW_MS = Date.parse(NOW_ISO);
const REAL_WORKERS = [{ id: 'worker:operations', skills: ['briefing', 'recommend', 'remind', 'note'] }];

function realPlan(pb: PlaybookDefinition): AutomationPlan {
  const compiled = compilePlaybook(pb, REAL_WORKERS);
  const rollback = planRollback(pb, []);
  const policy = resolvePolicy({ playbook: pb, trigger: pb.approvalTrigger, defaults: POLICY_DEFAULTS_REGISTRY[0], chains: [], autoAllowedTriggers: [], rollback, nowMs: NOW_MS });
  return {
    playbookId: pb.id,
    version: pb.version,
    name: pb.name,
    workflow: compiled.workflow,
    issues: compiled.issues,
    explainability: composeExplainability(pb, compiled, { policy }, 1),
    policy,
    approvals: { trigger: pb.approvalTrigger, governed: false, chainName: null, steps: [], autoExecutable: false, note: 'default' },
    simulation: {
      scenario: { kind: 'enterprise', category: 'automation', metadata: { title: 't' }, tags: [], preconditions: [], variables: {}, dataset: null, steps: [], assertions: [], expected: [], artifacts: [], cleanup: [], metrics: [], dependsOn: [], defaultChannel: 'automation', retry: { maxAttempts: 1 }, approval: { required: false }, timeoutMs: 1000 },
      scenarioKey: `ap-sim:${pb.id}@v${pb.version}`,
      lastRun: null,
      note: 'note',
    },
    knowledge: pb.knowledgeRefs.map((ref) => ({ ref, matched: true })),
  };
}

function emptyMonitor(): AutomationMonitorReport {
  return { generatedAt: NOW_ISO, findings: [], totals: { byKind: [], findings: 0 }, unavailable: [] };
}

function catalog(): AutomationCatalog {
  return buildCatalog({ nowMs: NOW_MS, rules: [], workflowRuns: [], playbooks: PLAYBOOK_REGISTRY, deliverySources: [], scheduledValidations: null, autoOpsPlans: null, assistantRows: [], failures: {} });
}

function ctx(over: Partial<AutomationQuestionContext> = {}): AutomationQuestionContext {
  return {
    catalog: catalog(),
    monitor: emptyMonitor(),
    playbooks: PLAYBOOK_REGISTRY,
    planFor: (id) => {
      const pb = PLAYBOOK_REGISTRY.find((p) => p.id === id);
      return pb ? realPlan(pb) : null;
    },
    policies: composePoliciesView(POLICY_DEFAULTS_REGISTRY, [], [], NOW_ISO),
    nowIso: NOW_ISO,
    ...over,
  };
}

describe('resolveAutomationQuestion — six keys, honest routing', () => {
  it('routes the six canonical phrasings', () => {
    expect(resolveAutomationQuestion('Build an automation that notifies me daily')).toBe('build-automation');
    expect(resolveAutomationQuestion('Explain the daily-ops-review playbook')).toBe('explain-automation');
    expect(resolveAutomationQuestion('Simulate the incident playbook')).toBe('simulate-automation');
    expect(resolveAutomationQuestion('Run the quarterly report playbook')).toBe('execute-automation');
    expect(resolveAutomationQuestion('What is the status of my automations?')).toBe('monitor-automation');
    expect(resolveAutomationQuestion('Why did my automation fail?')).toBe('debug-automation');
  });

  it('is DISJOINT from the Stage 4/5 operational intent — "launch the onboarding automation" stays with the gated flow', () => {
    expect(resolveAutomationQuestion('launch the onboarding automation')).toBeNull();
    expect(resolveAutomationQuestion('run the invoice automation')).toBeNull(); // rule execution ≠ playbook question
  });

  it('is DISJOINT from the Stage 5 productivity resolvers on their canonical phrasings', () => {
    for (const text of ['morning brief', "summarize today's work", 'prepare me for my next meeting']) {
      expect(resolveAutomationQuestion(text), text).toBeNull();
    }
    // And conversely: the automation phrasings do not trip the productivity resolvers.
    for (const text of ['Explain the daily-ops-review playbook', 'What is the status of my automations?']) {
      expect(resolveBriefRequest(text), text).toBeNull();
      expect(resolveWorkSummary(text), text).toBe(false);
      expect(resolveMeetingPrep(text), text).toBe(false);
    }
  });

  it('returns null for unrelated and empty text', () => {
    expect(resolveAutomationQuestion('')).toBeNull();
    expect(resolveAutomationQuestion('draft an email to the team')).toBeNull();
    expect(resolveAutomationQuestion('what is our deployment policy?')).toBeNull(); // Stage 7 territory
  });
});

describe('composeExplainability — Principle D is STRUCTURAL', () => {
  const pb = PLAYBOOK_REGISTRY[0];
  const compiled = compilePlaybook(pb, REAL_WORKERS);
  const policy = resolvePolicy({ playbook: pb, trigger: pb.approvalTrigger, defaults: POLICY_DEFAULTS_REGISTRY[0], chains: [], autoAllowedTriggers: [], rollback: planRollback(pb, []), nowMs: NOW_MS });

  it('a complete envelope carries all seven fields from real inputs', () => {
    const e = composeExplainability(pb, compiled, { policy }, 1);
    expect(e.why).toBe(pb.why);
    expect(e.evidence).toContain(`playbook:${pb.id}@v${pb.version}`);
    expect(e.evidence.some((x) => x.startsWith('step:'))).toBe(true);
    expect(e.triggeringConditions).toEqual(pb.triggeringConditions);
    expect(e.expectedOutcome).toBe(pb.expectedOutcome);
    expect(e.rollback.length).toBeGreaterThan(0);
    expect(e.confidence).toBeGreaterThan(0);
    expect(e.confidence).toBeLessThanOrEqual(1);
    expect(e.affectedSystems).toEqual(pb.affectedSystems);
  });

  it('an incomplete envelope THROWS — unexplainable plans are defects, not warnings', () => {
    const broken = { ...pb, why: '   ' };
    expect(() => composeExplainability(broken, compiled, { policy }, 1)).toThrow(/explainability incomplete/);
    const noConditions = { ...pb, triggeringConditions: [] };
    expect(() => composeExplainability(noConditions, compiled, { policy }, 1)).toThrow(/triggeringConditions/);
  });

  it('compile issues and missing knowledge reduce confidence — never below the floor', () => {
    const clean = composeExplainability(pb, compiled, { policy }, 1);
    const noKnowledge = composeExplainability(pb, compiled, { policy }, 0);
    expect(noKnowledge.confidence).toBeLessThan(clean.confidence);
    const withIssues = { ...compiled, issues: Array.from({ length: 10 }, (_, i) => ({ stepId: null, message: `m${i}` })) };
    expect(composeExplainability(pb, withIssues, { policy }, 1).confidence).toBe(0.1);
  });
});

describe('policies view + dashboard composition', () => {
  it('the policies view states the default-deny posture when no allows exist', () => {
    const v = composePoliciesView(POLICY_DEFAULTS_REGISTRY, [], [], NOW_ISO);
    expect(v.defaults).toHaveLength(3);
    expect(v.autoAllowedTriggers).toEqual([]);
    expect(v.note).toContain('nothing is auto-executable');
  });

  it('the dashboard composes catalog/playbook/schedule/monitor/policy summaries without invention', () => {
    const d = composeAutomationDashboard({ catalog: catalog(), monitor: emptyMonitor(), playbooks: PLAYBOOK_REGISTRY, policies: composePoliciesView(POLICY_DEFAULTS_REGISTRY, [], [], NOW_ISO), nowIso: NOW_ISO });
    expect(d.playbooks.count).toBe(4);
    expect(d.playbooks.categories.map((c) => c.category).sort()).toEqual(['incident-response', 'maintenance', 'operations', 'reporting']);
    expect(d.schedules).toEqual({ rules: 0, parseable: 0, unparseable: 0, nextDue: null });
    expect(d.monitor.findings).toBe(0);
    expect(d.disclosures.length).toBe(3);
  });
});

describe('the six answers — read-only, evidence-cited', () => {
  it("every answer rides the existing 'intelligence' report kind and is grounded", () => {
    for (const [key, text] of [
      ['build-automation', 'build an automation for slack messages'],
      ['explain-automation', 'explain the daily-ops-review playbook'],
      ['simulate-automation', 'simulate the daily-ops-review playbook'],
      ['execute-automation', 'run the daily-ops-review playbook'],
      ['monitor-automation', 'automation status'],
      ['debug-automation', 'debug my automation'],
    ] as const) {
      const r = answerAutomationQuestion(key, text, ctx());
      expect(r.kind, key).toBe('intelligence');
      expect(r.grounded, key).toBe(true);
      expect(r.sections.length, key).toBeGreaterThan(0);
    }
  });

  it('the build answer creates NOTHING and says so', () => {
    const r = answerAutomationQuestion('build-automation', 'build an automation to summarize slack messages', ctx());
    expect(r.title).toContain('nothing was created');
    expect(r.sections[0].lines.join(' ')).toContain('approval-gated');
  });

  it('the explain answer carries the full Principle D sections for a matched playbook', () => {
    const r = answerAutomationQuestion('explain-automation', 'explain the daily-ops-review playbook', ctx());
    const titles = r.sections.map((s) => s.title);
    for (const t of ['Why', 'Evidence', 'Triggering conditions', 'Expected outcome', 'Rollback', 'Confidence', 'Affected systems']) {
      expect(titles).toContain(t);
    }
  });

  it('the execute answer is a POINTER to the existing gated flow — it never starts anything', () => {
    const r = answerAutomationQuestion('execute-automation', 'run the daily-ops-review playbook', ctx());
    const text = r.sections.flatMap((s) => s.lines).join(' ');
    expect(text).toContain('Execution is NOT started from here');
    expect(text).toContain('parked approvals');
  });

  it('monitor + debug answer honestly on an empty monitor', () => {
    const m = answerAutomationQuestion('monitor-automation', 'automation status', ctx());
    expect(m.sections[0].lines[0]).toContain('No automation findings');
    const d = answerAutomationQuestion('debug-automation', 'debug my automation', ctx());
    expect(d.sections[0].lines[0]).toContain('nothing to debug');
  });
});
