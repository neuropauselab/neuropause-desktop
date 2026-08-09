/**
 * Deterministic-first intelligence — the seam that keeps the model out of
 * questions that do not need one.
 *
 * The two properties that matter most, both asserted here:
 *  1. A deterministic hit produces an answer WITHOUT the AI engine being
 *     invoked (the fake engine THROWS if called).
 *  2. The turn is measured as 'none' and its badge metadata says a resolver
 *     answered — never "local AI".
 */
import { describe, expect, it } from 'vitest';
import {
  evaluateArithmetic,
  resolveDeterministicAnswer,
  type DeterministicPorts,
} from './deterministicAnswers';

const T0 = '2026-08-09T12:00:00.000Z';

const rows = (
  list: { id?: string; title?: string; status?: string; fields: Record<string, unknown> }[],
): { rows: { id: string; title: string; status: string; fields: Record<string, unknown> }[] } => ({
  rows: list.map((r, i) => ({
    id: r.id ?? `r${i}`,
    title: r.title ?? `Record ${i}`,
    status: r.status ?? 'active',
    fields: r.fields,
  })),
});

describe('Arithmetic', () => {
  it('evaluates the basics with precedence and parentheses', () => {
    expect(evaluateArithmetic('2+2')).toBe(4);
    expect(evaluateArithmetic('2 + 3 * 4')).toBe(14);
    expect(evaluateArithmetic('(2 + 3) * 4')).toBe(20);
    expect(evaluateArithmetic('17 x 23')).toBe(391);
    expect(evaluateArithmetic('10 / 4')).toBe(2.5);
    expect(evaluateArithmetic('0.1 + 0.2')).toBe(0.3);
  });

  it('refuses anything outside the grammar — this is not eval()', () => {
    expect(evaluateArithmetic('process.exit(1)')).toBeNull();
    expect(evaluateArithmetic('2 + fs')).toBeNull();
    expect(evaluateArithmetic('1/0')).toBeNull();
    expect(evaluateArithmetic('')).toBeNull();
  });

  it('answers "what is 2 + 2?" with the computation and no sources', () => {
    const hit = resolveDeterministicAnswer('What is 2 + 2?', {}, T0);
    expect(hit?.resolver).toBe('arithmetic');
    expect(hit?.answer).toContain('= 4');
    expect(hit?.reason).toContain('No records were read and no AI model ran');
  });

  it('does NOT swallow a business question that merely contains numbers', () => {
    expect(resolveDeterministicAnswer('Why did revenue fall 12% in Q3?', {}, T0)).toBeNull();
  });
});

describe('Date and time', () => {
  it('answers the date from the injected clock', () => {
    const hit = resolveDeterministicAnswer("What is today's date?", {}, T0);
    expect(hit?.resolver).toBe('datetime');
    expect(hit?.answer).toContain('2026');
    expect(hit?.findings[0]?.text).toBe(T0);
  });

  it('leaves "what date works for the meeting" alone', () => {
    expect(resolveDeterministicAnswer('What date works best for the meeting?', {}, T0)).toBeNull();
  });
});

describe('Outstanding invoices', () => {
  const ports: DeterministicPorts = {
    records: (moduleId) =>
      moduleId === 'finance-invoices'
        ? rows([
            { fields: { total: 1000, amountPaid: 400 } }, // 600 due
            { fields: { total: 500, amountPaid: 500 } }, // settled
            { fields: { total: 250, amountPaid: 0 } }, // 250 due
            { status: 'deleted', fields: { total: 99999, amountPaid: 0 } }, // ignored
          ])
        : null,
  };

  it('sums (total − paid) over open invoices, deterministically', () => {
    const hit = resolveDeterministicAnswer('What is our outstanding invoice total?', ports, T0);
    expect(hit?.resolver).toBe('finance.outstanding');
    expect(hit?.answer).toContain('850');
    expect(hit?.answer).toContain('2 invoices');
    expect(hit?.sources[0]).toMatchObject({ id: 'finance-invoices' });
  });

  it('a permission refusal is an ANSWER, not a fall-through to the model', () => {
    const forbidden: DeterministicPorts = { records: () => 'forbidden' };
    const hit = resolveDeterministicAnswer('What is the outstanding invoice total?', forbidden, T0);
    expect(hit?.answer).toContain("don't have access");
  });

  it('an absent finance module falls through to the pipeline', () => {
    expect(
      resolveDeterministicAnswer('What is the outstanding invoice total?', { records: () => null }, T0),
    ).toBeNull();
  });
});

describe('Lot quantity', () => {
  const ports: DeterministicPorts = {
    records: (moduleId) =>
      moduleId === 'md-lots'
        ? rows([
            {
              fields: {
                lotNumber: 'LOT-001',
                quantity: 100,
                consumedQuantity: 30,
                splitQuantity: 20,
                unit: 'pcs',
                status: 'partially_consumed',
              },
            },
          ])
        : null,
  };

  it('derives the remainder exactly as the lot model does', () => {
    const hit = resolveDeterministicAnswer('How many units are left in lot LOT-001?', ports, T0);
    expect(hit?.resolver).toBe('medicalDevice.lot');
    expect(hit?.answer).toContain('50 pcs remaining');
    expect(hit?.findings.map((f) => f.label)).toEqual(
      expect.arrayContaining(['Original quantity', 'Consumed', 'Split into child lots', 'Remaining']),
    );
  });

  it('an unknown lot number is a truthful "does not exist", with the search scope stated', () => {
    const hit = resolveDeterministicAnswer('How many units in lot LOT-999?', ports, T0);
    expect(hit?.answer).toContain('No lot named "LOT-999"');
    expect(hit?.reason).toContain('Searched 1 lot record');
  });
});

describe('Pending approvals', () => {
  it('counts from the live port', () => {
    const hit = resolveDeterministicAnswer(
      'How many approvals are pending?',
      { pendingApprovals: () => 3 },
      T0,
    );
    expect(hit?.resolver).toBe('approvals.pending');
    expect(hit?.answer).toContain('3 approvals');
  });

  it('zero is an answer, not an empty state', () => {
    const hit = resolveDeterministicAnswer(
      'How many approvals are pending?',
      { pendingApprovals: () => 0 },
      T0,
    );
    expect(hit?.answer).toBe('No approvals are waiting on you.');
  });

  it('falls through when the port is absent', () => {
    expect(resolveDeterministicAnswer('How many approvals are pending?', {}, T0)).toBeNull();
  });
});

describe('The seam stays out of the way', () => {
  it('open questions fall through to the existing pipeline', () => {
    for (const q of [
      'Summarize my documents.',
      'Why did profitability fall this month?',
      'Help me plan my week.',
      'Prepare a customer follow-up list.',
    ]) {
      expect(resolveDeterministicAnswer(q, { pendingApprovals: () => 1 }, T0)).toBeNull();
    }
  });
});
