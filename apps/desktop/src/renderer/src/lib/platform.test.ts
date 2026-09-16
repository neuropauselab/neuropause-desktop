/**
 * P13C GATE 19 — the renderer's macOS detection, both branches pinned.
 *
 * `isMacPlatform` decides the chrome layout (the inset traffic-light gutter on
 * macOS vs the standard OS frame elsewhere). It is a pure function of an
 * injectable string precisely so both branches are testable without stubbing
 * globals — but nothing exercised them until now.
 */
import { describe, expect, it } from 'vitest';
import { isMacPlatform } from './platform';

describe('P13C Gate 19 — isMacPlatform', () => {
  it('is TRUE for macOS navigator.platform values (the traffic-light gutter branch)', () => {
    expect(isMacPlatform('MacIntel')).toBe(true);
    expect(isMacPlatform('MacArm')).toBe(true);
    expect(isMacPlatform('Mac')).toBe(true);
  });

  it('is FALSE for Windows/Linux and for an unknown/empty platform (standard OS frame)', () => {
    expect(isMacPlatform('Win32')).toBe(false);
    expect(isMacPlatform('Linux x86_64')).toBe(false);
    expect(isMacPlatform('')).toBe(false);
  });
});
