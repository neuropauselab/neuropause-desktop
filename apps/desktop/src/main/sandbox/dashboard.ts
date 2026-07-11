/**
 * AI Sandbox — Dashboard backend (S1). Reads the sandbox stores and rolls them up
 * into the {@link SandboxDashboard} snapshot via the shared pure composer. Read-only.
 */
import { composeSandboxDashboard, type SandboxDashboard } from '@neuropause/shared';
import type { SandboxWorkspaceStore } from './workspaceStore';
import type { SandboxScenarioStore } from './scenarioStore';
import type { SandboxExecutionStore } from './executionStore';
import type { SandboxArtifactStore } from './artifactStore';
import type { SandboxExecutionEngine } from './executionEngine';

export interface DashboardDeps {
  workspaces: SandboxWorkspaceStore;
  scenarios: SandboxScenarioStore;
  executions: SandboxExecutionStore;
  artifacts: SandboxArtifactStore;
  engine: SandboxExecutionEngine;
  now: () => number;
}

export function buildDashboard(deps: DashboardDeps, workspaceId?: string): SandboxDashboard {
  const executions = deps.executions.all().filter((e) => (workspaceId ? e.workspaceId === workspaceId : true));
  const artifacts = deps.artifacts
    .all()
    .filter((a) => (workspaceId ? a.workspaceId === workspaceId : true))
    .map((a) => ({ kind: a.kind }));
  const queue = deps.engine.queueState(workspaceId);
  return composeSandboxDashboard({
    workspaces: workspaceId ? (deps.workspaces.has(workspaceId) ? 1 : 0) : deps.workspaces.count(),
    scenarios: deps.scenarios.list({ workspaceId, includeArchived: true }).length,
    executions,
    queue: { depth: queue.depth, running: queue.running.length },
    artifacts,
    generatedAt: new Date(deps.now()).toISOString(),
  });
}
