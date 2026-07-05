import { describe, expect, it } from 'vitest';
import {
  evaluateConditions,
  evaluateOperator,
  planAutomation,
  readField,
  resolveAutomationRun,
  validateAutomationRule,
  type AutomationRule,
} from '@neuropause/shared';

function rule(over: Partial<AutomationRule> = {}): AutomationRule {
  return {
    id: 'auto:1',
    name: 'Summarize new email to Notion',
    trigger: { type: 'connector-event', connectorId: 'gmail', event: 'message.received' },
    conditions: [{ field: 'from', operator: 'contains', value: 'investor' }],
    conditionLogic: 'all',
    actions: [
      { id: 'a1', type: 'ai-summarize', label: 'Summarize with AI' },
      { id: 'a2', type: 'connector-write', connectorId: 'notion', label: 'Save to Notion' },
    ],
    status: 'active',
    createdAt: '2026-01-10T00:00:00.000Z',
    updatedAt: '2026-01-10T00:00:00.000Z',
    ...over,
  };
}

describe('readField', () => {
  it('reads nested dot-paths', () => {
    expect(readField({ a: { b: { c: 5 } } }, 'a.b.c')).toBe(5);
    expect(readField({ from: 'x' }, 'missing')).toBeUndefined();
  });
});

describe('evaluateOperator', () => {
  it('handles existence, equality, contains, and numeric compares', () => {
    expect(evaluateOperator('exists', 'x')).toBe(true);
    expect(evaluateOperator('not_exists', undefined)).toBe(true);
    expect(evaluateOperator('equals', 3, 3)).toBe(true);
    expect(evaluateOperator('not_equals', 3, 4)).toBe(true);
    expect(evaluateOperator('contains', 'Hello World', 'world')).toBe(true);
    expect(evaluateOperator('not_contains', 'abc', 'z')).toBe(true);
    expect(evaluateOperator('greater_than', 5, 3)).toBe(true);
    expect(evaluateOperator('less_than', 2, 3)).toBe(true);
    expect(evaluateOperator('contains', ['a', 'b'], 'a')).toBe(true);
  });
});

describe('evaluateConditions', () => {
  const payload = { from: 'investor@x.com', subject: 'Q3', amount: 100 };
  it('all logic requires every condition', () => {
    expect(
      evaluateConditions(
        [
          { field: 'from', operator: 'contains', value: 'investor' },
          { field: 'amount', operator: 'greater_than', value: 50 },
        ],
        'all',
        payload,
      ),
    ).toBe(true);
    expect(
      evaluateConditions(
        [
          { field: 'from', operator: 'contains', value: 'investor' },
          { field: 'amount', operator: 'greater_than', value: 500 },
        ],
        'all',
        payload,
      ),
    ).toBe(false);
  });
  it('any logic requires at least one', () => {
    expect(
      evaluateConditions(
        [
          { field: 'from', operator: 'contains', value: 'nobody' },
          { field: 'subject', operator: 'equals', value: 'Q3' },
        ],
        'any',
        payload,
      ),
    ).toBe(true);
  });
  it('no conditions always passes', () => {
    expect(evaluateConditions([], 'all', payload)).toBe(true);
  });
});

describe('validateAutomationRule', () => {
  it('accepts a well-formed rule', () => {
    expect(validateAutomationRule(rule()).valid).toBe(true);
  });
  it('flags missing name', () => {
    const r = validateAutomationRule(rule({ name: '  ' }));
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.path === 'name')).toBe(true);
  });
  it('flags an incomplete connector trigger', () => {
    const r = validateAutomationRule(rule({ trigger: { type: 'connector-event' } }));
    expect(r.issues.some((i) => i.path === 'trigger')).toBe(true);
  });
  it('flags a condition missing its value', () => {
    const r = validateAutomationRule(rule({ conditions: [{ field: 'from', operator: 'equals' }] }));
    expect(r.issues.some((i) => i.path === 'conditions')).toBe(true);
  });
  it('allows exists operator without a value', () => {
    const r = validateAutomationRule(
      rule({ conditions: [{ field: 'attachment', operator: 'exists' }] }),
    );
    expect(r.valid).toBe(true);
  });
  it('flags no actions', () => {
    const r = validateAutomationRule(rule({ actions: [] }));
    expect(r.issues.some((i) => i.path === 'actions')).toBe(true);
  });
  it('flags a connector action without a connector', () => {
    const r = validateAutomationRule(
      rule({ actions: [{ id: 'a', type: 'connector-write', label: 'Save' }] }),
    );
    expect(r.issues.some((i) => i.path === 'actions')).toBe(true);
  });
});

describe('planAutomation', () => {
  it('produces trigger → condition gate → actions in order', () => {
    const plan = planAutomation(rule());
    expect(plan[0].kind).toBe('trigger');
    expect(plan[1].kind).toBe('condition-gate');
    expect(plan[2].kind).toBe('action');
    expect(plan[3].kind).toBe('action');
    expect(plan.map((p) => p.order)).toEqual([0, 1, 2, 3]);
  });
  it('omits the condition gate when there are no conditions', () => {
    const plan = planAutomation(rule({ conditions: [] }));
    expect(plan.some((p) => p.kind === 'condition-gate')).toBe(false);
  });
});

describe('resolveAutomationRun', () => {
  it('fires an active rule whose conditions pass', () => {
    const r = resolveAutomationRun(rule(), { from: 'investor@x.com' });
    expect(r.fired).toBe(true);
    expect(r.plan).not.toBeNull();
  });
  it('does not fire when conditions fail', () => {
    const r = resolveAutomationRun(rule(), { from: 'friend@x.com' });
    expect(r.fired).toBe(false);
    expect(r.plan).toBeNull();
  });
  it('does not fire a paused rule', () => {
    const r = resolveAutomationRun(rule({ status: 'paused' }), { from: 'investor@x.com' });
    expect(r.fired).toBe(false);
  });
});
