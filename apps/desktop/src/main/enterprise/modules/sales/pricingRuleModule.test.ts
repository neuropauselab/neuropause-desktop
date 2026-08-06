import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  evaluatePricingRules,
  pricingRuleApplies,
  pricingRuleDiscount,
  type PricingRule,
} from '@neuropause/shared';
import type { EnterpriseModule } from '../../framework';
import { createPricingRuleModule } from './pricingRuleModule';
import { createQuoteModule } from './quoteModule';

const T0 = '2026-08-06T00:00:00.000Z';

const rule = (over: Partial<PricingRule>): PricingRule => ({
  id: 'r1', ruleName: 'Volume 100k', scope: 'global', customerName: '', ruleType: 'percentage',
  value: 5, minSubtotal: 100000, effectiveFrom: null, effectiveTo: null, active: true,
  priority: 100, createdAt: T0, updatedAt: T0, ...over,
});

describe('discount engine (pure) — applicability, grants, best-rule-wins', () => {
  const ctx = { customer: 'Acme Inc.', subtotal: 200000, issueDate: '2026-08-06' };

  it('gates rules on active, scope, threshold, and the quote-own date window', () => {
    expect(pricingRuleApplies(rule({}), ctx)).toBe(true);
    expect(pricingRuleApplies(rule({ active: false }), ctx)).toBe(false);
    expect(pricingRuleApplies(rule({ minSubtotal: 300000 }), ctx)).toBe(false);
    expect(pricingRuleApplies(rule({ scope: 'customer', customerName: 'Other Co.' }), ctx)).toBe(false);
    expect(pricingRuleApplies(rule({ scope: 'customer', customerName: 'Acme Inc.' }), ctx)).toBe(true);
    expect(pricingRuleApplies(rule({ effectiveFrom: '2026-09-01' }), ctx)).toBe(false);
    expect(pricingRuleApplies(rule({ effectiveTo: '2026-08-01' }), ctx)).toBe(false);
    expect(pricingRuleApplies(rule({ effectiveFrom: '2026-08-01', effectiveTo: '2026-08-31' }), ctx)).toBe(true);
    // Date-windowed rules never apply to quotes without an issue date.
    expect(pricingRuleApplies(rule({ effectiveFrom: '2026-08-01' }), { ...ctx, issueDate: null })).toBe(false);
    expect(pricingRuleApplies(rule({}), { ...ctx, issueDate: null })).toBe(true);
  });

  it('grants percentage-of-subtotal or capped fixed amounts, rounded to cents', () => {
    expect(pricingRuleDiscount(rule({}), ctx)).toBe(10000); // 5% of 200,000
    expect(pricingRuleDiscount(rule({ ruleType: 'fixed', value: 7500 }), ctx)).toBe(7500);
    expect(pricingRuleDiscount(rule({ ruleType: 'fixed', value: 999999 }), ctx)).toBe(200000); // never exceeds subtotal
    expect(pricingRuleDiscount(rule({ value: 2.5 }), { ...ctx, subtotal: 33333 })).toBe(833.33);
  });

  it('best single rule wins — largest discount, then priority, then name; no stacking', () => {
    const rules = [
      rule({ id: 'a', ruleName: 'Small', value: 2 }),
      rule({ id: 'b', ruleName: 'Big', value: 10 }),
      rule({ id: 'c', ruleName: 'Alpha tie', ruleType: 'fixed', value: 20000, priority: 50 }),
    ];
    const policy = evaluatePricingRules(rules, ctx);
    expect(policy.discount).toBe(20000); // 10% = 20,000 ties fixed 20,000 → priority 50 wins
    expect(policy.ruleName).toBe('Alpha tie');
    expect(policy.explanation).toContain('no stacking');
    expect(evaluatePricingRules([], ctx)).toEqual({
      discount: 0, ruleName: null, explanation: 'No pricing rule applies — list price.',
    });
  });
});

