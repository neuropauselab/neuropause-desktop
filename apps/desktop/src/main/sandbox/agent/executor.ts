/**
 * AI Sandbox — AI QA Agent (S4): the executor interface.
 *
 * The agent submits a scenario to the EXISTING S1 engine and reads the outcome — it never
 * runs anything itself. The backend is a small set of injected operations over S1 (a
 * scenario create + version, an enqueue, and reads of execution/result/artifacts/timeline);
 * production wires them through the sandbox IPC channels (same secure core → same RBAC),
 * tests wire them to the raw S1 stores + a real engine running the S3 executor. No new
 * execution engine, queue, or store.
 */
import type { QaExecutor, QaExecutorTask, QaRunResult } from './ports';
import type { ScenarioSpec } from '@neuropause/shared';

export interface QaExecutorBackend {
  ensureWorkspace(): Promise<string>;
  createScenario(workspaceId: string, key: string, name: string): Promise<string>;
  createVersion(scenarioId: string, spec: ScenarioSpec): Promise<void>;
  enqueue(scenarioId: string): Promise<string>;
  getExecution(executionId: string): Promise<{ status: string; error: string | null } | null>;
  getResult(executionId: string): Promise<{ outcome: 'pass' | 'fail' | 'error' | null; assertions: { total: number; passed: number; failed: number }; metrics: Record<string, number> } | null>;
  listArtifacts(executionId: string): Promise<{ name: string; kind: string; ref: string | null }[]>;
  getTimeline(executionId: string): Promise<string[]>;
  isTerminal(status: string): boolean;
}

export interface QaExecutorOptions {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** Wall-clock budget to wait for a run to reach a terminal status. */
  budgetMs?: number;
  pollMs?: number;
}

export function createQaExecutor(backend: QaExecutorBackend, opts: QaExecutorOptions): QaExecutor {
  const budgetMs = opts.budgetMs ?? 30_000;
  const pollMs = opts.pollMs ?? 5;
  let seq = 0;

  return {
    kind: 's1-engine',
    async run(task: QaExecutorTask): Promise<QaRunResult> {
      try {
        seq += 1;
        const workspaceId = await backend.ensureWorkspace();
        const scenarioId = await backend.createScenario(workspaceId, `qa-${task.id}-${seq}`, task.name);
        await backend.createVersion(scenarioId, task.spec);
        const executionId = await backend.enqueue(scenarioId);

        const deadline = opts.now() + budgetMs;
        let status = 'queued';
        let error: string | null = null;
        while (opts.now() < deadline) {
          const exec = await backend.getExecution(executionId);
          if (exec) {
            status = exec.status;
            error = exec.error;
            if (backend.isTerminal(status)) break;
          }
          await opts.sleep(pollMs);
        }

        const result = await backend.getResult(executionId);
        const artifacts = await backend.listArtifacts(executionId);
        const timelinePhases = await backend.getTimeline(executionId);
        return {
          executionId,
          status,
          outcome: result?.outcome ?? (backend.isTerminal(status) ? statusOutcome(status) : null),
          assertions: result?.assertions ?? { total: 0, passed: 0, failed: 0 },
          metrics: result?.metrics ?? {},
          artifacts,
          timelinePhases,
          knowledgeGraphRefs: [],
          error,
        };
      } catch (err) {
        return {
          executionId: null,
          status: 'error',
          outcome: 'error',
          assertions: { total: 0, passed: 0, failed: 0 },
          metrics: {},
          artifacts: [],
          timelinePhases: [],
          knowledgeGraphRefs: [],
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}

function statusOutcome(status: string): 'pass' | 'fail' | 'error' | null {
  if (status === 'passed') return 'pass';
  if (status === 'failed') return 'fail';
  if (status === 'error' || status === 'timed_out' || status === 'cancelled') return 'error';
  return null;
}
