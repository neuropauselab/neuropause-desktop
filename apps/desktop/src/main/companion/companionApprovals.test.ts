/**
 * Mobile M1-05 — the approvals inbox aggregator. Locks: only pending-status
 * records surface, deleted records never do, an action is offered only when the
 * module declares it (fail-safe against config drift), reason-required actions
 * carry their flag, summary fields resolve to descriptor labels, and items sort
 * oldest-waiting-first.
 */
import { describe, expect, it } from 'vitest';
import type { EnterpriseEntity, EnterpriseModuleSummary } from '@neuropause/shared';
import {
  APPROVAL_SOURCES,
  buildApprovalInbox,
  resolveApprovalAction,
  type ApprovalSource,
} from './companionApprovals';

function summary(
  id: string,
  opts: {
    actions?: string[];
    statusOptions?: { value: string; label: string; tone?: string }[];
    fields?: { key: string; label: string }[];
  } = {},
): EnterpriseModuleSummary {
  return {
    id,
    title: id,
    actions: (opts.actions ?? ['approve', 'reject']).map((key) => ({ key, label: key })),
    fields: [
      { key: 'status', type: 'select', label: 'Status', options: opts.statusOptions ?? [] },
      ...(opts.fields ?? []).map((f) => ({ ...f, type: 'text' })),
    ],
  } as unknown as EnterpriseModuleSummary;
}

function rec(
  id: string,
  status: string,
  fields: Record<string, unknown> = {},
  createdAt = '2026-08-07T00:00:00.000Z',
): EnterpriseEntity {
  return {
    id,
    status: 'active',
    title: id,
    createdAt,
    fields: { status, ...fields },
  } as unknown as EnterpriseEntity;
}

const LEAVE: ApprovalSource = {
  moduleId: 'hr-leave-requests',
  pending: ['pending'],
  summaryFields: ['employeeName'],
  approve: { action: 'approve', reasonField: null, reasonRequired: false },
  reject: { action: 'reject', reasonField: null, reasonRequired: false },
};

describe('buildApprovalInbox', () => {
  it('surfaces only pending, non-deleted records with resolved labels + actions', () => {
    const summaries = new Map([
      [
        'hr-leave-requests',
        summary('hr-leave-requests', {
          statusOptions: [
            { value: 'pending', label: 'Pending', tone: 'blue' },
            { value: 'approved', label: 'Approved', tone: 'green' },
          ],
          fields: [{ key: 'employeeName', label: 'Name' }],
        }),
      ],
    ]);
    const records = new Map([
      [
        'hr-leave-requests',
        [
          rec('a', 'pending', { employeeName: 'Ada' }),
          rec('b', 'approved', { employeeName: 'Grace' }), // decided — excluded
          {
            ...rec('c', 'pending', { employeeName: 'Kay' }),
            status: 'deleted',
          } as EnterpriseEntity,
        ],
      ],
    ]);
    const items = buildApprovalInbox([LEAVE], summaries, records);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      moduleId: 'hr-leave-requests',
      id: 'a',
      status: 'pending',
      statusLabel: 'Pending',
      statusTone: 'blue',
      fields: [{ label: 'Name', value: 'Ada' }],
    });
    expect(items[0].approve?.action).toBe('approve');
    expect(items[0].reject?.action).toBe('reject');
  });

  it('does not offer an action the module does not declare (fail-safe)', () => {
    const summaries = new Map([
      [
        'hr-leave-requests',
        summary('hr-leave-requests', {
          actions: ['approve'],
          statusOptions: [{ value: 'pending', label: 'Pending' }],
        }),
      ],
    ]);
    const records = new Map([['hr-leave-requests', [rec('a', 'pending')]]]);
    const items = buildApprovalInbox([LEAVE], summaries, records);
    expect(items[0].approve).not.toBeNull();
    expect(items[0].reject).toBeNull(); // reject not declared → not offered
  });

  it('skips a module that is not registered', () => {
    expect(buildApprovalInbox([LEAVE], new Map(), new Map())).toEqual([]);
  });

  it('sorts oldest-waiting first across modules', () => {
    const summaries = new Map([
      [
        'hr-leave-requests',
        summary('hr-leave-requests', { statusOptions: [{ value: 'pending', label: 'Pending' }] }),
      ],
    ]);
    const records = new Map([
      [
        'hr-leave-requests',
        [
          rec('new', 'pending', {}, '2026-08-07T10:00:00.000Z'),
          rec('old', 'pending', {}, '2026-08-01T10:00:00.000Z'),
        ],
      ],
    ]);
    const items = buildApprovalInbox([LEAVE], summaries, records);
    expect(items.map((i) => i.id)).toEqual(['old', 'new']);
  });
});

describe('resolveApprovalAction', () => {
  it('resolves approve/reject with reason fields and rejects unknowns', () => {
    expect(resolveApprovalAction('executive-decisions', 'approve')).toEqual({
      kind: 'approve',
      reasonField: 'approvalReason',
    });
    expect(resolveApprovalAction('executive-decisions', 'reject')).toEqual({
      kind: 'reject',
      reasonField: 'rejectionReason',
    });
    expect(resolveApprovalAction('finance-vendor-bills', 'reject')).toBeNull(); // no reject
    expect(resolveApprovalAction('not-a-module', 'approve')).toBeNull();
  });
});

describe('APPROVAL_SOURCES integrity', () => {
  it('every source uses approve/reject keys and unique module ids', () => {
    const ids = APPROVAL_SOURCES.map((s) => s.moduleId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of APPROVAL_SOURCES) {
      if (s.approve) expect(s.approve.action).toBe('approve');
      if (s.reject) expect(s.reject.action).toBe('reject');
      expect(s.pending.length).toBeGreaterThan(0);
    }
  });
});