describe('Pricing Rules module + quote policy ceiling over real stores', () => {
  let dir: string;
  let rules: EnterpriseModule;
  let quotes: EnterpriseModule;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-price-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    rules = createPricingRuleModule(join(dir, 'rules.json'));
    quotes = createQuoteModule(join(dir, 'quotes.json'), undefined, rules.store);
    await Promise.all([rules.store.load(), quotes.store.load()]);
  });

  afterEach(async () => {
    await Promise.all([rules.store.flush(), quotes.store.flush()]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  const addRule = (fields: Record<string, unknown>): void => {
    const v = rules.hooks.validate({ fields: { ruleName: 'R', scope: 'global', ruleType: 'percentage', value: 5, active: 'yes', ...fields } });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (v.ok) rules.store.create({ title: String(v.values.ruleName), fields: v.values, actor: 't@np', now: T0 });
  };

  it('guards the rule book: positive values, ≤100%, named customers, ordered windows', () => {
    expect(rules.hooks.validate({ fields: { ruleName: 'X', scope: 'global', ruleType: 'percentage', value: 0, active: 'yes' } }).ok).toBe(false);
    expect(rules.hooks.validate({ fields: { ruleName: 'X', scope: 'global', ruleType: 'percentage', value: 101, active: 'yes' } }).ok).toBe(false);
    expect(rules.hooks.validate({ fields: { ruleName: 'X', scope: 'customer', ruleType: 'percentage', value: 5, active: 'yes' } }).ok).toBe(false);
    expect(rules.hooks.validate({ fields: { ruleName: 'X', scope: 'global', ruleType: 'percentage', value: 5, active: 'yes', effectiveFrom: '2026-09-01', effectiveTo: '2026-08-01' } }).ok).toBe(false);
    expect(rules.hooks.validate({ fields: { ruleName: 'X', scope: 'global', ruleType: 'fixed', value: 500, active: 'yes' } }).ok).toBe(true);
  });

  it('stamps the policy discount on quotes and forces approval only beyond policy', () => {
    // All quotes here sit UNDER the risk-based approval thresholds (discount ≤ 20%,
    // margin ≥ 15%, total < 100,000), so any 'required' below is MY policy forcing.
    addRule({ ruleName: 'Volume 10k — 5%', minSubtotal: 10000 });
    // Within policy: 5% of 50,000 = 2,500 granted; manual 2,000 ≤ policy.
    const within = quotes.hooks.validate({
      fields: { quoteNumber: 'Q-1', customer: 'Acme Inc.', status: 'draft', subtotal: 50000, discount: 2000, tax: 0, cost: 20000 },
    });
    expect(within.ok, JSON.stringify('errors' in within ? within.errors : {})).toBe(true);
    if (within.ok) {
      expect(within.values.policyDiscount).toBe(2500);
      expect(within.values.approvalStatus).toBe('not_required');
    }
    // Beyond policy: manual 3,000 > 2,500 → approval forced (base rules alone would pass it).
    const beyond = quotes.hooks.validate({
      fields: { quoteNumber: 'Q-2', customer: 'Acme Inc.', status: 'draft', subtotal: 50000, discount: 3000, tax: 0, cost: 20000 },
    });
    expect(beyond.ok).toBe(true);
    if (beyond.ok) {
      expect(beyond.values.policyDiscount).toBe(2500);
      expect(beyond.values.approvalStatus).toBe('required');
    }
    // Below the volume threshold no rule applies: any manual discount is over policy.
    const noRule = quotes.hooks.validate({
      fields: { quoteNumber: 'Q-3', customer: 'Acme Inc.', status: 'draft', subtotal: 8000, discount: 100, tax: 0, cost: 4000 },
    });
    expect(noRule.ok).toBe(true);
    if (noRule.ok) {
      expect(noRule.values.policyDiscount).toBe(0);
      expect(noRule.values.approvalStatus).toBe('required');
    }
  });

  it('an empty rule book changes nothing — the policy regime starts with the first rule', () => {
    const v = quotes.hooks.validate({
      fields: { quoteNumber: 'Q-0', customer: 'Acme Inc.', status: 'draft', subtotal: 50000, discount: 100, tax: 0, cost: 30000 },
    });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.values.policyDiscount).toBeNull(); // no book → no policy stamp (validator nulls unset fields)
      expect(v.values.approvalStatus).toBe('not_required'); // risk-based rule alone decides
    }
  });

  it('customer-scoped rules price only their customer', () => {
    addRule({ ruleName: 'Acme special — 10%', scope: 'customer', customerName: 'Acme Inc.', value: 10 });
    const acme = quotes.hooks.validate({
      fields: { quoteNumber: 'Q-4', customer: 'Acme Inc.', status: 'draft', subtotal: 10000, discount: 0, tax: 0, cost: 6000 },
    });
    if (acme.ok) expect(acme.values.policyDiscount).toBe(1000);
    const other = quotes.hooks.validate({
      fields: { quoteNumber: 'Q-5', customer: 'Other Co.', status: 'draft', subtotal: 10000, discount: 0, tax: 0, cost: 6000 },
    });
    if (other.ok) expect(other.values.policyDiscount).toBe(0);
    expect(acme.ok && other.ok).toBe(true);
  });
});
