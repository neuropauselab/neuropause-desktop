/**
 * AI Sandbox — AI QA Agent (S4) composition root.
 *
 * Builds the QA agent runtime from injected REUSED capabilities: a {@link QaExecutorBackend}
 * over the S1 engine (production wires it through the sandbox IPC channels → same secure
 * core → same RBAC), the existing memory store, and an optional model-backed reasoner
 * (deterministic otherwise). It adds no engine, automation, memory, graph, or timeline —
 * it only orchestrates reasoning over the existing executors.
 */
import { createLogger } from '../../logger';
import type { QaAgentDefinition } from '@neuropause/shared';
import type { QaReasonerResult, Reasoner } from './ports';
import { DeterministicReasoner, LlmReasoner } from './reasoner';
import { RealQaMemory, type MemoryBackend } from './memory';
import { createQaExecutor, type QaExecutorBackend } from './executor';
import { runAgentSession, type AgentSessionOutput } from './session';
import { QA_AGENTS } from './agents';

const log = createLogger('sandbox-ai-qa');

export interface AiQaDeps {
  /** How the agent runs scenarios — backed by the S1 engine (reused, never rebuilt). */
  executorBackend: QaExecutorBackend;
  /** The existing memory store, injected as closures. */
  memory: MemoryBackend;
  /** Optional model call (reuses the AI engine) for narrative enrichment; deterministic without it. */
  generate?: (prompt: string) => Promise<QaReasonerResult>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface AiQaSubsystem {
  runSession: (goal: unknown) => Promise<AgentSessionOutput>;
  agents: QaAgentDefinition[];
  reasonerKind: string;
}

export function initAiQa(deps: AiQaDeps): AiQaSubsystem {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deterministic = new DeterministicReasoner();
  const reasoner: Reasoner = deps.generate ? new LlmReasoner(deterministic, deps.generate) : deterministic;
  const memory = new RealQaMemory(deps.memory);
  const executor = createQaExecutor(deps.executorBackend, { now, sleep });

  log.info('AI QA agent runtime initialized', { reasoner: reasoner.kind, agents: Object.keys(QA_AGENTS).length });
  return {
    runSession: (goal: unknown) => runAgentSession(goal, { executor, reasoner, memory, now, sleep }),
    agents: Object.values(QA_AGENTS),
    reasonerKind: reasoner.kind,
  };
}

export { runAgentSession } from './session';
export { createQaExecutor, type QaExecutorBackend } from './executor';
export { DeterministicReasoner, LlmReasoner } from './reasoner';
export { RealQaMemory, FakeQaMemory, type MemoryBackend } from './memory';
export { QA_AGENTS, AGENT_CHECKS, agentChecks, getAgent } from './agents';
export type { QaExecutor, QaRunResult, Reasoner, QaMemory } from './ports';
