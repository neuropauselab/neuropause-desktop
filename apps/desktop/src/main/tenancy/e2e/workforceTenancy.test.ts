/**
 * PROGRAM 13C ROUND 2 — H3: workforce jobs, proposals, approval and audit.
 *
 * THE FINDING THAT MATTERS HERE IS NOT A READ.
 *
 * `Job` had no owner and `JobStore.get()` took a bare id. That made every job's
 * summary, evidence, logs and proposals readable across tenants — bad enough.
 * But `WorkerRuntime.decide()` resolves the job through that same `get()`
 * before approving a proposal, and an approved proposal RE-ENTERS THE EXECUTE
 * ENGINE. So one tenant could cause another tenant's action to EXECUTE.
 *
 * The most important assertions in this file are therefore not `toBeNull()` on
 * a read — they are the ones proving that a cross-tenant approval produces NO
 * execution: no dispatch, no session, no side effect.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Job, TenantScope, WorkforceAuditEntry } from '@neuropause/shared';
import { JobStore } from '../../workforce/runtime/jobStore';
import { AuditLog } from '../../workforce/governance/auditLog';
import { MARKER_A, MARKER_B, TENANT_A, TENANT_B } from './twoTenantFixture';

const NOW = '2026-08-11T12:00:00.000Z';

let scope: TenantScope | null = TENANT_A;
let dir: string;
let jobs: JobStore;
let audit: AuditLog;

beforeEach(async () => {
  dir = join(tmpdir(), `np-wf-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  jobs = new JobStore(join(dir, 'jobs.json')).bindScope(() => scope);
  audit = new AuditLog(join(dir, 'audit.json')).bindScope(() => scope);
  await jobs.load();
  await audit.load();
  scope = TENANT_A;
});

afterEach(async () => {
  await jobs.flush().catch(() => {});
  await audit.flush().catch(() => {});
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
});

function job(id: string, marker: string, over: Partial<Job> = {}): Job {
  return {
    id,
    workerId: 'worker:ops',
    workerRole: 'operations',
    skillId: 'skill',
    status: 'awaiting_approval',
    input: {},
    requestedBy: marker,
    summary: `Summary ${marker}`,
    evidence: [{ kind: 'entity', id: marker }],
    proposals: [
      {
        id: `prop-${id}`,
        title: `Proposal ${marker}`,
        verdict: { decision: 'require_approval', reasons: [marker] },
        approval: null,
      },
    ],
    logs: [{ at: NOW, level: 'info', message: marker }],
    error: null,
    grounded: true,
    createdAt: NOW,
    startedAt: NOW,
    finishedAt: null,
    durationMs: null,
    ...over,
  } as unknown as Job;
}

function auditEntry(id: string, marker: string): WorkforceAuditEntry {
  return {
    id,
    at: NOW,
    workerId: 'worker:ops',
    workerRole: 'operations',
    skillId: 'skill',
    requestId: marker,
    decision: 'require_approval',
    reasons: [marker],
  } as unknown as WorkforceAuditEntry;
}

function seedBoth(): void {
  scope = TENANT_A;
  jobs.put(job('job-a', MARKER_A));
  audit.record(auditEntry('aud-a', MARKER_A));
  scope = TENANT_B;
  jobs.put(job('job-b', MARKER_B));
  audit.record(auditEntry('aud-b', MARKER_B));
}

/* ── Reads ──────────────────────────────────────────────────────────────── */

describe('H3 — job reads are per tenant', () => {
  it('A pages only A’s jobs; B only B’s', () => {
    seedBoth();
    scope = TENANT_A;
    const page = jobs.page({ limit: 100 });
    expect(page.jobs.map((j) => j.id)).toEqual(['job-a']);
    expect(page.total).toBe(1);
    expect(JSON.stringify(page)).not.toContain(MARKER_B);
  });

  it('A cannot GET B’s job by id — and vice versa', () => {
    seedBoth();
    scope = TENANT_A;
    expect(jobs.get('job-b')).toBeNull();
    scope = TENANT_B;
    expect(jobs.get('job-a')).toBeNull();
  });

  it('a foreign id and an invented id are indistinguishable', () => {
    seedBoth();
    scope = TENANT_A;
    expect(jobs.get('job-b')).toEqual(jobs.get('job-invented'));
  });

  /** `summary`, `evidence` and `logs` are the worker's output over tenant data. */
  it('never leaks B’s summary, evidence or logs into A’s page', () => {
    seedBoth();
    scope = TENANT_A;
    const blob = JSON.stringify(jobs.page({ limit: 100 }));
    expect(blob).toContain(MARKER_A);
    expect(blob).not.toContain(MARKER_B);
  });

  it('worker and status filters narrow WITHIN the tenant, never across it', () => {
    seedBoth();
    scope = TENANT_A;
    // The same workerId exists in both tenants; filtering by it must not widen.
    expect(jobs.page({ workerId: 'worker:ops' }).jobs.map((j) => j.id)).toEqual(['job-a']);
    expect(jobs.page({ status: 'awaiting_approval' }).jobs.map((j) => j.id)).toEqual(['job-a']);
  });

  it('size() is per tenant, not an install total', () => {
    seedBoth();
    scope = TENANT_A;
    expect(jobs.size()).toBe(1);
    scope = TENANT_B;
    expect(jobs.size()).toBe(1);
  });
});

