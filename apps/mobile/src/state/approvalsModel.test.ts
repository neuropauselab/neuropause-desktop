/**
 * Mobile M1-10 — pure tests for the Approvals view-model.
 */
import { describe, expect, it } from 'vitest';
import type { CompanionApprovalItem } from '@neuropause/shared';
import { colors } from '../theme/tokens';
import { actIntent, approvalKey, groupByModule, statusToneColor } from './approvalsModel';

const item = (over: Partial<CompanionApprovalItem> = {}): CompanionApprovalItem => ({
  moduleId: 'finance-vendor-bills',
  moduleTitle: 'Vendor Bills',
  id: 'vb1',
  title: 'Acme Corp — $12,400',
  status: 'pending',
  statusLabel: 'Pending',
  statusTone: 'orange',
  fields: [{ label: 'Vendor', value: 'Acme Corp' }],
  createdAt: '2026-08-07T09:00:00.000Z',
  approve: { action: 'approve', reasonField: null, reasonRequired: false },
  reject: { action: 'reject', reasonField: 'rejectionReason', reasonRequired: true },
  ...over,
});

describe('approvalsModel', () => {
  it('builds a stable composite key', () => {
    expect(approvalKey({ moduleId: 'm', id: 'x' })).toBe('m:x');
  });

  it('groups by module preserving first-seen order', () => {
    const groups = groupByModule([
      item({ moduleId: 'a', moduleTitle: 'A', id: '1' }),
      item({ moduleId: 'b', moduleTitle: 'B', id: '2' }),
      item({ moduleId: 'a', moduleTitle: 'A', id: '3' }),
    ]);
    expect(groups.map((g) => g.moduleId)).toEqual(['a', 'b']);
    expect(groups[0].items.map((i) => i.id)).toEqual(['1', '3']);
    expect(groups[1].items).toHaveLength(1);
  });

  it('resolves an approve with no reason required', () => {
    expect(actIntent(item(), 'approve')).toEqual({
      available: true,
      action: 'approve',
      needsReason: false,
      reasonMissing: false,
    });
  });

  it('flags a reason-required reject as missing until text is supplied', () => {
    expect(actIntent(item(), 'reject')).toMatchObject({ needsReason: true, reasonMissing: true });
    expect(actIntent(item(), 'reject', '  ')).toMatchObject({ reasonMissing: true });
    expect(actIntent(item(), 'reject', 'over budget')).toMatchObject({
      needsReason: true,
      reasonMissing: false,
      action: 'reject',
    });
  });

  it('marks an unavailable action', () => {
    expect(actIntent(item({ approve: null }), 'approve')).toEqual({
      available: false,
      action: null,
      needsReason: false,
      reasonMissing: false,
    });
  });

  it('maps status tones to colours, falling back to muted', () => {
    expect(statusToneColor('green')).toBe(colors.bands.healthy);
    expect(statusToneColor('orange')).toBe(colors.bands.watch);
    expect(statusToneColor('red')).toBe(colors.danger);
    expect(statusToneColor('blue')).toBe(colors.accent);
    expect(statusToneColor('purple')).toBe(colors.categorical[6]);
    expect(statusToneColor(null)).toBe(colors.muted);
    expect(statusToneColor('chartreuse')).toBe(colors.muted);
  });
});
