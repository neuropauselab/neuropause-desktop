/**
 * Phase 6 Stage 7 — the additive knowledge rows in the existing hub model:
 * the `knowledge` deep-link routes to the Knowledge workspace and the
 * `knowledge-hygiene` delivery source carries its human label.
 */
import { describe, expect, it } from 'vitest';
import { sectionForDeepLink, sourceLabel } from './hubModel';

describe('knowledge deep link + source label (additive rows)', () => {
  it("routes the knowledge deepLink to the existing 'knowledge' section", () => {
    expect(sectionForDeepLink('knowledge')).toBe('knowledge');
  });

  it('labels the knowledge-hygiene delivery source', () => {
    expect(sourceLabel('knowledge-hygiene')).toBe('Knowledge Hygiene');
  });

  it('Stage 6 rows are untouched', () => {
    expect(sectionForDeepLink('intelligence')).toBe('intelligence');
    expect(sourceLabel('insight-monitor')).toBe('Intelligence Monitor');
  });
});
