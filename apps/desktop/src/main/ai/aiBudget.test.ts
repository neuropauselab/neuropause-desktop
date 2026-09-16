import { describe, expect, it } from 'vitest';
import { AiBudget } from './aiEngine';

describe('NP-GLOBAL-PUBLIC-LAUNCH-001 §28 — AI rate and cost budget', () => {
  it('admits up to runsPerMinute in a sliding window, then refuses, then recovers', () => {
    let t = 0;
    const b = new AiBudget({ runsPerMinute: 3, outputTokensPerDay: 1000, now: () => t });
    expect([b.admit(), b.admit(), b.admit()]).toEqual([null, null, null]);
    expect(b.admit()).toMatch(/rate limit/);
    t = 61_000;
    expect(b.admit()).toBeNull();
  });
  it('refuses once the daily output-token budget is spent and resets after a day', () => {
    let t = 0;
    const b = new AiBudget({ runsPerMinute: 100, outputTokensPerDay: 50, now: () => t });
    expect(b.admit()).toBeNull(); b.record(50);
    expect(b.admit()).toMatch(/Daily AI budget/);
    t = 86_400_001;
    expect(b.admit()).toBeNull();
    expect(b.snapshot().outputTokensToday).toBe(0);
  });
});
