/**
 * P12 — Developer Center presentation-mapping tests.
 */
import { describe, expect, it } from 'vitest';
import {
  healthTone,
  listingStatusTone,
  sdkLangLabel,
  sdkStatusLabel,
  sdkStatusTone,
  templateIcon,
  tierLabel,
  utilizationTone,
  visibilityTone,
} from './developerCenterModel';

describe('developerCenterModel', () => {
  it('maps console health and SDK status', () => {
    expect(healthTone('healthy')).toBe('green');
    expect(healthTone('attention')).toBe('orange');
    expect(sdkStatusTone('available')).toBe('green');
    expect(sdkStatusTone('planned')).toBe('gray');
    expect(sdkStatusLabel('beta')).toBe('Beta');
    expect(sdkLangLabel('dotnet')).toBe('.NET');
  });

  it('maps API visibility, listing status, templates, tier, and utilization', () => {
    expect(visibilityTone('public')).toBe('green');
    expect(visibilityTone('private')).toBe('gray');
    expect(listingStatusTone('published')).toBe('green');
    expect(listingStatusTone('in_review')).toBe('orange');
    expect(listingStatusTone('rejected')).toBe('red');
    expect(templateIcon('worker')).toBe('cpu');
    expect(tierLabel('enterprise')).toBe('Enterprise');
    expect(utilizationTone(95)).toBe('red');
    expect(utilizationTone(40)).toBe('green');
  });
});
