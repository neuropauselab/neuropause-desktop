/**
 * Phase 6 Stage 8 — the execution monitor: stuck sessions (>30 min), failed
 * runs (24 h window), aging approvals (jobs + workflow checkpoints >24 h),
 * error rules, and the two schedule-honesty findings. Findings are
 * evidence-cited, severity-sorted, and per-source failures pass through as
 * unavailable.
 */
import { describe, expect, it } from 'vitest';
import type { AutomationRule, AutomationRunRecord } from '@neuropause/shared';
import { buildMonitorReport, type MonitorInput } from './executionMonitor';

const NOW = Date.parse('2026-07-15T12:00:00.000Z');
const iso = (msAgo: number): string => new Date(NOW - msAgo).toISOString();
const MIN = 60_000;
const HOUR = 3_600_000;

function rule(over: Partial<AutomationRule> = {}): AutomationRule {
  return {
    id: 'rule-1',
    name: 'Rule',
    trigger: { type: 'connector-event', connectorId: 'slack', event: 'message' },
    conditions: [],
    conditionLogic: 'all',
    actions: [{ id: 'a1', type: 'notify', label: 'Notify', config: {} }],
    status: 'active',
    createdAt: iso(90 * 24 * HOUR),
    updatedAt: iso(90 * 24 * HOUR),
    ...over,
  };
}

function runRecord(over: Partial<AutomationRunRecord> = {}): AutomationRunRecord {
  return {
    id: 'run-1',
    ruleId: 'rule-1',
    ruleName: 'Rule',
    triggeredBy: 'manual',
    startedAt: iso(HOUR),
    completedAt: iso(HOUR - MIN),
    ok: true,
    durationMs: MIN,
    actions: [],
    ...over,
  };
}

function input(over: Partial<MonitorInput> = {}): MonitorInput {
  return { nowMs: NOW, sessions: [], runRecords: [], rules: [], workflowRuns: [], jobsAwaiting: [], failures: {}, ...over };
}

