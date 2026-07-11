/** AI Sandbox S4 — unit tests (reasoner, planner, observation, decision, reflection, bug report, memory). */
import { describe, expect, it } from 'vitest';
import { parseQaGoal, type QaTask } from '@neuropause/shared';
import { DeterministicReasoner, LlmReasoner } from './reasoner';
import { planGoal } from './planner';
import { getAgent, agentChecks } from './agents';
import { observe } from './observation';
import { decide } from './decision';
import { reflect, classify } from './reflection';
import { buildBugReport, bugReportToHtml, bugReportToJson, bugReportToMarkdown, stepsFromSpec } from './bugReport';
import { FakeQaMemory, RealQaMemory } from './memory';
import type { QaRunResult } from './ports';

const now = (() => {
  let t = 1000;
  return () => (t += 5);
})();

function runResult(over: Partial<QaRunResult> = {}): QaRunResult {
  return { executionId: 'e1', status: 'passed', outcome: 'pass', assertions: { total: 2, passed: 2, failed: 0 }, metrics: { scenarioMs: 12 }, artifacts: [{ name: 'report.json', kind: 'report', ref: null }], timelinePhases: ['started', 'passed'], knowledgeGraphRefs: ['erp:rec_1'], error: null, ...over };
}
function task(id = 't1', name = 'CRM smoke'): QaTask {
  return { id, name, goalId: 'g', spec: { kind: 'enterprise', steps: [{ action: 'createCustomer', name: 'create' }] }, expectations: [{ description: 'created' }], dependsOn: [], priority: 'p1', destructive: false, retry: { maxAttempts: 2, backoffMs: 0 } };
}

describe('reasoner', () => {
  it('deterministic reasoner explains failures without a model', async () => {
    const r = new DeterministicReasoner();
    const obs = observe(task(), runResult({ outcome: 'fail', status: 'failed', assertions: { total: 2, passed: 1, failed: 1 } }));
    const reflected = await reflect(task(), obs, { reasoner: r, knownIssues: [], now });
    const res = await r.explainFailure(obs, reflected.reflection);
    expect(res.grounded).toBe(false);
    expect(res.tokens).toBe(0);
    expect(res.text).toMatch(/assertion/i);
  });

  it('LLM reasoner enriches when grounded, falls back otherwise', async () => {
    const det = new DeterministicReasoner();
    const grounded = new LlmReasoner(det, () => Promise.resolve({ text: 'Model says the credit field regressed.', confidence: 0.9, tokens: 42, grounded: true }));
    const offline = new LlmReasoner(det, () => Promise.resolve({ text: '', confidence: 0, tokens: 0, grounded: false }));
    const obs = observe(task(), runResult({ outcome: 'fail', status: 'failed' }));
    const reflected = await reflect(task(), obs, { reasoner: det, knownIssues: [], now });
    const enriched = await grounded.explainFailure(obs, reflected.reflection);
    expect(enriched.grounded).toBe(true);
    expect(enriched.tokens).toBe(42);
    expect(enriched.text).toMatch(/regressed/);
    const fell = await offline.explainFailure(obs, reflected.reflection);
    expect(fell.grounded).toBe(false);
  });
});

describe('planner', () => {
  it('decomposes a goal into a dependency-ordered plan', async () => {
    const goal = parseQaGoal({ text: 'regression suite', agent: 'regression' });
    const out = await planGoal(goal, getAgent('regression'), agentChecks('regression'), { reasoner: new DeterministicReasoner(), now });
    expect(out.plan.tasks.length).toBeGreaterThanOrEqual(3);
    expect(out.plan.order).toHaveLength(out.plan.tasks.length);
    expect(out.plan.tasks[0].retry.maxAttempts).toBe(2);
  });
});

