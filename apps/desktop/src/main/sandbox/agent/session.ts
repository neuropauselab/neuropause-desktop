/**
 * AI Sandbox — AI QA Agent (S4): the agent session loop.
 *
 * Ties the reusable pieces into one deterministic QA loop: recall known issues (memory) →
 * plan the goal → for each task, a pre-execution safety decision (approval gate) →
 * execute THROUGH the executor (S1/S2/S3) → observe → reflect → decide (retry/escalate/
 * abort) → on failure, file a bug report (JSON/MD/HTML) and store a learning in memory.
 * The AI reasons; the existing executors perform every action.
 */
import {
  parseQaGoal,
  type QaBugReport,
  type QaObservation,
  type QaReflection,
  type QaSessionResult,
} from '@neuropause/shared';
import type { QaMemory, QaExecutor, QaReasonerResult, Reasoner } from './ports';
import { getAgent, agentChecks } from './agents';
import { planGoal } from './planner';
import { observe } from './observation';
import { reflect } from './reflection';
import { decide } from './decision';
import { buildBugReport, bugReportToHtml, bugReportToJson, bugReportToMarkdown } from './bugReport';
import { QaPerfCollector } from './metrics';

// QaReasonerResult is imported for the reasoner narrative type used below.
type Narrative = QaReasonerResult;

export interface AgentSessionDeps {
  executor: QaExecutor;
  reasoner: Reasoner;
  memory: QaMemory;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  idPrefix?: string;
}

export interface BugReportExport {
  id: string;
  json: string;
  markdown: string;
  html: string;
}

export interface AgentSessionOutput {
  session: QaSessionResult;
  bugReports: BugReportExport[];
}

export async function runAgentSession(rawGoal: unknown, deps: AgentSessionDeps): Promise<AgentSessionOutput> {
  const perf = new QaPerfCollector();
  const t0 = deps.now();
  const goal = parseQaGoal(rawGoal);
  const agent = getAgent(goal.agent);
  const checks = agentChecks(goal.agent);
  const startedAt = new Date(t0).toISOString();
  const sessionId = `${deps.idPrefix ?? 'qa'}-${goal.id}-${t0}`;

  const knownIssues = await deps.memory.recallKnownIssues(goal.agent, goal.targets);

  const planned = await planGoal(goal, agent, checks, { reasoner: deps.reasoner, now: deps.now });
  perf.planningMs = planned.planningMs;
  perf.reasoningMs += planned.reasoningMs;
  perf.tasksPlanned = planned.plan.tasks.length;

  const byId = new Map(planned.plan.tasks.map((t) => [t.id, t]));
  const taskStatus = new Map<string, 'passed' | 'failed' | 'escalated' | 'skipped'>();
  const bugs: QaBugReport[] = [];
  const bugReports: BugReportExport[] = [];
  let learnings = 0;

  for (const taskId of planned.plan.order) {
    const task = byId.get(taskId);
    if (!task) continue;

    // Dependency gate.
    if (task.dependsOn.some((d) => taskStatus.get(d) !== 'passed')) {
      taskStatus.set(taskId, 'skipped');
      perf.tasksSkipped += 1;
      continue;
    }

    // Pre-execution SAFETY decision (destructive tasks require approval).
    const pre = decide({ task, attempt: 0, observation: null, reflection: null, agent, approvalGranted: false });
    if (pre.kind === 'approve') {
      taskStatus.set(taskId, 'skipped');
      perf.tasksSkipped += 1;
      continue;
    }

    // Execute through the existing executors, with policy-driven recovery.
    let attempt = 0;
    let observation: QaObservation | null = null;
    let reflection: QaReflection | null = null;
    let narrative: Narrative | null = null;
    for (;;) {
      attempt += 1;
      const oStart = deps.now();
      const result = await deps.executor.run({ id: task.id, name: task.name, spec: task.spec });
      observation = observe(task, result);
      perf.observationMs += deps.now() - oStart;

      const reflected = await reflect(task, observation, { reasoner: deps.reasoner, knownIssues, now: deps.now });
      reflection = reflected.reflection;
      narrative = reflected.narrative;
      perf.reasoningMs += reflected.reasoningMs;
      if (narrative.tokens > 0) {
        perf.llmCalls += 1;
        perf.llmTokens += narrative.tokens;
      }

      if (observation.outcome === 'pass') {
        taskStatus.set(taskId, 'passed');
        perf.tasksPassed += 1;
        break;
      }

      const decision = decide({ task, attempt, observation, reflection, agent, approvalGranted: true });
      if (decision.kind === 'retry') {
        perf.recoveries += 1;
        const rStart = deps.now();
        await deps.sleep(task.retry.backoffMs);
        perf.recoveryMs += deps.now() - rStart;
        continue;
      }
      taskStatus.set(taskId, decision.kind === 'escalate' ? 'escalated' : 'failed');
      perf.tasksFailed += 1;
      break;
    }

    perf.tasksExecuted += 1;

    // Failure → store a learning + file a bug report.
    if (observation && (observation.outcome === 'fail' || observation.outcome === 'error') && reflection && narrative) {
      const memId = await deps.memory.store({
        title: `${agent.name}: ${task.name} ${reflection.regressionDetected ? 'regression' : 'known-issue'}`,
        content: narrative.text,
        tags: [reflection.regressionDetected ? 'regression' : 'known-issue', goal.agent],
        metadata: { failureClass: reflection.failureClass, confidence: reflection.confidence, taskId: task.id },
      });
      if (memId) {
        learnings += 1;
        perf.learningsStored += 1;
      }
      const rStart = deps.now();
      const report = buildBugReport({ agent, goal, task, observation, reflection, narrative, memoryRefs: memId ? [memId] : [], createdAt: new Date(deps.now()).toISOString(), seq: bugs.length + 1 });
      perf.reportMs += deps.now() - rStart;
      bugs.push(report);
      perf.bugsFiled += 1;
      bugReports.push({ id: report.id, json: bugReportToJson(report), markdown: bugReportToMarkdown(report), html: bugReportToHtml(report) });
    }
  }

  perf.sessionMs = deps.now() - t0;
  const outcome: 'pass' | 'fail' | 'error' = perf.tasksExecuted === 0 ? 'error' : perf.tasksFailed > 0 ? 'fail' : 'pass';
  const session: QaSessionResult = {
    sessionId,
    agent: goal.agent,
    goalId: goal.id,
    goalText: goal.text,
    planned: planned.plan.tasks.length,
    executed: perf.tasksExecuted,
    passed: perf.tasksPassed,
    failed: perf.tasksFailed,
    skipped: perf.tasksSkipped,
    bugs,
    learnings,
    metrics: perf.metrics(),
    outcome,
    summary: `${agent.name}: ${perf.tasksPassed}/${perf.tasksExecuted} task(s) passed, ${bugs.length} bug(s) filed, ${learnings} learning(s) stored.`,
    startedAt,
  };
  return { session, bugReports };
}