describe('buildMonitorReport', () => {
  it('flags running/waiting sessions older than 30 min (high past 2 h), never fresh ones', () => {
    const r = buildMonitorReport(
      input({
        sessions: [
          { id: 's-fresh', kind: 'task', label: 'Fresh', state: 'running', startedAt: iso(10 * MIN) },
          { id: 's-stuck', kind: 'worker', label: 'Stuck', state: 'running', startedAt: iso(45 * MIN) },
          { id: 's-old', kind: 'worker', label: 'Very stuck', state: 'waiting', startedAt: iso(3 * HOUR) },
          { id: 's-done', kind: 'task', label: 'Done', state: 'completed', startedAt: iso(5 * HOUR) },
        ],
      }),
    );
    const stuck = r.findings.filter((f) => f.kind === 'stuck-execution');
    expect(stuck.map((f) => f.evidence[0]).sort()).toEqual(['s-old', 's-stuck']);
    expect(stuck.find((f) => f.evidence[0] === 's-old')?.severity).toBe('high');
    expect(stuck.find((f) => f.evidence[0] === 's-stuck')?.severity).toBe('medium');
    expect(stuck[0].suggestedAction).toContain('execute:cancel');
  });

  it('flags failed runs inside the 24 h window only, citing run + rule ids', () => {
    const r = buildMonitorReport(
      input({
        runRecords: [
          runRecord({ id: 'r-new', ok: false, error: 'boom', startedAt: iso(2 * HOUR) }),
          runRecord({ id: 'r-old', ok: false, startedAt: iso(30 * HOUR) }),
          runRecord({ id: 'r-ok', ok: true, startedAt: iso(HOUR) }),
        ],
      }),
    );
    const failed = r.findings.filter((f) => f.kind === 'failed-run');
    expect(failed).toHaveLength(1);
    expect(failed[0].evidence).toEqual(['r-new', 'rule-1']);
    expect(failed[0].detail).toContain('boom');
    expect(failed[0].severity).toBe('high');
  });

  it('aggregates >24 h parked jobs into one finding and flags aged workflow checkpoints individually', () => {
    const r = buildMonitorReport(
      input({
        jobsAwaiting: [
          { id: 'j-aged', createdAt: iso(30 * HOUR) },
          { id: 'j-new', createdAt: iso(2 * HOUR) },
        ],
        workflowRuns: [
          { id: 'w-aged', workflowId: 'wf-1', status: 'awaiting_approval', startedAt: iso(26 * HOUR) },
          { id: 'w-new', workflowId: 'wf-1', status: 'awaiting_approval', startedAt: iso(HOUR) },
          { id: 'w-run', workflowId: 'wf-1', status: 'running', startedAt: iso(26 * HOUR) },
        ],
      }),
    );
    const approvals = r.findings.filter((f) => f.kind === 'awaiting-approval');
    expect(approvals).toHaveLength(2);
    const jobs = approvals.find((f) => f.evidence.includes('j-aged'))!;
    expect(jobs.title).toContain('1 approval(s)');
    expect(jobs.detail).toContain('blocked, not lost');
    const wf = approvals.find((f) => f.evidence.includes('w-aged'))!;
    expect(wf.evidence).toEqual(['w-aged', 'wf-1']);
  });

  it('flags error rules, unparseable schedules, and never-fired schedule rules honestly', () => {
    const r = buildMonitorReport(
      input({
        rules: [
          rule({ id: 'r-err', status: 'error', lastRun: { at: iso(HOUR), ok: false, message: 'action exploded' } }),
          rule({ id: 'r-bad', trigger: { type: 'schedule', schedule: 'whenever convenient' } }),
          rule({ id: 'r-never', trigger: { type: 'schedule', schedule: 'daily 9am' } }),
          rule({ id: 'r-fired', trigger: { type: 'schedule', schedule: 'daily 9am' } }),
          rule({ id: 'r-paused', status: 'paused', trigger: { type: 'schedule', schedule: 'daily 9am' } }),
        ],
        runRecords: [runRecord({ id: 'run-x', ruleId: 'r-fired', startedAt: iso(2 * HOUR) })],
      }),
    );
    expect(r.findings.find((f) => f.kind === 'error-rule')?.detail).toBe('action exploded');
    const bad = r.findings.find((f) => f.kind === 'schedule-unparseable')!;
    expect(bad.evidence).toEqual(['r-bad']);
    expect(bad.suggestedAction).toContain('daily 9am');
    const never = r.findings.filter((f) => f.kind === 'schedule-never-fired');
    expect(never.map((f) => f.evidence[0])).toEqual(['r-never']); // fired + paused rules are NOT flagged
    expect(never[0].detail).toContain('before Stage 8 nothing emitted schedule events');
  });

  it('sorts by severity, counts by kind, and passes failures through as unavailable', () => {
    const r = buildMonitorReport(
      input({
        sessions: [{ id: 's', kind: 'task', label: 'S', state: 'running', startedAt: iso(45 * MIN) }], // medium
        runRecords: [runRecord({ id: 'r-f', ok: false, startedAt: iso(HOUR) })], // high
        failures: { executions: 'engine offline' },
      }),
    );
    expect(r.findings[0].severity).toBe('high'); // severity-desc
    expect(r.totals.findings).toBe(r.findings.length);
    const byKind = new Map(r.totals.byKind.map((k) => [k.kind, k.count]));
    expect(byKind.get('failed-run')).toBe(1);
    expect(r.unavailable).toEqual([{ system: 'executions', reason: 'engine offline' }]);
  });

  it('empty inputs produce a clean report — nothing invented', () => {
    const r = buildMonitorReport(input({ sessions: null, runRecords: null, rules: null, workflowRuns: null, jobsAwaiting: null }));
    expect(r.findings).toEqual([]);
    expect(r.totals.findings).toBe(0);
  });
});