describe('decision engine (deterministic policies + safety)', () => {
  const agent = getAgent('crm');
  it('gates destructive tasks behind approval', () => {
    const d = decide({ task: { ...task(), destructive: true }, attempt: 0, observation: null, reflection: null, agent, approvalGranted: false });
    expect(d.kind).toBe('approve');
  });
  it('proceeds on pass, retries transient, escalates permission, aborts hard failures', () => {
    const t = task();
    const passObs = observe(t, runResult());
    expect(decide({ task: t, attempt: 1, observation: passObs, reflection: null, agent, approvalGranted: true }).kind).toBe('proceed');
    const timeoutRefl = { taskId: t.id, matchedExpectations: 0, totalExpectations: 1, regressionDetected: true, failureClass: 'timeout' as const, confidence: 0.6, hypotheses: [], recommendations: [] };
    expect(decide({ task: t, attempt: 1, observation: observe(t, runResult({ outcome: 'error' })), reflection: timeoutRefl, agent, approvalGranted: true }).kind).toBe('retry');
    const permRefl = { ...timeoutRefl, failureClass: 'permission' as const };
    expect(decide({ task: t, attempt: 2, observation: observe(t, runResult({ outcome: 'error' })), reflection: permRefl, agent, approvalGranted: true }).kind).toBe('escalate');
    const assertRefl = { ...timeoutRefl, failureClass: 'assertion' as const };
    expect(decide({ task: t, attempt: 2, observation: observe(t, runResult({ outcome: 'fail' })), reflection: assertRefl, agent, approvalGranted: true }).kind).toBe('abort');
  });
});

describe('reflection engine', () => {
  it('classifies failures from the observation', () => {
    expect(classify(observe(task(), runResult()))).toBe('none');
    expect(classify(observe(task(), runResult({ outcome: 'fail', status: 'failed' })))).toBe('assertion');
    expect(classify(observe(task(), runResult({ outcome: 'error', status: 'error', error: 'missing permission crm:manage' })))).toBe('permission');
    expect(classify(observe(task(), runResult({ outcome: 'error', status: 'error', error: 'requires playwright' })))).toBe('environment');
  });

  it('flags a new failure as a regression, a known one as not', async () => {
    const obs = observe(task(), runResult({ outcome: 'fail', status: 'failed', assertions: { total: 2, passed: 1, failed: 1 } }));
    const fresh = await reflect(task(), obs, { reasoner: new DeterministicReasoner(), knownIssues: [], now });
    expect(fresh.reflection.regressionDetected).toBe(true);
    const known = await reflect(task('t1', 'CRM smoke'), obs, { reasoner: new DeterministicReasoner(), knownIssues: ['CRM smoke'], now });
    expect(known.reflection.regressionDetected).toBe(false);
    expect(fresh.reflection.hypotheses.length).toBeGreaterThan(0);
    expect(fresh.reflection.recommendations.length).toBeGreaterThan(0);
  });
});

describe('bug report system', () => {
  it('builds a report and exports JSON / Markdown / HTML', async () => {
    const t = task();
    const obs = observe(t, runResult({ outcome: 'fail', status: 'failed', assertions: { total: 2, passed: 1, failed: 1 } }));
    const reflected = await reflect(t, obs, { reasoner: new DeterministicReasoner(), knownIssues: [], now });
    const report = buildBugReport({ agent: getAgent('crm'), goal: parseQaGoal({ text: 'x', agent: 'crm' }), task: t, observation: obs, reflection: reflected.reflection, narrative: reflected.narrative, memoryRefs: ['mem-1'], createdAt: 'now', seq: 1 });
    expect(report.severity).toBeTruthy();
    expect(report.stepsToReproduce.length).toBeGreaterThan(0);
    expect(JSON.parse(bugReportToJson(report)).taskId).toBe(t.id);
    expect(bugReportToMarkdown(report)).toMatch(/Steps to reproduce/);
    expect(bugReportToHtml(report)).toContain('<html');
    expect(report.memoryRefs).toContain('mem-1');
  });

  it('derives steps from both enterprise and desktop specs', () => {
    expect(stepsFromSpec({ kind: 'enterprise', steps: [{ action: 'createCustomer', name: 'create' }] })[0]).toMatch(/create/);
    expect(stepsFromSpec({ kind: 'desktop', actions: [{ type: 'click', selector: '#x' }] })[0]).toMatch(/desktop: click/);
  });
});

describe('memory integration (reuse, never a new store)', () => {
  it('writes explicit qa notes and recalls known issues through the injected store', async () => {
    const writes: { tags: string[] }[] = [];
    const mem = new RealQaMemory({
      remember: (i) => { writes.push({ tags: i.tags }); return { id: `mem-${writes.length}` }; },
      recall: () => ({ hits: [{ item: { id: 'm1', title: 'CRM smoke regression', content: '...' } }] }),
    });
    const id = await mem.store({ title: 'x', content: 'y', tags: ['regression', 'crm'] });
    expect(id).toBe('mem-1');
    expect(writes[0].tags).toContain('qa'); // always tagged qa
    expect(await mem.recallKnownIssues('crm', [])).toEqual(['CRM smoke regression']);
    const fake = new FakeQaMemory(['known-x']);
    expect(await fake.recallKnownIssues()).toEqual(['known-x']);
  });
});
