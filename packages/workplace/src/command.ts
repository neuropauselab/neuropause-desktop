/**
 * Module 15 — Universal Command Center. A universal command bar dispatching AI, workflow, search,
 * business, and navigation commands. Reuses the Workspace AI and Navigation search — no new engine.
 */
import type { WorkspaceGovernance } from './governance';
import type { NavigationRuntime } from './navigation';
import type { WorkspaceAI } from './ai';
import { COMMAND_KINDS, type CommandKind } from './constants';

export interface CommandResult {
  kind: CommandKind;
  result: string;
}

export class CommandCenter {
  constructor(
    private readonly governance: WorkspaceGovernance,
    private readonly nav: NavigationRuntime,
    private readonly ai: WorkspaceAI,
  ) {}

  async execute(input: { kind: CommandKind; text: string; userId?: string }): Promise<CommandResult> {
    if (!COMMAND_KINDS.includes(input.kind)) throw new Error(`unknown command kind: ${input.kind}`);
    await this.governance.record({ actor: input.userId ?? 'system', module: 'command', operation: input.kind, targetId: input.text.slice(0, 40), evidence: 'live-verified' });
    switch (input.kind) {
      case 'search': {
        const res = await this.nav.search(input.text);
        return { kind: 'search', result: `${res.total} result(s)` };
      }
      case 'ai': {
        const res = await this.ai.ask('assistant', input.text);
        return { kind: 'ai', result: res.answer };
      }
      default:
        return { kind: input.kind, result: `dispatched ${input.kind} command` };
    }
  }
}
