/**
 * Workforce composition root. `createWorkforcePlatform(runtime, …)` assembles the Wave 11 governed
 * AI workforce on the EXISTING platform: it reuses the one runtime audit chain + event bus
 * (workforce governance), the Wave 4 HITL gate (human collaboration, workflow gating), and — when
 * provided — the Wave 8 business platform (tools, reasoning evidence, executive briefings), the
 * Wave 9 industry platform (specialists), the Wave 10 workplace (workspace context), and the Wave 5
 * execution platform (reused connector count). AI operates THROUGH governance; it never replaces
 * it. Exposes the workforce API surface, the evidence matrix, and readiness.
 */
import { systemClock, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import { HumanInTheLoopGate } from '@neuropause/automation';
import type { ExecutionPlatform } from '@neuropause/execution';
import type { BusinessPlatform, IndustryPlatform, WorkplacePlatform, WorkforceContext } from './types';
import { WORKFORCE_VERSION } from './constants';
import { WORKFORCE_MATRIX, workforceReadiness, type CapabilityEvidence, type WorkforceReadiness } from './evidence';
import { WorkforceGovernance } from './governance';
import { AiProviderRegistry } from './adapters';
import { AgentRegistry } from './registry';
import { allWorkerTemplates, type WorkerTemplate } from './workers';
import { AgentMemory } from './memory';
import { CollaborationHub } from './collaboration';
import { PlanningEngine } from './planning';
import { ReasoningEngine } from './reasoning';
import { ToolRuntime } from './tools';
import { HumanCollaboration } from './humanCollab';
import { AiOrganization } from './organization';
import { AutonomousWorkflows } from './workflows';
import { ExecutiveAI } from './executive';
import { WorkerMarketplace } from './marketplace';
import { WorkerSDK } from './sdk';

export interface WorkforcePlatformOptions {
  clock?: Clock;
  business?: BusinessPlatform;
  industry?: IndustryPlatform;
  workplace?: WorkplacePlatform;
  execution?: ExecutionPlatform;
}

export interface WorkforcePlatform {
  version: string;
  agents(): AgentRegistry;
  workers(): WorkerTemplate[];
  memory(): AgentMemory;
  collaboration(): CollaborationHub;
  planning(): PlanningEngine;
  reasoning(): ReasoningEngine;
  tools(): ToolRuntime;
  humans(): HumanCollaboration;
  organization(): AiOrganization;
  workflows(): AutonomousWorkflows;
  executive(): ExecutiveAI;
  marketplace(): WorkerMarketplace;
  sdk(): WorkerSDK;
  adapters(): AiProviderRegistry;
  governance(): WorkforceGovernance;
  reusedConnectorCount(): number;
  matrix(): CapabilityEvidence[];
  readiness(): WorkforceReadiness;
}

export function createWorkforcePlatform(runtime: EnterpriseRuntime, options: WorkforcePlatformOptions = {}): WorkforcePlatform {
  const clock = options.clock ?? systemClock;
  const ctx: WorkforceContext = {
    ...(options.business ? { business: options.business } : {}),
    ...(options.industry ? { industry: options.industry } : {}),
    ...(options.workplace ? { workplace: options.workplace } : {}),
  };
  const governance = new WorkforceGovernance(runtime, clock);
  const hitl = new HumanInTheLoopGate();

  const adapters = new AiProviderRegistry(governance);
  const registry = new AgentRegistry(clock, governance);
  const memory = new AgentMemory(clock, governance);
  const collaboration = new CollaborationHub(clock, governance);
  const planning = new PlanningEngine(clock, governance);
  const reasoning = new ReasoningEngine(governance, ctx);
  const tools = new ToolRuntime(governance, ctx);
  const humans = new HumanCollaboration(clock, governance, hitl);
  const organization = new AiOrganization(governance, registry);
  const workflows = new AutonomousWorkflows(clock, governance, hitl);
  const executive = new ExecutiveAI(ctx);
  const marketplace = new WorkerMarketplace(clock, governance);
  const sdk = new WorkerSDK(clock, governance);

  return {
    version: WORKFORCE_VERSION,
    agents: () => registry,
    workers: () => allWorkerTemplates(),
    memory: () => memory,
    collaboration: () => collaboration,
    planning: () => planning,
    reasoning: () => reasoning,
    tools: () => tools,
    humans: () => humans,
    organization: () => organization,
    workflows: () => workflows,
    executive: () => executive,
    marketplace: () => marketplace,
    sdk: () => sdk,
    adapters: () => adapters,
    governance: () => governance,
    reusedConnectorCount: () => options.execution?.connectors().count() ?? 0,
    matrix: () => WORKFORCE_MATRIX,
    readiness: () => workforceReadiness(),
  };
}
