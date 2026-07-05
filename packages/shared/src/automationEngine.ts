/**
 * Automation Engine (Module 9) — PURE logic for the Trigger → Condition → Action
 * builder: rule validation, condition evaluation against an event payload, and
 * execution planning. No I/O, no Electron — fully unit-testable. The main-process
 * runner (connectors, AI calls, notifications) consumes these decisions.
 */
import type {
  AutomationAction,
  AutomationCondition,
  AutomationPlanStep,
  AutomationRule,
  AutomationValidationIssue,
  AutomationValidationResult,
  ConditionLogic,
  ConditionOperator,
} from './types/automation';

/** Read a dot-path value out of an event payload (e.g. 'a.b.c'). */
export function readField(payload: Record<string, unknown>, field: string): unknown {
  return field.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, payload);
}

/** Evaluate a single condition operator against actual/expected values. Pure. */
export function evaluateOperator(
  operator: ConditionOperator,
  actual: unknown,
  expected?: string | number | boolean,
): boolean {
  switch (operator) {
    case 'exists':
      return actual !== undefined && actual !== null;
    case 'not_exists':
      return actual === undefined || actual === null;
    case 'equals':
      return actual === expected;
    case 'not_equals':
      return actual !== expected;
    case 'contains':
      return typeof actual === 'string' && typeof expected === 'string'
        ? actual.toLowerCase().includes(expected.toLowerCase())
        : Array.isArray(actual)
          ? actual.includes(expected)
          : false;
    case 'not_contains':
      return !(typeof actual === 'string' && typeof expected === 'string'
        ? actual.toLowerCase().includes(expected.toLowerCase())
        : Array.isArray(actual)
          ? actual.includes(expected)
          : false);
    case 'greater_than':
      return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
    case 'less_than':
      return typeof actual === 'number' && typeof expected === 'number' && actual < expected;
    default:
      return false;
  }
}

/** Evaluate one condition against a payload. */
export function evaluateCondition(
  condition: AutomationCondition,
  payload: Record<string, unknown>,
): boolean {
  const actual = readField(payload, condition.field);
  return evaluateOperator(condition.operator, actual, condition.value);
}

/**
 * Evaluate all conditions with the given logic. `all` → every condition true;
 * `any` → at least one. No conditions → always passes (unconditional automation).
 */
export function evaluateConditions(
  conditions: AutomationCondition[],
  logic: ConditionLogic,
  payload: Record<string, unknown>,
): boolean {
  if (conditions.length === 0) return true;
  const results = conditions.map((c) => evaluateCondition(c, payload));
  return logic === 'all' ? results.every(Boolean) : results.some(Boolean);
}

/** Validate a rule for the builder + before activation. Pure. */
export function validateAutomationRule(rule: AutomationRule): AutomationValidationResult {
  const issues: AutomationValidationIssue[] = [];

  if (!rule.name.trim()) {
    issues.push({ path: 'name', message: 'Give the automation a name.' });
  }

  // Trigger must be coherent for its type.
  const t = rule.trigger;
  if (t.type === 'connector-event' && (!t.connectorId || !t.event)) {
    issues.push({
      path: 'trigger',
      message: 'A connector trigger needs a connector and an event.',
    });
  }
  if (t.type === 'schedule' && !t.schedule?.trim()) {
    issues.push({ path: 'trigger', message: 'A schedule trigger needs a schedule.' });
  }

  // Conditions must be well-formed.
  for (const c of rule.conditions) {
    const needsValue = c.operator !== 'exists' && c.operator !== 'not_exists';
    if (!c.field.trim()) {
      issues.push({ path: 'conditions', message: 'Every condition needs a field.' });
      break;
    }
    if (needsValue && (c.value === undefined || c.value === '')) {
      issues.push({
        path: 'conditions',
        message: `Condition on "${c.field}" needs a value.`,
      });
      break;
    }
  }

  // At least one action, each with a label.
  if (rule.actions.length === 0) {
    issues.push({ path: 'actions', message: 'Add at least one action.' });
  }
  const connectorActions: AutomationAction['type'][] = ['connector-write', 'notify'];
  for (const a of rule.actions) {
    if (connectorActions.includes(a.type) && !a.connectorId) {
      issues.push({
        path: 'actions',
        message: `Action "${a.label || a.type}" needs a target connector.`,
      });
      break;
    }
  }

  return { valid: issues.length === 0, issues };
}

/**
 * Build the ordered execution plan for a rule (trigger → condition gate → each
 * action). Used for the builder preview and by the runner. Pure.
 */
export function planAutomation(rule: AutomationRule): AutomationPlanStep[] {
  const plan: AutomationPlanStep[] = [];
  let order = 0;

  const t = rule.trigger;
  const triggerLabel =
    t.type === 'connector-event'
      ? `When ${t.connectorId ?? 'connector'} ${t.event ?? 'event'}`
      : t.type === 'schedule'
        ? `On schedule (${t.schedule ?? 'unset'})`
        : t.type === 'activity-event'
          ? `When ${t.event ?? 'activity event'}`
          : 'When run manually';
  plan.push({ order: order++, kind: 'trigger', label: triggerLabel });

  if (rule.conditions.length > 0) {
    const joiner = rule.conditionLogic === 'all' ? 'AND' : 'OR';
    const label = rule.conditions
      .map((c) => `${c.field} ${c.operator}${c.value !== undefined ? ` ${c.value}` : ''}`)
      .join(` ${joiner} `);
    plan.push({ order: order++, kind: 'condition-gate', label: `If ${label}` });
  }

  for (const a of rule.actions) {
    plan.push({ order: order++, kind: 'action', label: a.label || a.type, actionId: a.id });
  }

  return plan;
}

/**
 * Decide whether a rule should fire for a given event payload: it must be active,
 * and its conditions must pass. Returns the plan when it fires, else null.
 */
export function resolveAutomationRun(
  rule: AutomationRule,
  payload: Record<string, unknown>,
): { fired: boolean; plan: AutomationPlanStep[] | null } {
  if (rule.status !== 'active') return { fired: false, plan: null };
  const pass = evaluateConditions(rule.conditions, rule.conditionLogic, payload);
  return pass ? { fired: true, plan: planAutomation(rule) } : { fired: false, plan: null };
}
