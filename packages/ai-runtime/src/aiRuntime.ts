/**
 * AI Runtime composition root (NCEA 10.3, Phases 1 & 9).
 *
 * `createAiRuntime(enterpriseRuntime)` builds the governed AI layer ON the
 * Enterprise Runtime — providers, inference, agents, tools, connectors,
 * workflows, sessions, context, memory — all sharing the runtime's SINGLE event
 * bus, audit chain, and timeline through one GovernanceRecorder. This is the
 * `runtime.ai()/agents()/providers()/…` surface a host attaches. No duplicate
 * infrastructure; nothing bypasses governance.
 */
import type { EnterpriseRuntime } from '@neuropause/runtime';
import { systemClock, type Clock } from '@neuropause/cloud-core';
import { AI_RUNTIME_VERSION } from './constants';
import { ProviderRegistry } from './providers';
import { GovernanceRecorder } from './governance';
import { InferencePipeline } from './inference';
import { SessionManager } from './sessions';
import { ContextManager } from './context';
import { MemoryManager, InMemoryLongTermMemory, type LongTermMemory } from './memory';
import { AgentRuntime } from './agents';
import { ToolRuntime } from './tools';
import { ConnectorRuntime } from './connectors';
import { WorkflowEngine } from './workflows';

export interface AiRuntimeOptions {
  clock?: Clock;
  longTermMemory?: LongTermMemory;
}

export interface AiRuntime {
  version: string;
  ai(): InferencePipeline;
  providers(): ProviderRegistry;
  agents(): AgentRuntime;
  tools(): ToolRuntime;
  connectors(): ConnectorRuntime;
  workflows(): WorkflowEngine;
  sessions(): SessionManager;
  memory(): MemoryManager;
  context(): ContextManager;
  governance(): GovernanceRecorder;
}

export function createAiRuntime(runtime: EnterpriseRuntime, options: AiRuntimeOptions = {}): AiRuntime {
  const clock = options.clock ?? systemClock;
  const providers = new ProviderRegistry();
  const governance = new GovernanceRecorder(runtime, clock);
  const inference = new InferencePipeline(runtime, providers, governance);
  const agents = new AgentRuntime(runtime, governance);
  const tools = new ToolRuntime(runtime, governance);
  const connectors = new ConnectorRuntime(runtime, governance, clock);
  const workflows = new WorkflowEngine(runtime, governance);
  const sessions = new SessionManager(clock);
  const memory = new MemoryManager(options.longTermMemory ?? new InMemoryLongTermMemory(clock));
  const context = new ContextManager(runtime.context().mode);

  return {
    version: AI_RUNTIME_VERSION,
    ai: () => inference,
    providers: () => providers,
    agents: () => agents,
    tools: () => tools,
    connectors: () => connectors,
    workflows: () => workflows,
    sessions: () => sessions,
    memory: () => memory,
    context: () => context,
    governance: () => governance,
  };
}
