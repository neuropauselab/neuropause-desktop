/** Sandbox workspace — pure view-model tests (P4). Runs under the Node gate (no DOM). */
import { describe, expect, it } from 'vitest';
import type { ValidationRun } from '@neuropause/shared';
import {
  bandTone,
  certMeta,
  containsChainOfThought,
  execStatusMeta,
  formatDuration,
  formatMs,
  metricOf,
  passRatePct,
  pipelineLabel,
  reasoningSummary,
  relativeTime,
  runHeadline,
  runStatusMeta,
  severityMeta,
  stageKindLabel,
  trendMeta,
} from './sandboxModel';

function run(over: Partial<ValidationRun> = {}): ValidationRun {
  return {
    id: 'r1', pipeline: 'certification', trigger: 'manual', status: 'passed',
    startedAt: '2026-07-11T00:00:00.000Z', finishedAt: '2026-07-11T00:00:03.000Z', durationMs: 3200,
    stages: [], metrics: {}, certificationLevel: 'pass', regressionCount: 0, ...over,
  };
}

describe('status/level → tone + label', () => {
  it('maps certification levels', () => {
    expect(certMeta('pass').tone).toBe('green');
    expect(certMeta('warning').tone).toBe('orange');
    expect(certMeta('fail').tone).toBe('red');
    expect(certMeta(null).tone).toBe('gray');
  });
  it('maps run + execution + stage + severity statuses', () => {
    expect(runStatusMeta('passed').tone).toBe('green');
    expect(runStatusMeta('failed').tone).toBe('red');
    expect(runStatusMeta('running').tone).toBe('blue');
    expect(execStatusMeta('timed_out').tone).toBe('orange');
    expect(execStatusMeta('cancelled').label).toBe('Cancelled');
    expect(severityMeta('critical').tone).toBe('red');
    expect(severityMeta('minor').tone).toBe('blue');
  });
  it('maps dashboard bands + trends', () => {
    expect(bandTone('healthy')).toBe('green');
    expect(bandTone('critical')).toBe('red');
    expect(trendMeta('improving')).toMatchObject({ tone: 'green', direction: 1, glyph: '↑' });
    expect(trendMeta('declining').direction).toBe(-1);
    expect(trendMeta('stable').direction).toBe(0);
  });
  it('labels stage kinds + pipelines', () => {
    expect(stageKindLabel('ai-qa')).toBe('AI QA');
    expect(pipelineLabel('release-candidate')).toBe('Release Candidate');
  });
});

describe('formatters', () => {
  it('formats pass rate', () => {
    expect(passRatePct(null)).toBe('—');
    expect(passRatePct(0.8)).toBe('80%');
    expect(passRatePct(1.5)).toBe('100%');
  });
  it('formats durations + latency', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(450)).toBe('450ms');
    expect(formatDuration(3200)).toBe('3.2s');
    expect(formatDuration(90_000)).toBe('1m 30s');
    expect(formatMs(0)).toBe('—');
    expect(formatMs(42)).toBe('42 ms');
  });
  it('formats relative time from a fixed now', () => {
    const now = Date.parse('2026-07-11T01:00:00.000Z');
    expect(relativeTime(null, now)).toBe('—');
    expect(relativeTime('2026-07-11T00:59:40.000Z', now)).toBe('just now');
    expect(relativeTime('2026-07-11T00:30:00.000Z', now)).toBe('30m ago');
    expect(relativeTime('2026-07-10T01:00:00.000Z', now)).toBe('1d ago');
    expect(relativeTime('2026-07-11T02:00:00.000Z', now)).toBe('scheduled');
  });
});

describe('run projections', () => {
  it('reads metrics safely with fallbacks', () => {
    const r = run({ metrics: { latencyP95Ms: 40, securityFailures: 2 } });
    expect(metricOf(r, 'latencyP95Ms')).toBe(40);
    expect(metricOf(r, 'missing', 7)).toBe(7);
    expect(metricOf(r, 'missing')).toBe(0);
  });
  it('condenses a run into a headline', () => {
    const h = runHeadline(run({ status: 'warning', durationMs: 5000, regressionCount: 3, metrics: { latencyP95Ms: 55, aiQaBugs: 4, scenarioTotal: 6, scenarioPassed: 5, securityFailures: 0 } }));
    expect(h.statusMeta.tone).toBe('orange');
    expect(h.durationLabel).toBe('5.0s');
    expect(h.latencyLabel).toBe('55 ms');
    expect(h.aiQaBugs).toBe(4);
    expect(h.scenarioPassed).toBe(5);
    expect(h.regressionCount).toBe(3);
  });
});

describe('STEP 5 — reasoning summaries only (never chain-of-thought)', () => {
  it('passes through clean summaries (trim only)', () => {
    expect(reasoningSummary('  The checkout flow passed all assertions.  ')).toBe('The checkout flow passed all assertions.');
    expect(reasoningSummary(null)).toBe('');
    expect(reasoningSummary(undefined)).toBe('');
  });
  it('strips <think> blocks and internal-reasoning label lines', () => {
    const raw = '<think>first I will enumerate the DOM, then...</think> Login succeeded after retry.';
    expect(reasoningSummary(raw)).toBe('Login succeeded after retry.');
    expect(containsChainOfThought(raw)).toBe(true);

    const labelled = 'Reasoning: step through each field and validate\nForm submitted cleanly.';
    const out = reasoningSummary(labelled);
    expect(out).toBe('Form submitted cleanly.');
    expect(out).not.toMatch(/Reasoning:/);
  });
  it('caps length with an ellipsis', () => {
    const long = 'x'.repeat(500);
    const out = reasoningSummary(long, 100);
    expect(out.length).toBe(100);
    expect(out.endsWith('…')).toBe(true);
  });
  it('reports clean text as free of chain-of-thought', () => {
    expect(containsChainOfThought('All good.')).toBe(false);
    expect(containsChainOfThought('')).toBe(false);
  });
});