/* ── Writes and the approval gate ───────────────────────────────────────── */

describe('H3 — the approval gate', () => {
  /**
   * The gate itself. `decide()` resolves through `jobs.get(jobId)`, so a
   * foreign job id is "not found" and approval never happens — which is what
   * stops the ExecuteEngine re-entry at its root rather than at each caller.
   */
  it('A cannot resolve B’s job, so A cannot approve B’s proposal', () => {
    seedBoth();
    scope = TENANT_A;
    const target = jobs.get('job-b');
    expect(target).toBeNull();
  });

  /**
   * The consequence, asserted directly: a cross-tenant approval attempt
   * produces NO dispatch. This models `decide()` — resolve, then act — so the
   * assertion is about the sequence, not just the lookup.
   */
  it('a cross-tenant approval dispatches NOTHING to the execute engine', () => {
    seedBoth();
    const dispatched: string[] = [];
    const approve = (jobId: string): boolean => {
      const j = jobs.get(jobId); // the scoped resolve `decide()` performs
      if (!j) return false;
      const proposal = j.proposals[0];
      if (!proposal) return false;
      proposal.approval = { decision: 'approved', decidedBy: 'attacker', decidedAt: NOW, note: null };
      dispatched.push(jobId); // stands in for ExecuteEngine re-entry
      return true;
    };

    scope = TENANT_A;
    expect(approve('job-b')).toBe(false);
    expect(dispatched).toEqual([]); // NO execution session, NO side effect

    scope = TENANT_B;
    expect(jobs.get('job-b')!.proposals[0]!.approval).toBeNull(); // untouched
  });

  it('a tenant CAN approve its own — the gate is not simply "no"', () => {
    seedBoth();
    scope = TENANT_A;
    const own = jobs.get('job-a');
    expect(own).not.toBeNull();
    expect(own!.proposals[0]!.verdict.decision).toBe('require_approval');
  });

  /** `put` is the runtime's writeback, so an unchecked replace is a hijack. */
  it('A cannot OVERWRITE B’s job by re-using its id', () => {
    seedBoth();
    scope = TENANT_A;
    jobs.put(job('job-b', 'HIJACKED', { status: 'succeeded' }));
    scope = TENANT_B;
    const b = jobs.get('job-b')!;
    expect(b.status).toBe('awaiting_approval');
    expect(b.requestedBy).toBe(MARKER_B);
  });

  it('an unresolved caller reads nothing and cannot write', () => {
    seedBoth();
    scope = null;
    expect(jobs.page({ limit: 100 }).jobs).toEqual([]);
    expect(jobs.get('job-a')).toBeNull();
    expect(() => jobs.put(job('orphan', 'X'))).toThrow(/no owner/i);
  });
});

/* ── Governance audit ───────────────────────────────────────────────────── */

describe('H3 — the governance audit trail', () => {
  it('A reads only A’s audit entries', () => {
    seedBoth();
    scope = TENANT_A;
    const page = audit.page({ limit: 100 });
    expect(page.entries.map((e) => e.id)).toEqual(['aud-a']);
    expect(JSON.stringify(page)).not.toContain(MARKER_B);
  });

  it('is symmetric', () => {
    seedBoth();
    scope = TENANT_B;
    expect(audit.page({ limit: 100 }).entries.map((e) => e.id)).toEqual(['aud-b']);
  });

  /**
   * The chain is order-sensitive, so the OUTPUT is filtered and the array never
   * is. Integrity must therefore still verify across BOTH tenants' entries —
   * that is the property the log exists for, and a per-tenant chain would be a
   * weaker claim.
   */
  it('scoping the output does not break the tamper-evident chain', () => {
    seedBoth();
    expect(audit.verifyIntegrity().ok).toBe(true);
    expect(audit.ownershipCounts()).toEqual({ total: 2, assigned: 2, unresolved: 0 });
  });

  it('an unresolved caller reads no audit at all', () => {
    seedBoth();
    scope = null;
    expect(audit.page({ limit: 100 }).entries).toEqual([]);
  });
});

/* ── Retention ──────────────────────────────────────────────────────────── */

describe('H3 — retention cannot destroy another tenant’s evidence', () => {
  /**
   * `Job.evidence` is exactly that — evidence. The cap was install-wide and
   * oldest-first, so a busy tenant did not merely consume capacity, it chose
   * which of another tenant's records was destroyed.
   */
  it('a busy tenant does not evict the other tenant’s jobs', () => {
    scope = TENANT_B;
    jobs.put(job('b-first', MARKER_B)); // the OLDEST row on the install
    scope = TENANT_A;
    for (let i = 0; i < 60; i += 1) jobs.put(job(`a-${i}`, MARKER_A));

    scope = TENANT_B;
    expect(jobs.get('b-first')).not.toBeNull();
    expect(jobs.page({ limit: 100 }).jobs.map((j) => j.id)).toEqual(['b-first']);
  });
});
