/**
 * Constitutional Settings v1.0 — Startup Experience Policy tests. Locks: the resolver validates against the
 * real section registry, honors each mode, respects an optional permission predicate, and — critically —
 * NEVER returns an ineligible/errored destination; a hidden/removed/forbidden target always redirects down
 * the safe fallback chain.
 */
import { describe, expect, it } from 'vitest';
import { SECTIONS } from './sections';
import { isStartupEligible, resolveStartupSection, startupSectionChoices, STARTUP_FALLBACK_CHAIN } from './startupPolicy';

const ctx = (over: Partial<Parameters<typeof resolveStartupSection>[0]> = {}): Parameters<typeof resolveStartupSection>[0] => ({
  mode: 'resume', configuredSection: null, lastSection: null, hasUnfinishedWork: false, ...over,
});

describe('isStartupEligible', () => {
  it('accepts a real visible section, rejects hidden/unknown/null', () => {
    expect(isStartupEligible('intent-home')).toBe(true);
    expect(isStartupEligible('home')).toBe(false); // hidden/retired
    expect(isStartupEligible('decision-center')).toBe(false); // hidden
    expect(isStartupEligible('nope')).toBe(false);
    expect(isStartupEligible(null)).toBe(false);
  });
});

describe('startupSectionChoices', () => {
  it('offers only real, visible, primary sections', () => {
    const choices = startupSectionChoices();
    expect(choices).toContain('intent-home');
    expect(choices).toContain('organization');
    expect(choices).not.toContain('home'); // hidden
    expect(choices).not.toContain('settings'); // footer, not primary
    for (const id of choices) expect(SECTIONS.some((s) => s.id === id && !s.hidden && s.placement === 'primary')).toBe(true);
  });
});

describe('resolveStartupSection', () => {
  it('resume mode returns the last visible section, else falls back', () => {
    expect(resolveStartupSection(ctx({ mode: 'resume', lastSection: 'organization' }))).toBe('organization');
    expect(resolveStartupSection(ctx({ mode: 'resume', lastSection: 'home' }))).toBe('intent-home'); // hidden → fallback
    expect(resolveStartupSection(ctx({ mode: 'resume', lastSection: null }))).toBe('intent-home');
  });

  it('section mode opens the chosen visible section, else falls back (never errors)', () => {
    expect(resolveStartupSection(ctx({ mode: 'section', configuredSection: 'workforce' }))).toBe('workforce');
    expect(resolveStartupSection(ctx({ mode: 'section', configuredSection: 'decision-center' }))).toBe('intent-home'); // hidden → fallback
    expect(resolveStartupSection(ctx({ mode: 'section', configuredSection: 'deleted-section' }))).toBe('intent-home'); // removed → fallback
  });

  it('smart mode resumes unfinished work, else opens Today’s Intent', () => {
    expect(resolveStartupSection(ctx({ mode: 'smart', hasUnfinishedWork: true }))).toBe('workspace');
    expect(resolveStartupSection(ctx({ mode: 'smart', hasUnfinishedWork: false }))).toBe('intent-home');
  });

  it('respects a permission predicate and walks the fallback chain past forbidden targets', () => {
    // user cannot access intent-home or organization → next eligible in chain is workspace
    const canAccess = (id: string): boolean => id !== 'intent-home' && id !== 'organization';
    expect(resolveStartupSection(ctx({ mode: 'section', configuredSection: 'intent-home', canAccess }))).toBe('workspace');
  });

  it('ALWAYS returns a real, visible section (never throws, never lands on a hidden/unknown page)', () => {
    const cases = [
      ctx({ mode: 'resume', lastSection: 'home' }),
      ctx({ mode: 'section', configuredSection: 'totally-fake' }),
      ctx({ mode: 'smart', hasUnfinishedWork: true }),
      ctx({ mode: 'section', configuredSection: 'notifications', canAccess: () => true }),
    ];
    for (const c of cases) {
      const r = resolveStartupSection(c);
      expect(SECTIONS.some((s) => s.id === r && !s.hidden)).toBe(true);
    }
  });

  it('the fallback chain is made entirely of real, visible sections', () => {
    for (const id of STARTUP_FALLBACK_CHAIN) expect(SECTIONS.some((s) => s.id === id && !s.hidden)).toBe(true);
  });
});
