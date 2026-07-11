/** P3.0 Increment 4 — webhook subscription matching tests. */
import { describe, expect, it } from 'vitest';
import { matchesSubscription } from './matcher';

const evt = { type: 'enterprise.record.created' as const, category: 'enterprise' as const };

describe('matchesSubscription', () => {
  it('matches by category', () => {
    expect(matchesSubscription({ categories: ['enterprise'], types: [] }, evt)).toBe(true);
    expect(matchesSubscription({ categories: ['connector'], types: [] }, evt)).toBe(false);
  });

  it('matches by explicit type', () => {
    expect(matchesSubscription({ categories: [], types: ['enterprise.record.created'] }, evt)).toBe(true);
    expect(matchesSubscription({ categories: [], types: ['enterprise.record.deleted'] }, evt)).toBe(false);
  });

  it('an empty subscription is a firehose', () => {
    expect(matchesSubscription({ categories: [], types: [] }, evt)).toBe(true);
  });
});
