/**
 * Automation Rule model (Module 9 — Automation Builder).
 *
 * The user-facing Trigger → Condition → Action workflow the charter describes
 * (e.g. "New Gmail → Summarize with AI → Save to Notion → Notify Slack"). This is
 * distinct from the workforce WorkflowSpec (AI-worker/approval orchestration) — it
 * models event-driven automations across connectors. Types only; the pure engine
 * (validation + execution planning) lives in packages/shared/src/automationEngine.ts.
 */

/** The event source that starts an automation. */
export type AutomationTriggerType =
  | 'connector-event' // e.g. new email, new file, new message
  | 'schedule' // time-based (cron-like)
  | 'manual' // run on demand
  | 'activity-event'; // an Activity Intelligence event (task completed, doc created)

export interface AutomationTrigger {
  type: AutomationTriggerType;
  /** For connector-event: the connector id (e.g. 'gmail', 'slack'). */
  connectorId?: string;
  /** Event name within the source (e.g. 'message.received', 'file.created'). */
  event?: string;
  /** For schedule: a human label like 'daily 9am' (parsed elsewhere). */
  schedule?: string;
  /** Free-form trigger configuration. */
  config?: Record<string, string | number | boolean>;
}

/** Comparison operators a condition can use. */
export type ConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'greater_than'
  | 'less_than'
  | 'exists'
  | 'not_exists';

/** A single predicate evaluated against the trigger payload. */
export interface AutomationCondition {
  /** Dot-path into the event payload, e.g. 'from', 'subject', 'label'. */
  field: string;
  operator: ConditionOperator;
  /** The value to compare against (not needed for exists/not_exists). */
  value?: string | number | boolean;
}

/** How multiple conditions combine. */
export type ConditionLogic = 'all' | 'any';

/** The kind of action an automation step performs. */
export type AutomationActionType =
  | 'ai-summarize'
  | 'ai-generate'
  | 'connector-write' // create/update in a connector (Notion page, etc.)
  | 'notify' // desktop/Slack notification
  | 'save-memory' // store into AI Memory
  | 'create-reminder';

export interface AutomationAction {
  id: string;
  type: AutomationActionType;
  /** Target connector for connector-write / notify (e.g. 'notion', 'slack'). */
  connectorId?: string;
  /** Action label shown in the builder. */
  label: string;
  /** Free-form action configuration. */
  config?: Record<string, string | number | boolean>;
}

/** Lifecycle status of an automation rule. */
export type AutomationStatus = 'draft' | 'active' | 'paused' | 'error';

/** A complete automation rule: one trigger, optional conditions, ordered actions. */
export interface AutomationRule {
  id: string;
  name: string;
  description?: string;
  trigger: AutomationTrigger;
  conditions: AutomationCondition[];
  conditionLogic: ConditionLogic;
  /** Ordered actions; each runs after the previous succeeds. */
  actions: AutomationAction[];
  status: AutomationStatus;
  createdAt: string;
  updatedAt: string;
  /** Last run summary, if any. */
  lastRun?: {
    at: string;
    ok: boolean;
    message?: string;
  };
}

/** A validation problem found in a rule (field-scoped). */
export interface AutomationValidationIssue {
  path: 'trigger' | 'conditions' | 'actions' | 'name';
  message: string;
}

/** Result of validating a rule. */
export interface AutomationValidationResult {
  valid: boolean;
  issues: AutomationValidationIssue[];
}

/** A planned execution step (what would run, in order) — for preview + execution. */
export interface AutomationPlanStep {
  order: number;
  kind: 'trigger' | 'condition-gate' | 'action';
  label: string;
  actionId?: string;
}

/** How an automation run was initiated. */
export type AutomationTriggerSource = 'connector' | 'manual' | 'schedule' | 'voice' | 'activity';

/** The outcome of executing a single action. */
export interface AutomationActionOutcome {
  actionId: string;
  type: AutomationActionType;
  ok: boolean;
  message?: string;
  durationMs: number;
}

/** A complete execution record for the monitor + history. */
export interface AutomationRunRecord {
  id: string;
  ruleId: string;
  ruleName: string;
  triggeredBy: AutomationTriggerSource;
  startedAt: string;
  completedAt: string;
  ok: boolean;
  durationMs: number;
  actions: AutomationActionOutcome[];
  error?: string;
}

/** Live monitor snapshot for the Automations screen. */
export interface AutomationMonitor {
  running: number;
  completed: number;
  failed: number;
  paused: number;
  lastExecution?: string;
  averageRuntimeMs: number;
}
