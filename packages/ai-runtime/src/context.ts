/**
 * Context management (NCEA 10.3, Phase 7 + Phase 1). Layered context
 * (conversation / workspace / organization / task / runtime) and a conversation
 * history. The ExecutionContext is what agents and tools receive — it carries the
 * trace id and layered context so every action is attributable.
 */
import type { AiMessage } from './providers';
import type { RuntimeMode } from '@neuropause/runtime';

export interface LayeredContext {
  runtime: { mode: RuntimeMode };
  organization?: { orgId: string };
  workspace?: { workspaceId: string };
  task?: { taskId: string; goal?: string };
  session?: { sessionId: string };
}

export interface ExecutionContext {
  traceId: string;
  actor: string;
  context: LayeredContext;
}

export class ConversationManager {
  private readonly messages: AiMessage[] = [];
  append(message: AiMessage): void {
    this.messages.push(message);
  }
  history(): AiMessage[] {
    return [...this.messages];
  }
  clear(): void {
    this.messages.length = 0;
  }
  size(): number {
    return this.messages.length;
  }
}

export class ContextManager {
  constructor(private readonly mode: RuntimeMode) {}
  build(partial: Partial<Omit<LayeredContext, 'runtime'>> = {}): LayeredContext {
    return { runtime: { mode: this.mode }, ...partial };
  }
}
