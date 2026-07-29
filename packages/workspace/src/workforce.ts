/**
 * Digital Workforce (NCEA 10.5, Phase 3). AI employees are PRINCIPALS (type
 * 'ai-employee') in the one identity model — they are hired, assigned, owned,
 * supervised, scheduled, and cost-tracked exactly like staff, and they operate in
 * the same governed workspace as humans. Their actual work executes through the
 * Enterprise AI Runtime's agent layer (already governed there); the workforce
 * adds employment semantics: ownership, supervision, human approval gates,
 * performance metrics, and cost accounting. Every dispatch is governed here too.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import type { AiRuntime } from '@neuropause/ai-runtime';
import type { WorkspaceGovernance } from './governance';
import type { IdentityDirectory } from './identity';

export const AI_EMPLOYEE_ROLES = [
  'manager',
  'analyst',
  'researcher',
  'developer',
  'operator',
  'coordinator',
  'assistant',
] as const;
export type AiEmployeeRole = (typeof AI_EMPLOYEE_ROLES)[number];

export interface AiEmployee {
  id: string; // == principal id
  role: AiEmployeeRole;
  displayName: string;
  agentName: string;
  ownerPrincipalId: string;
  supervisorPrincipalId?: string;
  workspaceId?: string;
  requiresApproval: boolean;
  costPerRunUsd: number;
  active: boolean;
  createdAt: number;
}

export interface AgentPerformance {
  runs: number;
  failures: number;
  totalDurationMs: number;
  avgDurationMs: number;
  costUsd: number;
}

export interface WorkforceApprovalRequest {
  id: string;
  employeeId: string;
  input: unknown;
  requestedBy: string;
  status: 'pending' | 'approved' | 'rejected';
  decidedBy?: string;
  at: number;
}

/** Adapter seam to the execution layer — defaults to a deterministic run so the
 *  workforce is testable without a live AI runtime; the platform wires the real
 *  AI-runtime agent executor when an AiRuntime is provided. */
export interface WorkforceExecutor {
  execute(agentName: string, input: unknown, actor: string): Promise<{ output: unknown; costUsd?: number }>;
}

export function aiRuntimeExecutor(ai: AiRuntime): WorkforceExecutor {
  return {
    async execute(agentName, input, actor) {
      const output = await ai.agents().execute(agentName, input, actor);
      return { output };
    },
  };
}

export interface HireInput {
  role: AiEmployeeRole;
  displayName: string;
  agentName: string;
  ownerPrincipalId: string;
  workspaceId?: string;
  supervisorPrincipalId?: string;
  requiresApproval?: boolean;
  costPerRunUsd?: number;
  actor?: string;
}

export class DigitalWorkforce {
  private readonly employees = new Map<string, AiEmployee>();
  private readonly perf = new Map<string, AgentPerformance>();
  private readonly approvals = new Map<string, WorkforceApprovalRequest>();

  constructor(
    private readonly runtime: EnterpriseRuntime,
    private readonly identity: IdentityDirectory,
    private readonly governance: WorkspaceGovernance,
    private readonly clock: Clock,
    private readonly executor?: WorkforceExecutor,
  ) {}

  async hire(input: HireInput): Promise<AiEmployee> {
    // An AI employee IS a principal — no separate user model.
    const principal = await this.identity.registerPrincipal({
      type: 'ai-employee',
      displayName: input.displayName,
      metadata: { role: input.role, agentName: input.agentName },
      actor: input.actor ?? input.ownerPrincipalId,
    });
    const employee: AiEmployee = {
      id: principal.id,
      role: input.role,
      displayName: input.displayName,
      agentName: input.agentName,
      ownerPrincipalId: input.ownerPrincipalId,
      ...(input.supervisorPrincipalId ? { supervisorPrincipalId: input.supervisorPrincipalId } : {}),
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      requiresApproval: input.requiresApproval ?? false,
      costPerRunUsd: input.costPerRunUsd ?? 0,
      active: true,
      createdAt: this.clock.now(),
    };
    this.employees.set(employee.id, employee);
    this.perf.set(employee.id, { runs: 0, failures: 0, totalDurationMs: 0, avgDurationMs: 0, costUsd: 0 });
    if (input.workspaceId) {
      await this.identity.addMembership(principal.id, 'workspace', input.workspaceId, [], input.actor ?? input.ownerPrincipalId);
    }
    await this.governance.record({
      domain: 'workforce',
      action: `hire.${input.role}`,
      entity: employee.id,
      actor: input.actor ?? input.ownerPrincipalId,
      ...(input.workspaceId ? { workspace: input.workspaceId } : {}),
      approval: 'not-required',
      ok: true,
      meta: { agentName: employee.agentName, ownerPrincipalId: employee.ownerPrincipalId },
    });
    return employee;
  }

  get(id: string): AiEmployee | undefined {
    return this.employees.get(id);
  }

  list(role?: AiEmployeeRole): AiEmployee[] {
    const all = [...this.employees.values()];
    return role ? all.filter((e) => e.role === role) : all;
  }

  async assign(employeeId: string, workspaceId: string, actor = 'system'): Promise<AiEmployee> {
    const employee = this.require(employeeId);
    employee.workspaceId = workspaceId;
    await this.identity.addMembership(employeeId, 'workspace', workspaceId, [], actor);
    await this.governance.record({
      domain: 'workforce',
      action: 'assign',
      entity: employeeId,
      actor,
      workspace: workspaceId,
      approval: 'not-required',
      ok: true,
    });
    return employee;
  }

