/**
 * Enterprise Collaboration Workspace v1.0 — collaboration model tests. Lock the pure lens: the honest
 * approval-status + keyword tone maps, the collaboration-gap catalog (never empty / always reasoned /
 * presence flagged as realtime), the age/relative-time formatters, and the pure approval / workspace /
 * personal-item summaries over the real DTO shapes.
 */
import { describe, expect, it } from 'vitest';
import type { CloudTeam, PersonalizationState, WorkspaceSummary } from '@neuropause/shared';
import {
  COLLABORATION_GAPS,
  COLLABORATION_SECTION_ID,
  STALE_APPROVAL_MS,
  approvalStatusTone,
  collaborationGapKindMeta,
  collaborationStateTone,
  formatAgeMs,
  summarizeApprovals,
  summarizeMyItems,
  summarizeWorkspaces,
  timeAgo,
} from './collaborationModel';

const ws = (id: string, active: boolean, userCount: number): WorkspaceSummary =>
  ({ id, name: id, organizationId: 'o', orgName: 'Org', userCount, unitCount: 2, active } as WorkspaceSummary);
const team = (id: string, memberCount: number): CloudTeam =>
  ({ id, tenantId: 't', name: id, memberCount, createdAt: '' } as CloudTeam);
const personalization = (f: number, r: number, v: number): PersonalizationState => ({
  favorites: Array.from({ length: f }, (_, i) => ({ id: `f${i}`, kind: 'surface', label: `f${i}`, tab: 'x', addedAt: '' })),
  recents: Array.from({ length: r }, (_, i) => ({ id: `r${i}`, kind: 'surface', label: `r${i}`, tab: 'x', visitedAt: '' })),
  savedViews: Array.from({ length: v }, (_, i) => ({ id: `v${i}`, label: `v${i}`, tab: 'x', query: '', filters: '', createdAt: '' })),
});

describe('status → tone maps', () => {
  it('approval-status tone is honest across the lifecycle', () => {
    expect(approvalStatusTone('approved')).toBe('green');
    expect(approvalStatusTone('pending')).toBe('orange');
    expect(approvalStatusTone('rejected')).toBe('red');
  });

  it('keyword state tone classifies varying strings defensively', () => {
    expect(collaborationStateTone('active')).toBe('green');
    expect(collaborationStateTone('approved')).toBe('green');
    expect(collaborationStateTone('pending')).toBe('orange');
    expect(collaborationStateTone('rejected')).toBe('red');
    // negatives / neutrals that CONTAIN a positive substring must NOT read green
    expect(collaborationStateTone('inactive')).toBe('gray');
    expect(collaborationStateTone('disabled')).toBe('gray');
    expect(collaborationStateTone('declined')).toBe('red');
    expect(collaborationStateTone('archived')).toBe('gray');
    expect(collaborationStateTone('something-unknown')).toBe('gray');
    expect(collaborationStateTone(null)).toBe('gray');
  });

  it('exposes the wired section id', () => {
    expect(COLLABORATION_SECTION_ID).toBe('collaboration');
  });
});

describe('collaboration-gap catalog (honesty ledger)', () => {
  it('has the six verified-absent capabilities, each fully reasoned with a valid kind', () => {
    expect(COLLABORATION_GAPS.length).toBe(6);
    for (const g of COLLABORATION_GAPS) {
      expect(g.area.length).toBeGreaterThan(0);
      expect(g.capability.length).toBeGreaterThan(0);
      expect(g.reason.length).toBeGreaterThan(0);
      expect(['not-built', 'realtime']).toContain(g.kind);
      const meta = collaborationGapKindMeta(g.kind);
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.label.toLowerCase()).toContain('architecture');
    }
  });

  it('records comments, discussions, mentions, tasks and documents as absent, and presence as realtime', () => {
    const by = (cap: string) => COLLABORATION_GAPS.find((g) => g.capability.toLowerCase().includes(cap));
    expect(by('comments')?.kind).toBe('not-built');
    expect(by('discussion')?.kind).toBe('not-built');
    expect(by('mention')?.kind).toBe('not-built');
    expect(by('task')?.kind).toBe('not-built');
    expect(by('document')?.kind).toBe('not-built');
    expect(by('presence')?.kind).toBe('realtime');
    expect(collaborationGapKindMeta('realtime').label).toBe('Requires realtime architecture');
  });
});

