import { describe, expect, it } from 'vitest';
import type { Briefing, BriefingSection, BriefingSectionId } from '@neuropause/shared';
import { deriveFounderSuggestions } from './founderSuggestions';

function section(id: BriefingSectionId, empty: boolean): BriefingSection {
  return {
    id,
    title: id,
    empty,
    items: empty
      ? []
      : [
          {
            text: `${id} item`,
            detail: null,
            connectorId: 'github',
            at: null,
            evidence: [{ kind: 'event', id: 'e1' }],
          },
        ],
  };
}

function briefing(sections: BriefingSection[]): Briefing {
  return {
    period: 'morning',
    generatedAt: '2026-06-30T00:00:00.000Z',
    range: { since: 'a', until: 'b' },
    headline: 'h',
    evidenceCount: 1,
    grounded: true,
    sections,
  };
}

const texts = (qs: { text: string }[]): string[] => qs.map((q) => q.text);

describe('deriveFounderSuggestions', () => {
  it('surfaces release + engineering questions when engineering sections are populated', () => {
    const qs = deriveFounderSuggestions({ briefing: briefing([section('ci_health', false)]) });
    expect(texts(qs)).toContain("What's blocking Release 1.0?");
    expect(texts(qs)).toContain("Show today's engineering risks.");
    expect(qs.find((q) => q.intent === 'release-status')?.reason).toBeTruthy();
  });

  it('does not surface engineering questions when those sections are empty', () => {
    const qs = deriveFounderSuggestions({
      briefing: briefing([section('ci_health', true), section('meetings', false)]),
    });
    expect(texts(qs)).not.toContain("What's blocking Release 1.0?");
  });

  it('surfaces the approvals question only when pendingApprovals is provided and > 0', () => {
    const withApprovals = deriveFounderSuggestions({ briefing: briefing([]), pendingApprovals: 3 });
    expect(texts(withApprovals)).toContain('What needs my approval?');
    expect(withApprovals.find((q) => q.intent === 'approvals')?.reason).toBe('3 pending');

    const without = deriveFounderSuggestions({ briefing: briefing([]) });
    expect(texts(without)).not.toContain('What needs my approval?');
  });

  it('surfaces the worker-attention question only when workersNeedingAttention > 0', () => {
    const qs = deriveFounderSuggestions({ briefing: briefing([]), workersNeedingAttention: 2 });
    expect(texts(qs)).toContain('Which AI workers need attention?');
  });

  it('surfaces attention and activity questions from their sections', () => {
    const qs = deriveFounderSuggestions({
      briefing: briefing([section('attention', false), section('activity', false)]),
    });
    expect(texts(qs)).toContain('What needs attention right now?');
    expect(texts(qs)).toContain('What changed overnight?');
  });

  it('always offers the evergreen defaults, even with an empty briefing', () => {
    const qs = deriveFounderSuggestions({ briefing: briefing([]) });
    expect(texts(qs)).toContain('What should I work on today?');
    expect(texts(qs)).toContain("What's the biggest business risk?");
    expect(qs.every((q) => typeof q.text === 'string' && q.text.length > 0)).toBe(true);
  });

  it('dedupes by text and respects the cap', () => {
    const qs = deriveFounderSuggestions(
      {
        briefing: briefing([
          section('ci_health', false),
          section('attention', false),
          section('activity', false),
        ]),
        pendingApprovals: 1,
        workersNeedingAttention: 1,
      },
      4,
    );
    expect(qs.length).toBe(4);
    expect(new Set(texts(qs)).size).toBe(qs.length); // no duplicates
  });
});
