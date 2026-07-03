import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ActionRequest, RiskLevel, Worker, WorkerPermissionScope } from '@neuropause/shared';
import { evaluateAction, DEFAULT_POLICIES } from './policyEngine';
import { AuditLog } from './auditLog';
import { GovernanceRuntime } from './index';

const NOW = '2026-02-10T00:00:00.000Z';

function worker(trust: number, grant: WorkerPermissionScope[]): Worker {
  return {
    identity: { id: 'worker:test', name: 'Test', role: 'operations', version: '1.0.0', developer: 'neuropause' },
    goals: [],
    skills: [],
    permissions: grant.map((scope) => ({ scope, granted: true })),
    memoryScope: 'self',
    policyIds: [],
    trustScore: trust,
    lifecycle: 'idle',
    health: { state: 'healthy', lastCheckAt: NOW, successRate: 1, jobsRun: 0, jobsFailed: 0, message: null },
    createdAt: NOW,
    updatedAt: NOW,
    builtIn: true,
    metadata: {},
  };
}

function req(over: Partial<ActionRequest> = {}): ActionRequest {
  return {
    id: 'req:1',
    workerId: 'worker:test',
    workerRole: 'operations',
    skillId: 'skill',
    title: 'Do a thing',
    summary: 'summary',
    sideEffects: false,
    permissions: ['read:entities'],
    risk: 'low' as RiskLevel,
    evidence: [],
    payload: {},
    requestedAt: NOW,
    ...over,
  };
}

const ev = (worker: Worker, request: ActionRequest) =>
  evaluateAction(request, { worker, policies: DEFAULT_POLICIES, now: NOW });

describe('evaluateAction (governance decision core)', () => {
  it('allows a read-only, low-risk action', () => {
    expect(ev(worker(0.5, ['read:entities']), req()).decision).toBe('allow');
  });

  it('denies when a required permission is not granted', () => {
    const v = ev(worker(0.9, ['read:entities']), req({ permissions: ['write:memory'], sideEffects: true }));
    expect(v.decision).toBe('deny');
    expect(v.reasons.join(' ')).toContain('write:memory');
  });

  it('requires approval for a side-effecting action with no evidence', () => {
    const v = ev(
      worker(0.9, ['write:memory']),
      req({ permissions: ['write:memory'], sideEffects: true, risk: 'medium', evidence: [] }),
    );
    expect(v.decision).toBe('require_approval');
  });

  it('requires approval for high-risk actions regardless of trust', () => {
    const v = ev(
      worker(0.99, ['write:reminder']),
      req({ permissions: ['write:reminder'], sideEffects: true, risk: 'high', evidence: [{ kind: 'entity', id: 'e1' }] }),
    );
    expect(v.decision).toBe('require_approval');
  });

  it('requires approval for outbound proposals', () => {
    const v = ev(
      worker(0.9, ['propose:message']),
      req({ permissions: ['propose:message'], sideEffects: true, risk: 'medium', evidence: [{ kind: 'entity', id: 'e1' }] }),
    );
    expect(v.decision).toBe('require_approval');
  });

  it('trust-gates memory writes: low trust needs approval, high trust is allowed', () => {
    const base = req({
      permissions: ['write:memory'],
      sideEffects: true,
      risk: 'low',
      evidence: [{ kind: 'memory', id: 'm1' }],
    });
    expect(ev(worker(0.3, ['write:memory']), base).decision).toBe('require_approval');
    expect(ev(worker(0.8, ['write:memory']), base).decision).toBe('allow');
  });
});

describe('AuditLog', () => {
  const opened: AuditLog[] = [];
  const paths: string[] = [];
  const tempPath = () => {
    const p = join(tmpdir(), `nps-audit-${randomUUID()}.json`);
    paths.push(p);
    return p;
  };
  const newLog = async (p: string) => {
    const a = new AuditLog(p);
    opened.push(a);
    await a.load();
    return a;
  };
  const entry = (workerId: string, decision: 'allow' | 'deny' | 'require_approval') => ({
    id: randomUUID(),
    at: NOW,
    workerId,
    workerRole: 'operations' as const,
    skillId: 'skill',
    requestId: randomUUID(),
    decision,
    risk: 'low' as RiskLevel,
    summary: 's',
  });

  afterEach(async () => {
    await Promise.all(opened.map((a) => a.flush()));
    opened.length = 0;
    for (const p of paths) await fs.rm(p, { force: true });
    paths.length = 0;
  });

  it('records entries newest-first and filters by worker and decision', async () => {
    const a = await newLog(tempPath());
    a.record(entry('worker:a', 'allow'));
    a.record(entry('worker:b', 'deny'));
    a.record(entry('worker:a', 'require_approval'));

    const all = a.page();
    expect(all.total).toBe(3);
    expect(all.entries[0].decision).toBe('require_approval');

    expect(a.page({ workerId: 'worker:a' }).total).toBe(2);
    expect(a.page({ decision: 'deny' }).total).toBe(1);
  });

  it('persists across reloads', async () => {
    const p = tempPath();
    const a1 = await newLog(p);
    a1.record(entry('worker:a', 'allow'));
    await a1.flush();
    const a2 = await newLog(p);
    expect(a2.size()).toBe(1);
  });
});

describe('GovernanceRuntime', () => {
  it('returns a verdict and audits the decision', async () => {
    const a = new AuditLog(join(tmpdir(), `nps-gov-${randomUUID()}.json`));
    await a.load();
    const gov = new GovernanceRuntime(a);
    const v = gov.evaluate(
      req({ permissions: ['propose:draft'], sideEffects: true, risk: 'medium', evidence: [{ kind: 'entity', id: 'e1' }] }),
      worker(0.9, ['propose:draft']),
      NOW,
    );
    expect(v.decision).toBe('require_approval');
    expect(a.size()).toBe(1);
    expect(gov.auditPage().entries[0].decision).toBe('require_approval');
    await a.flush();
  });
});
