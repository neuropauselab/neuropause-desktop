/**
 * S122 — operational reliability intelligence (pure, deterministic). Proves the projection math over
 * the SAME durable-command-journal shape the operator already reads: per-status/per-type counts,
 * definitional ratios, retry pressure, recurring error signatures, the OPTIONAL request-based error
 * budget (reusing the harvested computeErrorBudget), no-invented-policy default, and credential-free
 * output. Adversarial: empty input, malformed numbers, no-verdict-without-objective, sig bounding.
 */
import { describe, it, expect } from 'vitest';
import type { CommittedCommand } from '../platform/command/durableCommandJournal';
import { summarizeReliability, summarizeReliabilityTrend, MAX_ERROR_SIGNATURES, AT_RISK_BURN } from './operationalReliability';

type OutboxLike = { status: string; attempts: number; lastError?: string };
function rec(commandType: string, outbox: OutboxLike): CommittedCommand {
  return { commandType, outbox } as unknown as CommittedCommand;
}
/** A record with an explicit committedAt (for trend ordering). */
function recAt(commandType: string, committedAt: string, outbox: OutboxLike): CommittedCommand {
  return { commandType, committedAt, outbox } as unknown as CommittedCommand;
}
const t = (n: number): string => `2026-09-05T00:00:${String(n).padStart(2, '0')}.000Z`;

describe('S122 · operational reliability intelligence (pure)', () => {
  it('counts per status and per command type, and computes definitional ratios', () => {
    const records = [
      rec('CreateSalesOrder', { status: 'DELIVERED', attempts: 1 }),
      rec('CreateSalesOrder', { status: 'DELIVERED', attempts: 2 }), // retried, then delivered
      rec('CreateSalesOrder', { status: 'RETRYABLE', attempts: 3, lastError: 'ECONNRESET' }),
      rec('PostGoodsReceipt', { status: 'PENDING', attempts: 0 }),
      rec('PostGoodsReceipt', { status: 'PROCESSING', attempts: 1 }),
    ];
    const s = summarizeReliability(records);
    // two records took >1 attempt (the attempts:2 delivered and the attempts:3 retryable) ⇒ retried:2.
    expect(s.totals).toMatchObject({ commands: 5, delivered: 2, pending: 1, processing: 1, retryable: 1, retried: 2, everErrored: 1, attempts: 7 });
    expect(s.successRatio).toBeCloseTo(2 / 5, 10);
    expect(s.deliveryFailureRatio).toBeCloseTo(1 / 5, 10);
    const so = s.byCommandType.find((t) => t.commandType === 'CreateSalesOrder')!;
    expect(so).toMatchObject({ total: 3, delivered: 2, retryable: 1, retried: 2, everErrored: 1 });
    // sorted most-at-risk first (retryable desc): CreateSalesOrder (1 retryable) before PostGoodsReceipt (0)
    expect(s.byCommandType[0].commandType).toBe('CreateSalesOrder');
  });

  it('groups recurring error signatures, most-frequent first, and never leaks a payload', () => {
    const records = [
      rec('X', { status: 'RETRYABLE', attempts: 2, lastError: 'timeout talking to Graph' }),
      rec('X', { status: 'RETRYABLE', attempts: 2, lastError: 'timeout talking to Graph' }),
      rec('Y', { status: 'DELIVERED', attempts: 3, lastError: '429 rate limited' }), // ever-errored though delivered
    ];
    const s = summarizeReliability(records);
    expect(s.topErrors[0]).toEqual({ signature: 'timeout talking to Graph', count: 2 });
    expect(s.topErrors.map((e) => e.signature)).toContain('429 rate limited');
    const blob = JSON.stringify(s).toLowerCase();
    for (const forbidden of ['secret', 'token', 'password', 'authorization', 'payload', 'rawbody']) {
      expect(blob).not.toContain(forbidden);
    }
  });

  it('bounds the number of error signatures to MAX_ERROR_SIGNATURES', () => {
    const records = Array.from({ length: MAX_ERROR_SIGNATURES + 5 }, (_, i) =>
      rec('X', { status: 'RETRYABLE', attempts: 1, lastError: `distinct error #${i}` }),
    );
    const s = summarizeReliability(records);
    expect(s.topErrors.length).toBe(MAX_ERROR_SIGNATURES);
  });

  it('NO verdict/budget without an explicit objective (no invented SLO policy)', () => {
    const s = summarizeReliability([rec('X', { status: 'RETRYABLE', attempts: 1, lastError: 'e' })]);
    expect(s.budget).toBeUndefined();
  });

  it('WITH an objective, computes a request-based error budget via the harvested calculator', () => {
    // 100 commands, 5 currently RETRYABLE, objective 99% ⇒ budget = 1 failure, consumed 5 ⇒ breached.
    const records = [
      ...Array.from({ length: 95 }, () => rec('X', { status: 'DELIVERED', attempts: 1 })),
      ...Array.from({ length: 5 }, () => rec('X', { status: 'RETRYABLE', attempts: 1, lastError: 'e' })),
    ];
    const s = summarizeReliability(records, { objective: 0.99 });
    expect(s.budget).toBeDefined();
    expect(s.budget!).toMatchObject({ objective: 0.99, totalRequests: 100, budgetFailures: 1, consumedFailures: 5, remainingFailures: 0, status: 'breached' });
    expect(s.budget!.burnRate).toBeGreaterThan(1);
  });

  it('objective with zero failures ⇒ healthy budget', () => {
    const records = Array.from({ length: 50 }, () => rec('X', { status: 'DELIVERED', attempts: 1 }));
    const s = summarizeReliability(records, { objective: 0.99 });
    expect(s.budget).toMatchObject({ consumedFailures: 0, status: 'healthy' });
    expect(s.budget!.burnRate).toBe(0);
  });

  it('empty input is total and safe: zero counts, zero ratios, no throw', () => {
    const s = summarizeReliability([]);
    expect(s.totals.commands).toBe(0);
    expect(s.successRatio).toBe(0);
    expect(s.deliveryFailureRatio).toBe(0);
    expect(s.byCommandType).toEqual([]);
    expect(s.topErrors).toEqual([]);
  });

  it('malformed attempts (NaN) are treated as 0, not propagated', () => {
    const s = summarizeReliability([rec('X', { status: 'DELIVERED', attempts: Number.NaN })]);
    expect(s.totals.attempts).toBe(0);
    expect(s.totals.retried).toBe(0);
  });

  it('AT_RISK_BURN is re-exported from the harvested error-budget module (single constant, no fork)', () => {
    expect(AT_RISK_BURN).toBe(0.75);
  });
});

