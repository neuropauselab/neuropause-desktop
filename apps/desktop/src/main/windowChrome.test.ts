/**
 * P13C ROUND 25 — W-2. WINDOWS DOES NOT IGNORE `titleBarStyle`.
 *
 * `createMainWindow` set `titleBarStyle: 'hiddenInset'` unconditionally under a
 * comment claiming it was "Ignored on other platforms". Three of the four
 * options in that block genuinely are macOS-only no-ops; `titleBarStyle` is not.
 * Electron honours it on Windows, where `hiddenInset` degrades to `hidden` —
 * producing a window with no system title bar and no close, minimise or
 * maximise controls, because the app draws its own set only for the inset-macOS
 * layout and `titleBarOverlay` was never configured.
 *
 * Asserted against the extracted decision rather than a real BrowserWindow, so
 * this runs in the node suite with no Electron runtime — the same reason every
 * other platform decision in this codebase is a pure function.
 */
import { describe, expect, it } from 'vitest';
import { macOsChromeOptions } from './windowChrome';

describe('W-2 — macOS window chrome is applied only on macOS', () => {
  it('macOS keeps the inset traffic lights and the vibrancy material', () => {
    expect(macOsChromeOptions('darwin')).toEqual({
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 18, y: 18 },
      vibrancy: 'under-window',
      visualEffectState: 'active',
    });
  });

  it('Windows gets a normal frame — no titleBarStyle at all', () => {
    const opts = macOsChromeOptions('win32');
    expect(opts).toEqual({});
    // Stated separately from the toEqual because THIS is the defect: an
    // undefined titleBarStyle is a standard Windows frame; 'hiddenInset' is a
    // window the user cannot close.
    expect(opts.titleBarStyle).toBeUndefined();
  });

  it('Linux gets a normal frame too', () => {
    expect(macOsChromeOptions('linux')).toEqual({});
  });

  it('an unknown platform fails toward the standard frame, never toward hidden chrome', () => {
    // Fail-closed for chrome means: if we cannot prove it is macOS, give the OS
    // its own decorations. A frameless window on an unrecognised platform is
    // unrecoverable for the user; a plain title bar is merely plain.
    for (const platform of ['aix', 'freebsd', 'openbsd', 'sunos', 'android'] as NodeJS.Platform[]) {
      expect(macOsChromeOptions(platform)).toEqual({});
    }
  });
});
