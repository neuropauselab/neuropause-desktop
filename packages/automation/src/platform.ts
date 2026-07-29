/**
 * Module 11 — Runtime APIs / composition root. `createAutomationPlatform(runtime, …)`
 * assembles the Wave 4 automation layer on the EXISTING platform: it reuses the one audit
 * chain + event bus (governance), NEMS (playbook actions), and the event bus (event
 * automation). It wires the workflow registry + runtime, automation engine, approval
 * platform, HITL gate, notifications, task orchestration, playbooks, SLA, analytics, and
 * dashboards, and exposes the runtime API the program named.
 */
import { systemClock, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import type { NemsPlatform } from '@neuropause/nems';
import { AUTOMATION_VERSION, type PlaybookId, type OpsRole } from './constants';
import { AUTOMATION_MATRIX, automationReadiness, type CapabilityEvidence, type AutomationReadiness } from './evidence';
import { AutomationGovernance } from './governance';
import { ApprovalPlatform } from './approvals';
import { HumanInTheLoopGate } from './hitl';
import { WorkflowRegistry, WorkflowRuntime, type RunOptions, type ValidationResult } from './workflow';
import { AutomationEngine } from './automation';
import { EventAutomation } from './events';
import { NotificationPlatform } from './notifications';
import { TaskOrchestration } from './tasks';
import { SlaOperations, type SlaConfig } from './sla';
import { AutomationAnalytics } from './analytics';
import { OperationsDashboards } from './dashboards';
import { buildPlaybooks } from './playbooks';
import type { WorkflowDefinition, WorkflowExecution } from './types';

export interface AutomationPlatformOptions {
  clock?: Clock;
  nems?: NemsPlatform;
  sla?: SlaConfig;
}

export interface WorkflowsApi {
  register(def: WorkflowDefinition): WorkflowDefinition;
  get(id: string, version?: number): WorkflowDefinition | undefined;
  list(): WorkflowDefinition[];
  validate(def: WorkflowDefinition): ValidationResult;
  run(def: WorkflowDefinition, opts: RunOptions): Promise<WorkflowExecution>;
  runById(id: string, opts: RunOptions): Promise<WorkflowExecution>;
  replay(executionId: string, approver?: RunOptions['approver']): Promise<WorkflowExecution>;
}

export interface PlaybooksApi {
  list(): PlaybookId[];
  get(id: PlaybookId): WorkflowDefinition | undefined;
  run(id: PlaybookId, opts: RunOptions): Promise<WorkflowExecution>;
}

export interface AutomationPlatform {
  version: string;
  workflows(): WorkflowsApi;
  automation(): AutomationEngine;
  scheduler(): AutomationEngine;
  approvals(): ApprovalPlatform;
  playbooks(): PlaybooksApi;
  notifications(): NotificationPlatform;
  tasks(): TaskOrchestration;
  analytics(): AutomationAnalytics;
  operations(): SlaOperations;
  executions(): WorkflowRuntime;
  events(): EventAutomation;
  hitl(): HumanInTheLoopGate;
  governance(): AutomationGovernance;
  dashboards(): OperationsDashboards;
  matrix(): CapabilityEvidence[];
  readiness(): AutomationReadiness;
}

export const DEFAULT_APPROVAL_POLICY = 'default-approval';

export function createAutomationPlatform(runtime: EnterpriseRuntime, options: AutomationPlatformOptions = {}): AutomationPlatform {
  const clock = options.clock ?? systemClock;
  const governance = new AutomationGovernance(runtime, clock);
  const approvals = new ApprovalPlatform(clock, governance);
  approvals.definePolicy({ id: DEFAULT_APPROVAL_POLICY, name: 'Default single-level', levels: [{ approvers: ['manager', 'lead', 'ciso', 'exec'], quorum: 1 }] });

  const hitl = new HumanInTheLoopGate();
  const registry = new WorkflowRegistry();
  const workflowRuntime = new WorkflowRuntime(registry, governance, approvals, clock);
  const automationEngine = new AutomationEngine(clock, workflowRuntime, registry);
  const events = new EventAutomation(runtime, automationEngine);
  const notifications = new NotificationPlatform(clock, governance);
  const tasks = new TaskOrchestration(clock, governance);
  const sla = new SlaOperations(workflowRuntime, automationEngine, approvals, options.sla ?? {});
  const analytics = new AutomationAnalytics(workflowRuntime, approvals);
  const dashboards = new OperationsDashboards(sla, analytics, approvals, automationEngine);

  // Register the ten built-in playbooks.
  const playbookDefs = buildPlaybooks({ notifications, policyId: DEFAULT_APPROVAL_POLICY, ...(options.nems ? { nems: options.nems } : {}) });
  for (const def of playbookDefs.values()) registry.register(def);

  const workflows: WorkflowsApi = {
    register: (def) => registry.register(def),
    get: (id, version) => registry.get(id, version),
    list: () => registry.list(),
    validate: (def) => registry.validate(def),
    run: (def, opts) => workflowRuntime.run(def, opts),
    runById: async (id, opts) => {
      const def = registry.get(id);
      if (!def) throw new Error(`unknown workflow '${id}'`);
      return workflowRuntime.run(def, opts);
    },
    replay: (execId, approver) => workflowRuntime.replay(execId, approver),
  };

  const playbooks: PlaybooksApi = {
    list: () => [...playbookDefs.keys()],
    get: (id) => playbookDefs.get(id),
    run: async (id, opts) => {
      const def = playbookDefs.get(id);
      if (!def) throw new Error(`unknown playbook '${id}'`);
      return workflowRuntime.run(def, opts);
    },
  };

  return {
    version: AUTOMATION_VERSION,
    workflows: () => workflows,
    automation: () => automationEngine,
    scheduler: () => automationEngine,
    approvals: () => approvals,
    playbooks: () => playbooks,
    notifications: () => notifications,
    tasks: () => tasks,
    analytics: () => analytics,
    operations: () => sla,
    executions: () => workflowRuntime,
    events: () => events,
    hitl: () => hitl,
    governance: () => governance,
    dashboards: () => dashboards,
    matrix: () => AUTOMATION_MATRIX,
    readiness: () => automationReadiness(),
  };
}

export type { OpsRole };
