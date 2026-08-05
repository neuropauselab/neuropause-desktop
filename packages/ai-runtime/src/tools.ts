/**
 * Tool runtime (NCEA 10.3, Phase 5). Tools declare required permissions and a
 * Zod argument schema. Execution is governed: permission gate → argument
 * validation → bounded (timed) execution → audit. A tool never runs with
 * unvalidated arguments, without its permissions, or without an audit record.
 */
import type { ZodType } from 'zod';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import type { GovernanceRecorder } from './governance';
import type { ExecutionContext } from './context';
import { withTimeout } from './util';

export interface ToolDefinition<A = unknown, R = unknown> {
  name: string;
  description?: string;
  /** Permission grants the caller must hold. */
  permissions: string[];
  /** Zod schema validating the arguments (the sandbox's input boundary). */
  schema: ZodType<A>;
  execute(args: A, ctx: ExecutionContext): Promise<R>;
  timeoutMs?: number;
}

export interface ToolCallOptions {
  actor: string;
  grants: string[];
}

export class ToolRuntime {
  private readonly tools = new Map<string, ToolDefinition>();

  constructor(
    private readonly runtime: EnterpriseRuntime,
    private readonly governance: GovernanceRecorder,
  ) {}

  register<A, R>(tool: ToolDefinition<A, R>): void {
    if (this.tools.has(tool.name)) throw new Error(`tool '${tool.name}' already registered`);
    this.tools.set(tool.name, tool as ToolDefinition);
  }
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }
  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  async call<R = unknown>(name: string, rawArgs: unknown, options: ToolCallOptions): Promise<R> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`tool '${name}' is not registered`);
    const traceId = this.runtime.observability().newTraceId();

    // Permission gate.
    const missing = tool.permissions.filter((p) => !options.grants.includes(p));
    if (missing.length > 0) {
      await this.governance.record({
        traceId,
        kind: 'tool',
        target: name,
        actor: options.actor,
        durationMs: 0,
        approval: 'rejected',
        ok: false,
        detail: `missing permission(s): ${missing.join(', ')}`,
      });
      throw new Error(`tool '${name}' requires permission(s): ${missing.join(', ')}`);
    }

    // Argument validation — only validated args cross the sandbox boundary.
    const parsed = tool.schema.safeParse(rawArgs);
    if (!parsed.success) {
      await this.governance.record({
        traceId,
        kind: 'tool',
        target: name,
        actor: options.actor,
        durationMs: 0,
        approval: 'approved',
        ok: false,
        detail: 'invalid arguments',
      });
      throw new Error(`invalid arguments for tool '${name}'`);
    }

    const ctx: ExecutionContext = {
      traceId,
      actor: options.actor,
      context: { runtime: { mode: this.runtime.context().mode } },
    };
    const timer = this.runtime.observability().startTimer(`ai.tool.${name}`);
    const approval = tool.permissions.length > 0 ? 'approved' : 'not-required';
    try {
      const result = (await withTimeout(tool.execute(parsed.data, ctx), tool.timeoutMs, `tool '${name}'`)) as R;
      await this.governance.record({
        traceId,
        kind: 'tool',
        target: name,
        actor: options.actor,
        durationMs: timer.end(),
        approval,
        ok: true,
      });
      return result;
    } catch (error) {
      await this.governance.record({
        traceId,
        kind: 'tool',
        target: name,
        actor: options.actor,
        durationMs: timer.end(),
        approval,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
      throw error instanceof Error ? error : new Error(String(error));
    }
  }
}
