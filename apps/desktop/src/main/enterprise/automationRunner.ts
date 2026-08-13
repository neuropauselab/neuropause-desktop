/**
 * Automation Runtime (V4.7) — executes saved automations.
 *
 * Loads active rules, matches an incoming event's trigger, evaluates conditions +
 * builds the plan via the shared engine's resolveAutomationRun (no duplicated
 * validation), then runs each action through an injected ActionExecutor so the
 * orchestration is pure + unit-testable while real effects (notifications, timeline
 * events, connector writes) are wired separately in runtimeCore.
 *
 * The orchestration (match → gate → sequence actions → record) is fully tested.
 * The effect handlers that call live subsystems are injected and honestly limited
 * to what exists today (notifications + platform/timeline events); connector-write,
 * AI, and webhook handlers are declared extension points.
 */
import {
  resolveAutomationRun,
  type AutomationAction,
  type AutomationActionOutcome,
  type AutomationRule,
  type AutomationRunRecord,
  type AutomationTriggerSource,
} from '@neuropause/shared';

/** An incoming event the runtime can react to. */
export interface AutomationEvent {
  /** P13C Round 2 — the owning tenant, taken from the platform event. */
  tenantId?: string | null;
  source: AutomationTriggerSource;
  /** For connector/activity events: connector id + event name to match triggers. */
  connectorId?: string;
  event?: string;
  /** The payload conditions are evaluated against. */
  payload: Record<string, unknown>;
}

/** Executes a single action's real effect. Returns ok + optional message. */
export type ActionExecutor = (
  action: AutomationAction,
  event: AutomationEvent,
) => Promise<{ ok: boolean; message?: string }>;

/** Injected side-effects the runner reports through (all optional/no-op safe). */
export interface AutomationRunnerDeps {
  /** Execute an action's effect (notification, connector write, AI, …). */
  execute: ActionExecutor;
  /** Persist a completed run record onto the rule (store.recordRun). */
  recordRun?: (
    ruleId: string,
    result: { at: string; ok: boolean; message?: string },
  ) => Promise<unknown>;
  /** Emit a completed-automation event into the timeline / activity bus. */
  emitCompleted?: (record: AutomationRunRecord) => void;
  /** Clock (injected for deterministic tests). */
  now?: () => number;
}

let runSeq = 0;
const runId = (): string => `run_${Date.now().toString(36)}_${(runSeq++).toString(36)}`;

/** Does this event's trigger match the rule's trigger definition? Pure. */
export function eventMatchesTrigger(rule: AutomationRule, event: AutomationEvent): boolean {
  const t = rule.trigger;
  switch (t.type) {
    case 'manual':
      return event.source === 'manual';
    case 'schedule':
      return event.source === 'schedule';
    case 'connector-event':
      return (
        event.source === 'connector' &&
        (!t.connectorId || t.connectorId === event.connectorId) &&
        (!t.event || t.event === event.event)
      );
    case 'activity-event':
      return event.source === 'activity' && (!t.event || t.event === event.event);
    default:
      return false;
  }
}

/**
 * Select the active rules that should fire for an event: trigger matches AND
 * conditions pass (via the shared engine). Pure — returns the rules to execute.
 */
export function selectRulesForEvent(
  rules: AutomationRule[],
  event: AutomationEvent,
): AutomationRule[] {
  return rules.filter((rule) => {
    if (!eventMatchesTrigger(rule, event)) return false;
    return resolveAutomationRun(rule, event.payload).fired;
  });
}

export class AutomationRunner {
  private readonly now: () => number;

  constructor(
    private readonly loadActiveRules: () => AutomationRule[],
    private readonly deps: AutomationRunnerDeps,
    /**
     * Rules owned by a NAMED tenant. Optional so existing unit tests construct
     * the runner unchanged; when absent, `dispatch` falls back to the
     * caller-scoped `loadActiveRules`, which is itself now tenant-filtered.
     */
    private readonly rulesForTenant?: (tenantId: string) => AutomationRule[],
  ) {
    this.now = deps.now ?? Date.now;
  }

  /** Run one rule against an event, executing its actions in order. */
  async runRule(rule: AutomationRule, event: AutomationEvent): Promise<AutomationRunRecord> {
    const started = this.now();
    const startedAt = new Date(started).toISOString();
    const outcomes: AutomationActionOutcome[] = [];
    let ok = true;
    let error: string | undefined;

    for (const action of rule.actions) {
      const aStart = this.now();
      try {
        const res = await this.deps.execute(action, event);
        outcomes.push({
          actionId: action.id,
          type: action.type,
          ok: res.ok,
          message: res.message,
          durationMs: this.now() - aStart,
        });
        if (!res.ok) {
          ok = false;
          error = res.message ?? `Action ${action.type} failed`;
          break; // stop the chain on first failure
        }
      } catch (err) {
        ok = false;
        error = String(err);
        outcomes.push({
          actionId: action.id,
          type: action.type,
          ok: false,
          message: error,
          durationMs: this.now() - aStart,
        });
        break;
      }
    }

    const completed = this.now();
    const record: AutomationRunRecord = {
      id: runId(),
      ruleId: rule.id,
      ruleName: rule.name,
      triggeredBy: event.source,
      startedAt,
      completedAt: new Date(completed).toISOString(),
      ok,
      durationMs: completed - started,
      actions: outcomes,
      error,
    };

    await this.deps.recordRun?.(rule.id, {
      at: record.completedAt,
      ok,
      message: error,
    });
    if (ok) this.deps.emitCompleted?.(record);

    return record;
  }

  /**
   * Dispatch an event to all matching active rules, returning every run record.
   * This is the runtime's main entry point for connector/activity/schedule events.
   */
  /**
   * P13C Round 2 — H1. RULES ARE SELECTED BY THE EVENT'S TENANT.
   *
   * `loadActiveRules()` returned every active rule on the install, so a
   * platform event raised by tenant A was matched against tenant B's rules and
   * could execute them — with actions including `save-memory` and
   * `ai-generate`, which move record data. This is the automation twin of the
   * webhook fan-out Part 2a closed, and it is closed the same way: the
   * destination is selected by the EVENT's owner, which Program 13B stamped.
   *
   * An event with no tenant matches NOTHING. A rule that fires for an unowned
   * event would have to be chosen from somebody's set, and there is no honest
   * choice.
   */
  async dispatch(event: AutomationEvent): Promise<AutomationRunRecord[]> {
    const owner = event.tenantId ?? null;
    const candidates =
      owner === null || owner === ''
        ? []
        : (this.rulesForTenant?.(owner) ?? this.loadActiveRules());
    const rules = selectRulesForEvent(candidates, event);
    const records: AutomationRunRecord[] = [];
    for (const rule of rules) {
      records.push(await this.runRule(rule, event));
    }
    return records;
  }

  /** Run a specific rule by id on demand (manual / voice trigger). */
  async runById(
    id: string,
    payload: Record<string, unknown> = {},
    source: AutomationTriggerSource = 'manual',
  ): Promise<AutomationRunRecord | null> {
    const rule = this.loadActiveRules().find((r) => r.id === id);
    if (!rule) return null;
    return this.runRule(rule, { source, payload });
  }
}
