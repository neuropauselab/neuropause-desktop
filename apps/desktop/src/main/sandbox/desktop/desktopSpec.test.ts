/** AI Sandbox S2 — desktop scenario spec parser. */
import { describe, expect, it } from 'vitest';
import { parseDesktopSpec, isDesktopSpec } from '@neuropause/shared';

describe('parseDesktopSpec', () => {
  it('rejects non-desktop specs and empty action lists', () => {
    expect(parseDesktopSpec({ kind: 'web', actions: [] }).ok).toBe(false);
    expect(isDesktopSpec({ kind: 'desktop' })).toBe(true);
    expect(parseDesktopSpec({ kind: 'desktop', actions: [] }).ok).toBe(false);
  });

  it('validates required fields per action type', () => {
    expect(parseDesktopSpec({ kind: 'desktop', actions: [{ type: 'click' }] })).toMatchObject({ ok: false });
    expect(parseDesktopSpec({ kind: 'desktop', actions: [{ type: 'type', selector: '#x' }] })).toMatchObject({ ok: false }); // needs text
    expect(parseDesktopSpec({ kind: 'desktop', actions: [{ type: 'press' }] })).toMatchObject({ ok: false }); // needs key
    expect(parseDesktopSpec({ kind: 'desktop', actions: [{ type: 'wait' }] })).toMatchObject({ ok: false }); // needs durationMs
    expect(parseDesktopSpec({ kind: 'desktop', actions: [{ type: 'bogus' }] })).toMatchObject({ ok: false });
  });

  it('normalizes a valid spec with launch defaults', () => {
    const r = parseDesktopSpec({
      kind: 'desktop',
      actions: [
        { type: 'waitFor', selector: '[data-testid=home]' },
        { type: 'screenshot', name: 'home' },
        { type: 'assertVisible', selector: 'text=Developer' },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.launch.profile).toBe('temporary');
      expect(r.value.launch.timeoutMs).toBe(30_000);
      expect(r.value.actions).toHaveLength(3);
    }
  });

  it('honors an explicit persistent launch profile', () => {
    const r = parseDesktopSpec({ kind: 'desktop', launch: { profile: 'persistent', profileKey: 'ci' }, actions: [{ type: 'press', key: 'Enter' }] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.launch).toMatchObject({ profile: 'persistent', profileKey: 'ci' });
  });
});
