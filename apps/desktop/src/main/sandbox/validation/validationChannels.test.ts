/**
 * AI Sandbox P4 — Validation Experience seams: the thin read/command channels the Sandbox
 * workspace consumes. These exercise the handlers registered by `initContinuousValidation`
 * over fake executors (no new engine): dashboard read, run command, run-detail read (with
 * certification exports), and schedule toggle. Pure node — collected by the desktop gate.
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  IpcChannel,
  type ValidationDashboard,
  type ValidationRunDetail,
  type ScheduledValidation,
  type QaSessionResult,
} from '@neuropause/shared';
import { BenchmarkStore } from '../lab/benchmarkStore';
import { initContinuousValidation } from './index';
import type { LabRunOutput, StageExecutors } from './ports';
import type { SecureHandlerDef } from '../../ipc/secureBridge';

function clock(): () => number {
  let t = 1000;
  return () => (t += 5);
}
function tmpPath(name: string): string {
  return join(tmpdir(), `p4ch-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}
function fakeLab(): LabRunOutput {
  return {
    report: { id: 'l', title: 't', generatedAt: 'x', verdict: 'pass', performance: [], load: [], stress: [], chaos: [], security: [], recovery: [], benchmarks: [], recommendations: [], summary: 'ok' },
    dashboard: { generatedAt: 'x', latencyP95Ms: 42, throughputPerSec: 110, cpuPercent: 0, memoryUsedMb: 0, queueDepth: 0, scenarioSuccessPct: 100, recoveryRatePct: 100, securityFailures: 0, regressionTrend: 'stable', panels: [] },
    exports: { json: '', html: '', csv: '', junit: '' }, metrics: {},
  };
}
function fakeSession(): QaSessionResult {
  return { sessionId: 's', agent: 'regression', goalId: 'g', goalText: 'x', planned: 1, executed: 1, passed: 1, failed: 0, skipped: 0, bugs: [], learnings: 0, metrics: {}, outcome: 'pass', summary: '', startedAt: 'x' };
}
function fakeExecutors(): StageExecutors {
  return {
    qaExecutor: { kind: 'fake', run: () => Promise.resolve({ executionId: 'e', status: 'passed', outcome: 'pass', assertions: { total: 1, passed: 1, failed: 0 }, metrics: {}, artifacts: [], timelinePhases: [], knowledgeGraphRefs: [], error: null }) },
    runQaSession: () => Promise.resolve(fakeSession()),
    runLab: () => Promise.resolve(fakeLab()),
  };
}

async function subsystem() {
  return initContinuousValidation({
    executors: fakeExecutors(),
    benchmarks: new BenchmarkStore(tmpPath('bench')),
    runsPath: tmpPath('runs'),
    version: '1.0.0',
    now: clock(),
    observers: { kpis: () => [{ key: 'records', value: 5 }], health: () => Promise.resolve({ level: 'healthy', cpuPercent: 10, memoryUsedMb: 100 }) },
  });
}
function handler(defs: SecureHandlerDef[], channel: string): (p: unknown) => unknown | Promise<unknown> {
  const def = defs.find((d) => d.channel === channel);
  if (!def) throw new Error(`no handler for ${channel}`);
  return def.handler;
}

describe('P4 validation experience — channels', () => {
  it('registers the read + command seams and gates the mutations on sandbox:manage', async () => {
    const sub = await subsystem();
    const byChannel = (c: string): SecureHandlerDef => sub.handlers.find((h) => h.channel === c)!;
    expect(byChannel(IpcChannel.SandboxValidationDashboard).permission).toBe('sandbox:read');
    expect(byChannel(IpcChannel.SandboxValidationRunGet).permission).toBe('sandbox:read');
    expect(byChannel(IpcChannel.SandboxValidationRun).permission).toBe('sandbox:manage');
    expect(byChannel(IpcChannel.SandboxValidationRun).audit).toBe(true);
    expect(byChannel(IpcChannel.SandboxValidationScheduleSet).permission).toBe('sandbox:manage');
  });

  it('runs a certifying pipeline and returns a full run detail with certification exports', async () => {
    const sub = await subsystem();
    const detail = (await handler(sub.handlers, IpcChannel.SandboxValidationRun)({ pipeline: 'certification' })) as ValidationRunDetail;
    expect(detail.run.pipeline).toBe('certification');
    expect(detail.run.status).toBe('passed');
    expect(detail.certification?.level).toBe('pass');
    expect(detail.regression).not.toBeNull();
    expect(detail.exports).not.toBeNull();
    expect(detail.exports?.markdown).toMatch(/Release Certification/);
    expect(detail.exports?.html).toContain('<table');
    expect(JSON.parse(detail.exports?.json ?? '{}').level).toBe('pass');

    // the same run is retrievable by id from the bounded cache
    const again = (await handler(sub.handlers, IpcChannel.SandboxValidationRunGet)({ runId: detail.run.id })) as ValidationRunDetail;
    expect(again.run.id).toBe(detail.run.id);
    expect(again.certification?.level).toBe('pass');
  });

  it('returns not_found for an unknown run id', async () => {
    const sub = await subsystem();
    const res = (await handler(sub.handlers, IpcChannel.SandboxValidationRunGet)({ runId: 'nope' })) as { error: string };
    expect(res.error).toBe('not_found');
  });

  it('non-certifying pipeline detail has a run but no certification', async () => {
    const sub = await subsystem();
    const detail = (await handler(sub.handlers, IpcChannel.SandboxValidationRun)({ pipeline: 'quick' })) as ValidationRunDetail;
    expect(detail.run.pipeline).toBe('quick');
    expect(detail.certification).toBeNull();
    expect(detail.exports).toBeNull();
  });

  it('projects a live dashboard after a run', async () => {
    const sub = await subsystem();
    await handler(sub.handlers, IpcChannel.SandboxValidationRun)({ pipeline: 'smoke' });
    const dash = (await handler(sub.handlers, IpcChannel.SandboxValidationDashboard)({})) as ValidationDashboard;
    expect(dash.history.length).toBeGreaterThan(0);
    expect(dash.panels.length).toBeGreaterThan(0);
    expect(dash.latest?.pipeline).toBe('smoke');
  });

  it('toggles a registered schedule and returns the schedule list', async () => {
    const sub = await subsystem();
    const schedules = sub.scheduler.list();
    expect(schedules.length).toBeGreaterThan(0);
    const target = schedules[0];
    const out = (await handler(sub.handlers, IpcChannel.SandboxValidationScheduleSet)({ id: target.id, enabled: true })) as ScheduledValidation[];
    expect(out.find((s) => s.id === target.id)?.enabled).toBe(true);
    const off = (await handler(sub.handlers, IpcChannel.SandboxValidationScheduleSet)({ id: target.id, enabled: false })) as ScheduledValidation[];
    expect(off.find((s) => s.id === target.id)?.enabled).toBe(false);
  });
});
