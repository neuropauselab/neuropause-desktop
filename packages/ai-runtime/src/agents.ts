/**
 * Agent runtime (NCEA 10.3, Phase 3). Agents (task / workflow / planning /
 * analysis / connector / automation / approval) execute THROUGH the governed
 * runtime: each run gets a trace id and a governance record (audit + event +
 * timeline). An agent can never run un-audited.
 */
import type { EnterpriseRuntime } from '@neuropause/runtime';
import type { GovernanceRecorder } from './governance';
import type { ExecutionContext } from './context';

export type AgentKind =
  | 'task'
  | 'workflow'
  | 'planning'
  | 'analysis'
  | 'connector'
  | 'automation'
  | 'approval';

export interface Agent<I = unknown, O = unknown> {
  name: string;
  kind: AgentKind;
  run(input: I, ctx: ExecutionContext): Promise<O>;
}

export class AgentRuntime {
  private readonly agents = new Map<string, Agent>();

  constructor(
    private readonly runtime: EnterpriseRuntime,
    private readonly governance: GovernanceRecorder,
  ) {}

  register<I, O>(agent: Agent<I, O>): void {
    if (this.agents.has(agent.name)) throw new Error(`agent '${agent.name}' already registered`);
    this.agents.set(agent.name, agent as Agent);
  }
  get(name: string): Agent | undefined {
    return this.agents.get(name);
  }
  list(): Agent[] {
    return [...this.agents.values()];
  }

  async execute<I, O>(name: string, input: I, actor = 'system'): Promise<O> {
    const agent = this.agents.get(name);
    if (!agent) throw new Error(`agent '${name}' is not registered`);
    const traceId = this.runtime.observability().newTraceId();
    const ctx: ExecutionContext = {
      traceId,
      actor,
      context: { runtime: { mode: this.runtime.context().mode } },
    };
    const timer = this.runtime.observability().startTimer(`ai.agent.${agent.kind}`);
    try {
      const output = (await agent.run(input, ctx)) as O;
      await this.governance.record({
        traceId,
        kind: 'agent',
        target: agent.name,
        actor,
        durationMs: timer.end(),
        approval: 'not-required',
        ok: true,
      });
      return output;
    } catch (error) {
      await this.governance.record({
        traceId,
        kind: 'agent',
        target: agent.name,
        actor,
        durationMs: timer.end(),
        approval: 'not-required',
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
      throw error instanceof Error ? error : new Error(String(error));
    }
  }
}
