/**
 * Phase 6 Stage 5 — pure productivity builders: meeting selection + meeting
 * brief (D-4) and the descriptive Work Summary (approved addition #2). Locks
 * honesty: empty inputs ⇒ grounded:false / null; sections appear only when
 * their material exists; nothing is invented.
 */
import { describe, expect, it } from 'vitest';
import type { UnifiedEntity } from '@neuropause/shared';
import {
  buildMeetingBrief,
  buildWorkSummary,
  renderReportMaterial,
  selectMeeting,
  type MeetingPrepMaterial,
} from './productivity';

const NOW = '2026-07-31T09:00:00.000Z';

function entity(over: Partial<UnifiedEntity>): UnifiedEntity {
  return {
    id: 'u1',
    kind: 'calendar_event',
    connectorId: 'm365',
    accountId: 'a1',
    sourceId: 's1',
    createdAt: NOW,
    updatedAt: NOW,
    syncState: 'active',
    syncedAt: NOW,
    metadata: {},
    title: 'Untitled',
    url: null,
    parentId: null,
    containerId: null,
    body: null,
    status: null,
    author: null,
    timestamp: null,
    endTimestamp: null,
    labels: [],
    ...over,
  } as UnifiedEntity;
}

describe('selectMeeting', () => {
  it('picks the next upcoming meeting within 48h', () => {
    const soon = entity({ id: 'm-soon', title: 'Design sync', timestamp: '2026-07-31T10:00:00.000Z' });
    const later = entity({ id: 'm-later', title: 'Board review', timestamp: '2026-07-31T15:00:00.000Z' });
    const past = entity({ id: 'm-past', title: 'Old standup', timestamp: '2026-07-30T10:00:00.000Z' });
    expect(selectMeeting([later, past, soon], NOW, 'prepare me for my next meeting')?.id).toBe('m-soon');
  });

  it('prefers a meeting named in the request', () => {
    const soon = entity({ id: 'm-soon', title: 'Design sync', timestamp: '2026-07-31T10:00:00.000Z' });
    const board = entity({ id: 'm-board', title: 'Board review', timestamp: '2026-07-31T15:00:00.000Z' });
    expect(selectMeeting([soon, board], NOW, 'get me ready for the board review')?.id).toBe('m-board');
  });

  it('returns null when nothing is upcoming (honest miss)', () => {
    const past = entity({ id: 'm-past', title: 'Old standup', timestamp: '2026-07-30T10:00:00.000Z' });
    const far = entity({ id: 'm-far', title: 'Offsite', timestamp: '2026-08-20T10:00:00.000Z' });
    expect(selectMeeting([past, far], NOW, 'prepare me for my meeting')).toBeNull();
  });
});

describe('buildMeetingBrief', () => {
  const base: MeetingPrepMaterial = {
    meeting: { id: 'm1', title: 'Design sync', startsAt: '2026-07-31T10:00:00.000Z', organizer: 'Sam' },
    participants: [],
    related: [],
    timeline: [],
    decisions: [],
    memories: [],
  };

  it('is grounded only when material beyond the meeting record exists', () => {
    const empty = buildMeetingBrief(base);
    expect(empty.grounded).toBe(false);
    expect(empty.sections.length).toBe(1); // just the Meeting section
    const rich = buildMeetingBrief({
      ...base,
      participants: ['Sam', 'Priya'],
      related: [{ source: 'entity-search', title: 'Design doc v3' }],
      decisions: [{ title: 'Ship dark mode', status: 'proposed' }],
    });
    expect(rich.grounded).toBe(true);
    expect(rich.sections.map((s) => s.title)).toEqual([
      'Meeting',
      'Participants',
      'Related material',
      'Open decisions',
    ]);
  });

  it('renders material lines for the grounding prompt', () => {
    const rich = buildMeetingBrief({ ...base, participants: ['Sam'] });
    const material = renderReportMaterial(rich);
    expect(material).toContain('Meeting:');
    expect(material).toContain('- Design sync');
    expect(material).toContain('Participants:');
  });
});

describe('buildWorkSummary (descriptive, never a score)', () => {
  const emptyInputs = {
    nowIso: NOW,
    assistantTasks: [],
    connectorTasksCompletedToday: [],
    meetingsToday: [],
    executionsToday: [],
    automationRunsToday: [],
    jobsToday: 0,
    pendingApprovals: 0,
    conversationsToday: 0,
    connectorProblems: [],
  };

  it('produces the honest empty state on an empty day', () => {
    const s = buildWorkSummary(emptyInputs);
    expect(s.grounded).toBe(false);
    expect(s.sections).toEqual([]);
    expect(s.kind).toBe('work-summary');
  });

  it('aggregates only what actually happened, section by section', () => {
    const s = buildWorkSummary({
      ...emptyInputs,
      assistantTasks: [
        { title: 'Send deck', status: 'done', updatedAt: '2026-07-31T08:00:00.000Z' },
        { title: 'Old done', status: 'done', updatedAt: '2026-07-29T08:00:00.000Z' },
        { title: 'Review contract', status: 'open', updatedAt: NOW },
      ],
      meetingsToday: ['Design sync'],
      executionsToday: [
        { label: 'Automation: Onboarding', state: 'completed' },
        { label: 'Worker: Research', state: 'failed' },
      ],
      automationRunsToday: [{ ok: true }, { ok: false }],
      jobsToday: 2,
      pendingApprovals: 1,
      conversationsToday: 3,
      connectorProblems: [{ id: 'slack', reason: 'health degraded' }],
    });
    expect(s.grounded).toBe(true);
    const titles = s.sections.map((x) => x.title);
    expect(titles).toEqual(['Completed today', 'Meetings today', 'AI assistance', 'Still open', 'Risks & blockers']);
    const completed = s.sections[0]!.lines.join(' | ');
    expect(completed).toContain('1 assistant task(s) completed: Send deck'); // yesterday's excluded
    const open = s.sections[3]!.lines.join(' | ');
    expect(open).toContain('1 proposal(s) still waiting');
    expect(open).toContain('1 assistant task(s) still open');
    const risks = s.sections[4]!.lines.join(' | ');
    expect(risks).toContain('Connector slack');
    expect(risks).toContain('1 execution(s) failed');
    expect(risks).toContain('1 automation run(s) failed');
    // descriptive contract: no score anywhere
    expect(JSON.stringify(s)).not.toMatch(/score/i);
  });
});
