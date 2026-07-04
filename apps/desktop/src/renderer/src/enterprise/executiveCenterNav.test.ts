import { describe, expect, it } from 'vitest';
import { deepLinkToSection } from './executiveCenterNav';

describe('deepLinkToSection', () => {
  it('routes organization deep-links to the organization section', () => {
    expect(deepLinkToSection('enterprise/organization')).toBe('organization');
  });

  it('routes other enterprise deep-links to the enterprise section', () => {
    expect(deepLinkToSection('enterprise/briefings')).toBe('enterprise');
  });

  it('routes ai-workforce deep-links to the workforce section', () => {
    expect(deepLinkToSection('ai-workforce/founder')).toBe('workforce');
    expect(deepLinkToSection('ai-workforce/engineering')).toBe('workforce');
  });

  it('routes connectors / notifications / memory / settings / analytics directly', () => {
    expect(deepLinkToSection('connectors')).toBe('connectors');
    expect(deepLinkToSection('notifications')).toBe('notifications');
    expect(deepLinkToSection('memory')).toBe('memory');
    expect(deepLinkToSection('settings/billing')).toBe('settings');
    expect(deepLinkToSection('analytics')).toBe('analytics');
  });

  it('falls back to home for unknown or missing links (never throws)', () => {
    expect(deepLinkToSection(undefined)).toBe('home');
    expect(deepLinkToSection('')).toBe('home');
    expect(deepLinkToSection('something/unknown')).toBe('home');
  });
});
