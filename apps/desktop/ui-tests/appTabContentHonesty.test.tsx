/**
 * WHOLE-PRODUCT AUDIT (2026-08-31) — UI-truth on the Workspace app-tab canvas.
 *
 * The one shipped non-preview surface where copy outran reality: the capability
 * cards described Phase-4 (not-yet-live) features in the PRESENT tense ("Run the
 * app in an embedded, signed-in session", "flows into your timeline", "stays
 * searchable"), directly beneath a disclosure that those features "arrive with
 * Connectors in Phase 4." The fix frames the cards as upcoming. These pin that:
 * the Phase-4 disclosure is present, the grid is captioned as planned, and no
 * card presents a not-yet-live feature as a current capability.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { AppTabContent } from '@renderer/views/workspace/AppTabContent';
import type { WorkspaceTab } from '@renderer/state/ShellProvider';

const TAB: WorkspaceTab = { id: 'tab-1', appId: 'some-app', title: 'Some App' };

afterEach(() => cleanup());

describe('AppTabContent — UI-truth for the Phase-4 canvas', () => {
  it('discloses that embedded sessions arrive with Connectors in Phase 4', () => {
    render(<AppTabContent tab={TAB} />);
    expect(screen.getByText(/arrive with/i)).toBeTruthy();
    expect(screen.getByText(/Connectors in Phase 4/i)).toBeTruthy();
  });

  it('frames the capability cards as PLANNED, not present capability', () => {
    render(<AppTabContent tab={TAB} />);
    // The grid caption marks the whole set as upcoming.
    expect(screen.getByText(/Planned for this canvas/i)).toBeTruthy();
    // Forward-looking bodies (the fix) …
    expect(screen.getByText(/will run the app in an embedded/i)).toBeTruthy();
    // … and NOT the old present-tense overclaims.
    expect(screen.queryByText('Run the app in an embedded, signed-in session.')).toBeNull();
    expect(screen.queryByText('Everything stays searchable in AI Memory.')).toBeNull();
  });

  it('does not present a live "Connected" badge in a packaged (non-dev) build', () => {
    // The Connected badge is DEV-only; a fresh tab renders "Not connected".
    render(<AppTabContent tab={TAB} />);
    expect(screen.getByText(/not connected/i)).toBeTruthy();
  });
});
