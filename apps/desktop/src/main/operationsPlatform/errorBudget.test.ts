/**
 * S107 — error-budget calculator (harvested from packages/reliability/src/slo.ts).
 * Definitional math + edge/clamp behavior + the display-banding default.
 */
import { describe, it, expect } from 'vitest';
import { computeErrorBudget, AT_RISK_BURN } from './errorBudget';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('computeErrorBudget — definitional math', () => {
  it('99% over a 30-day window yields the expected budget and healthy status when unspent', () => {
    const windowMs = 30 * DAY;
    const b = computeErrorBudget({ target: 0.99, windowMs, observedDowntimeMs: 0 });
    // (1-0.99)*30d = 1% of 30 days = 7.2 hours
    expect(b.budgetMs).toBe(Math.round(0.01 * windowMs));
    expect(b.budgetMs).toBe(Math.round(7.2 * HOUR));
    expect(b.consumedMs).toBe(0);
    expect(b.remainingMs).toBe(b.budgetMs);
    expect(b.burnRate).toBe(0);
    expect(b.status).toBe('healthy');
  });

  it('half the budget consumed → burnRate 0.5, healthy', () => {
    const windowMs = 30 * DAY;
    const budget = 0.01 * windowMs;
    const b = computeErrorBudget({ target: 0.99, windowMs, observedDowntimeMs: budget / 2 });
    expect(b.burnRate).toBeCloseTo(0.5, 6);
    expect(b.remainingMs).toBe(Math.round(budget) - b.consumedMs);
    expect(b.status).toBe('healthy');
  });

  it('at the at-risk default threshold (0.75 burn) → at-risk', () => {
    const windowMs = 30 * DAY;
    const budget = 0.01 * windowMs;
    const b = computeErrorBudget({ target: 0.99, windowMs, observedDowntimeMs: budget * AT_RISK_BURN });
    expect(b.burnRate).toBeCloseTo(0.75, 6);
    expect(b.status).toBe('at-risk');
  });

  it('budget exactly exhausted (burnRate === 1) → breached (definitional boundary)', () => {
    const windowMs = 30 * DAY;
    const budget = 0.01 * windowMs;
    const b = computeErrorBudget({ target: 0.99, windowMs, observedDowntimeMs: budget });
    expect(b.burnRate).toBe(1);
    expect(b.remainingMs).toBe(0);
    expect(b.status).toBe('breached');
  });

  it('over budget → breached, remaining floored at 0', () => {
    const windowMs = 30 * DAY;
    const budget = 0.01 * windowMs;
    const b = computeErrorBudget({ target: 0.99, windowMs, observedDowntimeMs: budget * 3 });
    expect(b.burnRate).toBeGreaterThan(1);
    expect(b.remainingMs).toBe(0);
    expect(b.status).toBe('breached');
  });
});

describe('computeErrorBudget — edge cases & totality', () => {
  it('zero-error-budget objective (target=1): any downtime is Infinity burn / breached', () => {
    const b = computeErrorBudget({ target: 1, windowMs: DAY, observedDowntimeMs: 1 });
    expect(b.budgetMs).toBe(0);
    expect(b.burnRate).toBe(Infinity);
    expect(b.status).toBe('breached');
  });

  it('target=1 with zero downtime: burn 0, healthy (no false breach)', () => {
    const b = computeErrorBudget({ target: 1, windowMs: DAY, observedDowntimeMs: 0 });
    expect(b.budgetMs).toBe(0);
    expect(b.burnRate).toBe(0);
    expect(b.status).toBe('healthy');
  });

  it('negative downtime clamped to 0', () => {
    const b = computeErrorBudget({ target: 0.9, windowMs: DAY, observedDowntimeMs: -500 });
    expect(b.consumedMs).toBe(0);
    expect(b.status).toBe('healthy');
  });

  it('downtime greater than the window is capped at the window', () => {
    const b = computeErrorBudget({ target: 0.5, windowMs: DAY, observedDowntimeMs: DAY * 10 });
    expect(b.consumedMs).toBe(DAY);
    expect(b.status).toBe('breached');
  });

  it('target out of range is clamped into [0,1]', () => {
    const over = computeErrorBudget({ target: 1.5, windowMs: DAY, observedDowntimeMs: 0 });
    expect(over.target).toBe(1);
    const under = computeErrorBudget({ target: -0.2, windowMs: DAY, observedDowntimeMs: 0 });
    expect(under.target).toBe(0);
    // target 0 ⇒ whole window is budget
    expect(under.budgetMs).toBe(DAY);
  });

  it('non-finite / zero window is total, never throws', () => {
    expect(() => computeErrorBudget({ target: 0.99, windowMs: 0, observedDowntimeMs: 0 })).not.toThrow();
    const nan = computeErrorBudget({ target: 0.99, windowMs: Number.NaN, observedDowntimeMs: 5 });
    expect(nan.windowMs).toBe(0);
    expect(nan.budgetMs).toBe(0);
  });

  it('caller may override the at-risk banding threshold', () => {
    const windowMs = DAY;
    const budget = 0.1 * windowMs; // target 0.9
    // burn 0.6: healthy under default 0.75, at-risk under override 0.5
    const def = computeErrorBudget({ target: 0.9, windowMs, observedDowntimeMs: budget * 0.6 });
    expect(def.status).toBe('healthy');
    const strict = computeErrorBudget({ target: 0.9, windowMs, observedDowntimeMs: budget * 0.6, atRiskBurn: 0.5 });
    expect(strict.status).toBe('at-risk');
  });
});
