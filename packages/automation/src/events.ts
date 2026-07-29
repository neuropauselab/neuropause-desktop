/**
 * Module 5 — Event Automation. Reacts to events on the ONE runtime event bus by enqueueing
 * a workflow. Internal events (NEMS / connector / audit / runtime / intelligence /
 * automation) are real and flow live — those reactions are live-verified. External SaaS
 * events (GitHub/Slack/Jira/Calendar) arrive as `webhook.*` events via the Wave 2 webhook
 * receiver; wiring them is supported, but delivery of real webhooks is infra-pending.
 */
import type { EnterpriseRuntime } from '@neuropause/runtime';
import type { AutomationEngine } from './automation';

export interface EventReaction {
  id: string;
  pattern: string;
  workflowId: string;
  tenantId: string;
  actor: string;
  live: boolean;
}

/** External event patterns whose delivery depends on live SaaS webhooks (infra-pending). */
const EXTERNAL_PREFIXES = ['webhook.', 'github.', 'slack.', 'jira.', 'calendar.'];

export class EventAutomation {
  private readonly reactions: EventReaction[] = [];
  private readonly unsubscribes: Array<() => void> = [];
  private counter = 0;

  constructor(
    private readonly runtime: EnterpriseRuntime,
    private readonly automation: AutomationEngine,
  ) {}

  /** React to events whose type starts with (or equals) `pattern` by enqueueing a workflow. */
  on(pattern: string, workflowId: string, opts: { tenantId: string; actor: string }): EventReaction {
    const live = !EXTERNAL_PREFIXES.some((p) => pattern.startsWith(p));
    const reaction: EventReaction = { id: `rx_${(this.counter += 1)}`, pattern, workflowId, tenantId: opts.tenantId, actor: opts.actor, live };
    const unsub = this.runtime.events().subscribe(
      (e) => e.type === pattern || e.type.startsWith(pattern),
      (e) => {
        this.automation.enqueue({ workflowId, tenantId: opts.tenantId, actor: opts.actor, trigger: `event:${e.type}`, inputs: { event: e.payload, eventType: e.type } });
      },
    );
    this.unsubscribes.push(unsub);
    this.reactions.push(reaction);
    return reaction;
  }

  list(): EventReaction[] {
    return [...this.reactions];
  }
  liveReactions(): EventReaction[] {
    return this.reactions.filter((r) => r.live);
  }
  stop(): void {
    for (const u of this.unsubscribes) u();
    this.unsubscribes.length = 0;
  }
}
