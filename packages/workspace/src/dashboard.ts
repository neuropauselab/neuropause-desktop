/**
 * Executive Dashboard (NCEA 10.5, Phase 8). READ-ONLY projections over the live
 * subsystems and the one governed activity stream — it stores nothing and mutates
 * nothing. Organization / team / project / workforce / connector / automation
 * health, the approval queue, cost + usage analytics, governance + audit
 * overviews, and enterprise KPIs are all computed on demand from the same data
 * the rest of the platform already recorded. Numbers here can never diverge from
 * the audit chain because they are derived from it.
 */
import type { EnterpriseRuntime } from '@neuropause/runtime';
import type { WorkspaceGovernance, WorkspaceDomain } from './governance';
import type { OrganizationRegistry, OrgNodeType } from './organization';
import type { WorkspaceRegistry } from './workspaceRegistry';
import type { ProjectRegistry } from './project';
import type { IdentityDirectory } from './identity';
import type { DigitalWorkforce } from './workforce';
import type { TaskBoard, Task } from './tasks';
import type { UniversalInbox } from './inbox';
import type { KnowledgeGraph } from './knowledge';

export interface DashboardDeps {
  runtime: EnterpriseRuntime;
  governance: WorkspaceGovernance;
  organizations: OrganizationRegistry;
  workspaces: WorkspaceRegistry;
  projects: ProjectRegistry;
  identity: IdentityDirectory;
  workforce: DigitalWorkforce;
  tasks: TaskBoard;
  inbox: UniversalInbox;
  knowledge: KnowledgeGraph;
  /** Optional — present when a connector platform is wired to the same runtime. */
  connectorHealth?: () => Array<{ id: string; health: { status: string } }>;
}

export interface HealthBreakdown {
  total: number;
  done: number;
  blocked: number;
  openRatio: number;
}

export class ExecutiveDashboard {
  constructor(private readonly deps: DashboardDeps) {}

  organizationOverview(): {
    nodesByType: Record<string, number>;
    workspaces: number;
    projects: number;
    principalsByType: Record<string, number>;
  } {
    const nodesByType: Record<string, number> = {};
    for (const node of this.deps.organizations.list()) nodesByType[node.type] = (nodesByType[node.type] ?? 0) + 1;
    const principalsByType: Record<string, number> = {};
    for (const p of this.deps.identity.listPrincipals()) principalsByType[p.type] = (principalsByType[p.type] ?? 0) + 1;
    return {
      nodesByType,
      workspaces: this.deps.workspaces.list().length,
      projects: this.deps.projects.list().length,
      principalsByType,
    };
  }

  private healthOf(tasks: Task[]): HealthBreakdown {
    const total = tasks.length;
    const done = tasks.filter((t) => t.status === 'done').length;
    const blocked = tasks.filter((t) => t.status === 'blocked').length;
    return { total, done, blocked, openRatio: total ? (total - done) / total : 0 };
  }

  teamHealth(orgNodeType: OrgNodeType = 'team'): Array<{ id: string; name: string; members: number }> {
    return this.deps.organizations.list(orgNodeType).map((node) => ({
      id: node.id,
      name: node.name,
      members: this.deps.identity.members('team', node.id).length,
    }));
  }

  projectHealth(projectId: string): HealthBreakdown {
    return this.healthOf(this.deps.tasks.list({ projectId }));
  }

  workspaceHealth(workspaceId: string): HealthBreakdown {
    return this.healthOf(this.deps.tasks.list({ workspaceId }));
  }

  workforceHealth(): { employees: number; runs: number; failures: number; costUsd: number } {
    const employees = this.deps.workforce.list();
    let runs = 0;
    let failures = 0;
    for (const e of employees) {
      const perf = this.deps.workforce.performance(e.id);
      runs += perf.runs;
      failures += perf.failures;
    }
    return { employees: employees.length, runs, failures, costUsd: this.deps.workforce.totalCost() };
  }

  connectorHealth(): Array<{ id: string; status: string }> {
    if (!this.deps.connectorHealth) return [];
    return this.deps.connectorHealth().map((h) => ({ id: h.id, status: h.health.status }));
  }

  automationHealth(): { taskAutomationRecords: number; scheduledJobs: number } {
    return {
      taskAutomationRecords: this.deps.governance.history().filter((r) => r.action.startsWith('automation.')).length,
      scheduledJobs: this.deps.runtime.scheduler().names().length,
    };
  }

  approvalQueue(): { tasks: number; workforce: number; total: number } {
    const taskApprovals = this.deps.tasks.list().filter((t) => t.approval === 'pending').length;
    const workforceApprovals = this.deps.workforce.pendingApprovals().length;
    return { tasks: taskApprovals, workforce: workforceApprovals, total: taskApprovals + workforceApprovals };
  }

  costAnalytics(): { workforceUsd: number; recordedUsd: number } {
    const recordedUsd = this.deps.governance
      .history()
      .reduce((sum, r) => sum + (r.cost?.usd ?? 0), 0);
    return { workforceUsd: this.deps.workforce.totalCost(), recordedUsd };
  }

  usageAnalytics(): Record<string, number> {
    const byDomain: Record<string, number> = {};
    for (const record of this.deps.governance.history()) byDomain[record.domain] = (byDomain[record.domain] ?? 0) + 1;
    return byDomain;
  }

  governanceOverview(): { records: number; ok: number; error: number } {
    const history = this.deps.governance.history();
    const ok = history.filter((r) => r.ok).length;
    return { records: history.length, ok, error: history.length - ok };
  }

  auditOverview(): { valid: boolean; workspaceRecords: number } {
    return {
      valid: this.deps.runtime.audit().verify().valid,
      workspaceRecords: this.deps.governance.history().length,
    };
  }

  domainActivity(domain: WorkspaceDomain): number {
    return this.deps.governance.byDomain(domain).length;
  }

  /** Enterprise KPI rollup — one call for a top-level view. */
  kpis(): Record<string, number> {
    const org = this.organizationOverview();
    const workforce = this.workforceHealth();
    return {
      organizations: org.nodesByType['organization'] ?? 0,
      workspaces: org.workspaces,
      projects: org.projects,
      principals: this.deps.identity.listPrincipals().length,
      aiEmployees: workforce.employees,
      openTasks: this.deps.tasks.list().filter((t) => t.status !== 'done' && t.status !== 'cancelled').length,
      pendingApprovals: this.approvalQueue().total,
      knowledgeNodes: this.deps.knowledge.list().length,
      inboxItems: this.deps.inbox.all().length,
      governedActions: this.deps.governance.history().length,
      workforceCostUsd: workforce.costUsd,
    };
  }
}