  async setSupervisor(employeeId: string, supervisorPrincipalId: string, actor = 'system'): Promise<AiEmployee> {
    const employee = this.require(employeeId);
    employee.supervisorPrincipalId = supervisorPrincipalId;
    await this.governance.record({
      domain: 'workforce',
      action: 'supervise.set',
      entity: employeeId,
      actor,
      approval: 'not-required',
      ok: true,
      meta: { supervisorPrincipalId },
    });
    return employee;
  }

  /** Request human approval for a dispatch; returns a pending request. */
  async requestApproval(employeeId: string, input: unknown, requestedBy: string): Promise<WorkforceApprovalRequest> {
    this.require(employeeId);
    const request: WorkforceApprovalRequest = {
      id: randomId('wapr'),
      employeeId,
      input,
      requestedBy,
      status: 'pending',
      at: this.clock.now(),
    };
    this.approvals.set(request.id, request);
    await this.governance.record({
      domain: 'workforce',
      action: 'approval.request',
      entity: employeeId,
      actor: requestedBy,
      approval: 'pending',
      ok: true,
      meta: { requestId: request.id },
    });
    return request;
  }

  async decideApproval(requestId: string, approve: boolean, decidedBy: string): Promise<WorkforceApprovalRequest> {
    const request = this.approvals.get(requestId);
    if (!request) throw new Error(`approval '${requestId}' not found`);
    request.status = approve ? 'approved' : 'rejected';
    request.decidedBy = decidedBy;
    await this.governance.record({
      domain: 'workforce',
      action: 'approval.decide',
      entity: request.employeeId,
      actor: decidedBy,
      approval: approve ? 'approved' : 'rejected',
      ok: true,
      meta: { requestId },
    });
    return request;
  }

  /**
   * Dispatch work to an AI employee. If the employee requires approval, a valid
   * approved request id must be supplied — otherwise the dispatch is denied and
   * recorded as such (the human-in-the-loop gate). Execution runs through the
   * wired executor (the AI runtime's governed agents when present).
   */
  async dispatch(
    employeeId: string,
    input: unknown,
    options: { approvedRequestId?: string; actor?: string } = {},
  ): Promise<{ output: unknown; approvalRequired: boolean }> {
    const employee = this.require(employeeId);
    const actor = options.actor ?? employee.ownerPrincipalId;
    if (!employee.active) throw new Error(`AI employee '${employeeId}' is not active`);

    if (employee.requiresApproval) {
      const request = options.approvedRequestId ? this.approvals.get(options.approvedRequestId) : undefined;
      const approved = request?.employeeId === employeeId && request?.status === 'approved';
      if (!approved) {
        await this.governance.record({
          domain: 'workforce',
          action: 'dispatch.denied',
          entity: employeeId,
          actor,
          ...(employee.workspaceId ? { workspace: employee.workspaceId } : {}),
          approval: 'pending',
          ok: false,
          detail: 'human approval required',
        });
        return { output: undefined, approvalRequired: true };
      }
    }

    const timer = this.runtime.observability().startTimer(`workforce.${employee.role}`);
    const perf = this.perf.get(employeeId)!;
    try {
      const result = this.executor
        ? await this.executor.execute(employee.agentName, input, employeeId)
        : { output: { employeeId, agentName: employee.agentName, echoed: input }, costUsd: undefined };
      const durationMs = timer.end();
      const cost = result.costUsd ?? employee.costPerRunUsd;
      perf.runs += 1;
      perf.totalDurationMs += durationMs;
      perf.avgDurationMs = perf.totalDurationMs / perf.runs;
      perf.costUsd += cost;
      await this.governance.record({
        domain: 'workforce',
        action: 'dispatch',
        entity: employeeId,
        actor,
        ...(employee.workspaceId ? { workspace: employee.workspaceId } : {}),
        approval: employee.requiresApproval ? 'approved' : 'not-required',
        ok: true,
        cost: { usd: cost },
        meta: { agentName: employee.agentName, durationMs },
      });
      return { output: result.output, approvalRequired: false };
    } catch (error) {
      timer.end();
      perf.runs += 1;
      perf.failures += 1;
      await this.governance.record({
        domain: 'workforce',
        action: 'dispatch',
        entity: employeeId,
        actor,
        ...(employee.workspaceId ? { workspace: employee.workspaceId } : {}),
        approval: employee.requiresApproval ? 'approved' : 'not-required',
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  /** Register a recurring dispatch on the SHARED scheduler (no new scheduler). */
  schedule(employeeId: string, intervalMs: number, input: unknown): void {
    this.require(employeeId);
    this.runtime.scheduler().register({
      name: `workforce:${employeeId}`,
      intervalMs,
      handler: async () => {
        await this.dispatch(employeeId, input);
      },
    });
  }

  performance(employeeId: string): AgentPerformance {
    return this.perf.get(employeeId) ?? { runs: 0, failures: 0, totalDurationMs: 0, avgDurationMs: 0, costUsd: 0 };
  }

  /** Supervision view: the employee, its performance, and its governed history. */
  supervise(employeeId: string): { employee: AiEmployee; performance: AgentPerformance; activity: number } {
    const employee = this.require(employeeId);
    return {
      employee,
      performance: this.performance(employeeId),
      activity: this.governance.byEntity(employeeId).length,
    };
  }

  totalCost(): number {
    return [...this.perf.values()].reduce((sum, p) => sum + p.costUsd, 0);
  }

  pendingApprovals(): WorkforceApprovalRequest[] {
    return [...this.approvals.values()].filter((a) => a.status === 'pending');
  }

  private require(id: string): AiEmployee {
    const employee = this.employees.get(id);
    if (!employee) throw new Error(`AI employee '${id}' not found`);
    return employee;
  }
}
