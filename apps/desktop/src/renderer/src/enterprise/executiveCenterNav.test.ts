import { describe, expect, it } from 'vitest';
import { deepLinkToSection } from './executiveCenterNav';
import { SECTIONS } from '@renderer/shell/sections';

describe('deepLinkToSection', () => {
  it('GUARDRAIL: every possible deep-link target resolves to a VISIBLE section (never a dead-end)', () => {
    const links = [undefined, '', 'enterprise/organization', 'enterprise/briefings', 'ai-workforce/founder', 'connectors', 'notifications', 'memory', 'settings/billing', 'analytics', 'something/unknown', 'home', 'decision-center'];
    for (const link of links) {
      const target = deepLinkToSection(link);
      expect(SECTIONS.some((s) => s.id === target && !s.hidden)).toBe(true);
    }
  });

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
    // 'analytics' is a retired/hidden section — it must resolve to a VISIBLE surface, never itself.
    expect(deepLinkToSection('analytics')).toBe('opscenter');
  });

  it('falls back to the canonical intent-home for unknown or missing links (never a hidden section, never throws)', () => {
    expect(deepLinkToSection(undefined)).toBe('intent-home');
    expect(deepLinkToSection('')).toBe('intent-home');
    expect(deepLinkToSection('something/unknown')).toBe('intent-home');
  });
});