describe('S123 · reliability trend (pure, deterministic, policy-free)', () => {
  it('fewer than 2 records ⇒ not comparable (no fabricated trend)', () => {
    expect(summarizeReliabilityTrend([]).comparable).toBe(false);
    expect(summarizeReliabilityTrend([recAt('X', t(1), { status: 'DELIVERED', attempts: 1 })]).comparable).toBe(false);
  });

  it('rising delivery-failure rate ⇒ INCREASE + DEGRADING posture', () => {
    // previous half all delivered; recent half all retryable ⇒ failure rate 0 → 1.
    const records = [
      recAt('X', t(1), { status: 'DELIVERED', attempts: 1 }),
      recAt('X', t(2), { status: 'DELIVERED', attempts: 1 }),
      recAt('X', t(3), { status: 'RETRYABLE', attempts: 2, lastError: 'boom' }),
      recAt('X', t(4), { status: 'RETRYABLE', attempts: 2, lastError: 'boom' }),
    ];
    const tr = summarizeReliabilityTrend(records);
    expect(tr.comparable).toBe(true);
    expect(tr.window).toEqual({ previous: 2, recent: 2 });
    expect(tr.deliveryFailureRate.direction).toBe('INCREASE');
    expect(tr.deliveryFailureRate.previous).toBe(0);
    expect(tr.deliveryFailureRate.recent).toBe(1);
    expect(tr.posture).toBe('DEGRADING');
    expect(tr.totalFailures).toMatchObject({ previous: 0, recent: 2, direction: 'INCREASE' });
  });

  it('falling failure rate ⇒ DECREASE + IMPROVING posture', () => {
    const records = [
      recAt('X', t(1), { status: 'RETRYABLE', attempts: 2, lastError: 'boom' }),
      recAt('X', t(2), { status: 'RETRYABLE', attempts: 2, lastError: 'boom' }),
      recAt('X', t(3), { status: 'DELIVERED', attempts: 1 }),
      recAt('X', t(4), { status: 'DELIVERED', attempts: 1 }),
    ];
    const tr = summarizeReliabilityTrend(records);
    expect(tr.deliveryFailureRate.direction).toBe('DECREASE');
    expect(tr.posture).toBe('IMPROVING');
  });

  it('classifies error signatures: NEW / PERSISTING / RESOLVED', () => {
    const records = [
      recAt('X', t(1), { status: 'RETRYABLE', attempts: 1, lastError: 'old-error' }),
      recAt('X', t(2), { status: 'RETRYABLE', attempts: 1, lastError: 'shared-error' }),
      recAt('X', t(3), { status: 'RETRYABLE', attempts: 1, lastError: 'shared-error' }),
      recAt('X', t(4), { status: 'RETRYABLE', attempts: 1, lastError: 'new-error' }),
    ];
    const tr = summarizeReliabilityTrend(records);
    expect(tr.newSignatures).toContain('new-error');
    expect(tr.persistingSignatures).toContain('shared-error');
    expect(tr.resolvedSignatures).toContain('old-error');
  });

  it('per-command-type reliability movement is surfaced only when it changed', () => {
    const records = [
      recAt('A', t(1), { status: 'DELIVERED', attempts: 1 }),
      recAt('B', t(2), { status: 'DELIVERED', attempts: 1 }),
      recAt('A', t(3), { status: 'RETRYABLE', attempts: 2, lastError: 'e' }), // A degrades 1→0
      recAt('B', t(4), { status: 'DELIVERED', attempts: 1 }), // B stable 1→1
    ];
    const tr = summarizeReliabilityTrend(records);
    const a = tr.byCommandType.find((x) => x.commandType === 'A');
    expect(a?.trend).toBe('DEGRADING');
    expect(tr.byCommandType.some((x) => x.commandType === 'B')).toBe(false); // stable is not surfaced
  });

  it('stable posture when nothing changed ⇒ STABLE, no thresholds invented', () => {
    const records = [
      recAt('X', t(1), { status: 'DELIVERED', attempts: 1 }),
      recAt('X', t(2), { status: 'DELIVERED', attempts: 1 }),
    ];
    const tr = summarizeReliabilityTrend(records);
    expect(tr.deliveryFailureRate.direction).toBe('STABLE');
    expect(tr.posture).toBe('STABLE');
  });

  it('is order-independent on input (sorts by committedAt) and window-bounded', () => {
    const shuffled = [
      recAt('X', t(4), { status: 'RETRYABLE', attempts: 2, lastError: 'boom' }),
      recAt('X', t(1), { status: 'DELIVERED', attempts: 1 }),
      recAt('X', t(3), { status: 'RETRYABLE', attempts: 2, lastError: 'boom' }),
      recAt('X', t(2), { status: 'DELIVERED', attempts: 1 }),
    ];
    const tr = summarizeReliabilityTrend(shuffled, { window: 2 });
    expect(tr.deliveryFailureRate.direction).toBe('INCREASE'); // chronologically: delivered→delivered then retryable→retryable
  });

  it('trend output carries no credential/secret material', () => {
    const records = [
      recAt('X', t(1), { status: 'DELIVERED', attempts: 1 }),
      recAt('X', t(2), { status: 'RETRYABLE', attempts: 1, lastError: 'timeout' }),
    ];
    const blob = JSON.stringify(summarizeReliabilityTrend(records)).toLowerCase();
    for (const forbidden of ['secret', 'token', 'password', 'authorization', 'payload', 'rawbody']) {
      expect(blob).not.toContain(forbidden);
    }
  });
});
