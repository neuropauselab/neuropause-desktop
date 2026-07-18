/**
 * Automation Center v1.0 — model tests. Lock the pure lens: honest trigger/status → label+tone+icon maps, the
 * run-outcome maps, the automation-gap catalog (never empty, always reasoned, always "Requires architecture"),
 * and the pure monitor/rules/runs/business-rules summaries over the real automation DTO shapes.
 */
import { describe, expect, it } from 'vitest';
import type {
  AutomationMonitor,
  AutomationRule,
  AutomationRunRecord,
  AutomationStatus,
  GovernanceConfig,
} from '@neuropause/shared';
import {
  AUTOMATION_GAPS,
  AUTOMATION_GAP_STATUS,
  runLabel,
  runTone,
  statusLabel,
  statusTone,
  summarizeBusinessRules,
  summarizeMonitor,
  summarizeRules,
  summarizeRuns,
  triggerIcon,
  triggerLabel,
  triggerSourceLabel,
} from './automationModel';

const rule = (status: AutomationStatus, actions: number): AutomationRule =>
  ({
    id: status,
    name: status,
    trigger: { type: 'manual' },
    conditions: [],
    conditionLogic: 'all',
    actions: Array.from({ length: actions }, (_, i) => ({
      id: `a${i}`,
      type: 'notify',
      label: 'x',
    })),
    status,
    createdAt: '',
    updatedAt: '',
  }) as unknown as AutomationRule;
const monitor = (
  running: number,
  completed: number,
  failed: number,
  paused: number,
  avg: number,
): AutomationMonitor =>
  ({ running, completed, failed, paused, averageRuntimeMs: avg }) as AutomationMonitor;
const run = (ok: boolean): AutomationRunRecord =>
  ({ id: 'r', ok }) as unknown as AutomationRunRecord;
const gov = (rules: boolean[], chains: boolean[]): GovernanceConfig =>
  ({
    roles: [],
    approvalChains: chains.map((enabled, i) => ({ id: `c${i}`, enabled })),
    complianceRules: rules.map((enabled, i) => ({ id: `r${i}`, enabled })),
  }) as unknown as GovernanceConfig;

describe('trigger + status maps', () => {
  it('triggerLabel is human for every trigger type', () => {
    expect(triggerLabel('connector-event')).toBe('Connector event');
    expect(triggerLabel('schedule')).toBe('Schedule');
    expect(triggerLabel('manual')).toBe('Manual');
    expect(triggerLabel('activity-event')).toBe('Activity event');
  });

  it('triggerIcon returns a distinct glyph per trigger type', () => {
    expect(triggerIcon('connector-event')).toBe('connectors');
    expect(triggerIcon('schedule')).toBe('clock');
    expect(triggerIcon('manual')).toBe('play');
    expect(triggerIcon('activity-event')).toBe('activity');
  });

  it('triggerSourceLabel covers every run-initiation source', () => {
    expect(triggerSourceLabel('connector')).toBe('Connector');
    expect(triggerSourceLabel('manual')).toBe('Manual');
    expect(triggerSourceLabel('schedule')).toBe('Schedule');
    expect(triggerSourceLabel('voice')).toBe('Voice');
    expect(triggerSourceLabel('activity')).toBe('Activity');
  });

  it('statusTone + statusLabel are honest for every lifecycle status', () => {
    expect(statusTone('active')).toBe('green');
    expect(statusTone('paused')).toBe('orange');
    expect(statusTone('error')).toBe('red');
    expect(statusTone('draft')).toBe('gray');
    expect(statusLabel('active')).toBe('Active');
    expect(statusLabel('paused')).toBe('Paused');
    expect(statusLabel('error')).toBe('Error');
    expect(statusLabel('draft')).toBe('Draft');
  });

  it('runTone + runLabel reflect a single run outcome', () => {
    expect(runTone(true)).toBe('green');
    expect(runTone(false)).toBe('red');
    expect(runLabel(true)).toBe('Succeeded');
    expect(runLabel(false)).toBe('Failed');
  });
});

describe('automation-gap catalog (honesty ledger)', () => {
  it('is non-empty and every gap carries an area, capability and reason', () => {
    expect(AUTOMATION_GAPS.length).toBeGreaterThan(0);
    for (const g of AUTOMATION_GAPS) {
      expect(g.area.length).toBeGreaterThan(0);
      expect(g.capability.length).toBeGreaterThan(0);
      expect(g.reason.length).toBeGreaterThan(0);
    }
  });

  it('records the verified-absent capabilities, all as "Requires architecture"', () => {
    expect(AUTOMATION_GAP_STATUS).toBe('Requires architecture');
    const caps = AUTOMATION_GAPS.map((g) => g.capability.toLowerCase());
    expect(caps.some((c) => c.includes('visual workflow builder'))).toBe(true);
    expect(caps.some((c) => c.includes('schedule'))).toBe(true);
    expect(caps.some((c) => c.includes('ai-action'))).toBe(true);
    expect(caps.some((c) => c.includes('template'))).toBe(true);
    expect(caps.some((c) => c.includes('trend') || c.includes('timeseries'))).toBe(true);
  });
});

describe('pure automation summaries', () => {
  it('summarizeMonitor tallies counters, success rate, runtime and an honest tone', () => {
    const empty = summarizeMonitor(null);
    expect(empty).toEqual({
      running: 0,
      completed: 0,
      failed: 0,
      paused: 0,
      finished: 0,
      successRate: 0,
      avgRuntimeMs: 0,
      tone: 'gray',
    });
    const clean = summarizeMonitor(monitor(2, 8, 0, 1, 1200));
    expect(clean.finished).toBe(8);
    expect(clean.successRate).toBe(1);
    expect(clean.avgRuntimeMs).toBe(1200);
    expect(clean.tone).toBe('green');
    const withFailures = summarizeMonitor(monitor(0, 3, 1, 0, 500));
    expect(withFailures.finished).toBe(4);
    expect(withFailures.successRate).toBe(0.75);
    expect(withFailures.tone).toBe('orange');
  });

  it('summarizeRules counts each status and total action steps', () => {
    const s = summarizeRules([
      rule('active', 2),
      rule('active', 1),
      rule('paused', 3),
      rule('draft', 0),
      rule('error', 1),
    ]);
    expect(s).toEqual({ total: 5, active: 2, paused: 1, draft: 1, error: 1, totalActions: 7 });
    expect(summarizeRules([])).toEqual({
      total: 0,
      active: 0,
      paused: 0,
      draft: 0,
      error: 0,
      totalActions: 0,
    });
  });

  it('summarizeRuns tallies ok/failed and success rate', () => {
    expect(summarizeRuns([run(true), run(true), run(false)])).toEqual({
      total: 3,
      ok: 2,
      failed: 1,
      successRate: 2 / 3,
    });
    expect(summarizeRuns([])).toEqual({ total: 0, ok: 0, failed: 0, successRate: 0 });
  });

  it('summarizeBusinessRules counts enabled compliance rules + approval chains', () => {
    const s = summarizeBusinessRules(gov([true, true, false], [true, false]));
    expect(s).toEqual({ rules: 3, rulesEnabled: 2, chains: 2, chainsEnabled: 1 });
    expect(summarizeBusinessRules(null)).toEqual({
      rules: 0,
      rulesEnabled: 0,
      chains: 0,
      chainsEnabled: 0,
    });
  });
});
