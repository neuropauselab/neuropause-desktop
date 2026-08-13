/**
 * Mobile M1-11 — pure tests for the Search view-model.
 */
import { describe, expect, it } from 'vitest';
import type { CompanionSearchHit } from '@neuropause/shared';
import { groupBySource } from './searchModel';

const hit = (id: string, source: string): CompanionSearchHit => ({
  id,
  source,
  kind: 'doc',
  title: `hit ${id}`,
  snippet: null,
  timestamp: null,
});

describe('searchModel', () => {
  it('groups hits by source preserving first-seen order', () => {
    const groups = groupBySource([hit('1', 'Notion'), hit('2', 'Slack'), hit('3', 'Notion')]);
    expect(groups.map((g) => g.source)).toEqual(['Notion', 'Slack']);
    expect(groups[0].hits.map((h) => h.id)).toEqual(['1', '3']);
    expect(groups[1].hits).toHaveLength(1);
  });

  it('returns [] for no hits', () => {
    expect(groupBySource([])).toEqual([]);
  });
});
