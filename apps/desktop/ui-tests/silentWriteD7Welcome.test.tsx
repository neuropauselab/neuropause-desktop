/**
 * D-7 — A REFUSED WRITE ON THE WELCOME VIEW IS VISIBLE.
 *
 * The gate's register named `WelcomeView:75` as one of the six remaining silent
 * write paths. The catch has since drifted to `restartTour` (the content is
 * unchanged), and reading the file found a SECOND site of the same shape that the
 * register never listed — `complete()`, the checklist's own "mark done" write —
 * plus the pilot toggle.
 *
 * The defect: `ipc.onboarding.reset()` / `completeStep()` reject, the catch logs
 * to the renderer console and returns, `setBusy(false)` un-greys the button, and
 * NOTHING is said. The checklist is unchanged — correctly, since `setStatus`
 * never ran — so the screen is indistinguishable from "nothing happened". A user
 * who clicks "Restart tour" believes the tour is reset; it is not, and the
 * audited write never landed.
 *
 * WHY REUSING `statusError` WOULD HAVE BEEN A FAKE FIX. That state means "the
 * checklist could not be LOADED" and renders inside the
 * `{status ? … : statusError !== null ? … }` ternary — i.e. only when there is no
 * checklist. A failed write happens while the checklist IS showing, so that arm is
 * never reached and the message would have rendered nowhere. The fix adds a
 * separate action channel with a slot that is evaluated unconditionally.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { route, clearRoutes } from './setup';
import { IpcChannel, type OnboardingStatus } from '@neuropause/shared';

vi.mock('@renderer/state/ShellProvider', () => ({
  useShell: () => ({ setSection: vi.fn() }),
}));

import { WelcomeView } from '@renderer/views/WelcomeView';

/** A loaded checklist, so the view is in its normal state — not its error state. */
const checklist = (): OnboardingStatus => ({
  firstRun: false,
  startedAt: '2026-01-01T00:00:00.000Z',
  completedAt: null,
  steps: [
    { id: 'welcome', title: 'Welcome to NeuroPause', description: 'A quick tour.', completedAt: null },
  ],
  nextStep: 'welcome',
});

beforeEach(() => {
  cleanup();
  clearRoutes();
  route(IpcChannel.OnboardingStatus, () => checklist());
  route(IpcChannel.PilotStatus, () => null);
});

describe('WelcomeView — a refused write speaks (D-7)', () => {
  it('a failed "Restart tour" says so, instead of looking like nothing happened', async () => {
    let calls = 0;
    route(IpcChannel.OnboardingReset, () => {
      calls += 1;
      throw new Error('onboarding store unavailable');
    });
    render(<WelcomeView />);
    // Wait for the checklist to load, so we are in the success state and any
    // alert we then find can only have come from the write.
    await screen.findByText('Welcome to NeuroPause');
    expect(screen.queryByRole('alert')).toBeNull();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Restart tour' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/could not be restarted/i);
    // The write really was attempted — the message is not decorative.
    expect(calls).toBe(1);
    // And it tells the truth about state: the reset did not happen.
    expect(alert.textContent).toMatch(/nothing was changed/i);
  });

  it('a failed step completion says so — the site the register never listed', async () => {
    route(IpcChannel.OnboardingCompleteStep, () => {
      throw new Error('onboarding store unavailable');
    });
    render(<WelcomeView />);
    await screen.findByText('Welcome to NeuroPause');

    const done = screen.getAllByRole('button', { name: /mark done|done/i })[0];
    await userEvent.setup().click(done);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/could not be marked done/i);
  });

  it('a write that SUCCEEDS shows no alert (the control)', async () => {
    route(IpcChannel.OnboardingReset, () => checklist());
    render(<WelcomeView />);
    await screen.findByText('Welcome to NeuroPause');

    await userEvent.setup().click(screen.getByRole('button', { name: 'Restart tour' }));

    // Give the same window the failing cases use to surface a message.
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});