describe('formatters', () => {
  it('formatAgeMs collapses to the coarsest unit and guards junk', () => {
    expect(formatAgeMs(null)).toBe('—');
    expect(formatAgeMs(0)).toBe('—');
    expect(formatAgeMs(-5)).toBe('—');
    expect(formatAgeMs(45 * 1000)).toBe('45s');
    expect(formatAgeMs(5 * 60 * 1000)).toBe('5m');
    expect(formatAgeMs(3 * 60 * 60 * 1000)).toBe('3h');
    expect(formatAgeMs(2 * 24 * 60 * 60 * 1000)).toBe('2d');
  });

  it('timeAgo is relative to the injected clock and guards unparseable input', () => {
    const now = Date.parse('2026-07-18T12:00:00.000Z');
    expect(timeAgo('2026-07-18T11:59:30.000Z', now)).toBe('30s ago');
    expect(timeAgo('2026-07-18T11:30:00.000Z', now)).toBe('30m ago');
    expect(timeAgo('2026-07-18T09:00:00.000Z', now)).toBe('3h ago');
    expect(timeAgo('2026-07-16T12:00:00.000Z', now)).toBe('2d ago');
    expect(timeAgo('not-a-date', now)).toBe('');
  });
});

describe('pure collaboration summaries', () => {
  it('summarizeApprovals folds delegated + job pending and tones by staleness', () => {
    const none = summarizeApprovals({ delegatedPending: 0, enabledChains: 2, jobPending: 0, approvedRecently: 4, rejectedRecently: 1, oldestPendingAgeMs: null });
    expect(none.totalPending).toBe(0);
    expect(none.tone).toBe('green');
    expect(none.oldestPendingLabel).toBe('—');

    const fresh = summarizeApprovals({ delegatedPending: 2, enabledChains: 1, jobPending: 3, approvedRecently: 0, rejectedRecently: 0, oldestPendingAgeMs: 60 * 60 * 1000 });
    expect(fresh.totalPending).toBe(5);
    expect(fresh.tone).toBe('orange');
    expect(fresh.oldestPendingLabel).toBe('1h');

    const stale = summarizeApprovals({ delegatedPending: 1, enabledChains: 0, jobPending: 0, approvedRecently: 0, rejectedRecently: 0, oldestPendingAgeMs: STALE_APPROVAL_MS + 1 });
    expect(stale.totalPending).toBe(1);
    expect(stale.tone).toBe('red');
  });

  it('summarizeWorkspaces counts the directory and sums users + members', () => {
    const s = summarizeWorkspaces([ws('a', true, 5), ws('b', false, 3), ws('c', true, 0)], [team('t1', 4), team('t2', 6)]);
    expect(s).toEqual({ workspaces: 3, activeWorkspaces: 2, teams: 2, workspaceUsers: 8, teamMembers: 10 });
    // empty directory (teams are empty by default) stays honest, never invented
    expect(summarizeWorkspaces([], [])).toEqual({ workspaces: 0, activeWorkspaces: 0, teams: 0, workspaceUsers: 0, teamMembers: 0 });
  });

  it('summarizeMyItems counts personal items and is null-safe', () => {
    expect(summarizeMyItems(personalization(3, 5, 2))).toEqual({ favorites: 3, recents: 5, savedViews: 2, total: 10 });
    expect(summarizeMyItems(null)).toEqual({ favorites: 0, recents: 0, savedViews: 0, total: 0 });
  });
});
