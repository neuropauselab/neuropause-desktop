/**
 * D-7b · SITE 5 — A REFUSED NESTED WRITE ON THE PILOT TOGGLE SPEAKS.
 *
 * WelcomeView's "Join pilot" button calls `ipc.pilot.setEnabled(true)` and, on
 * success, chains `ipc.onboarding.completeStep('pilot')`. That nested call's
 * rejection was swallowed by `.catch(() => undefined)` (WelcomeView.tsx): the
 * pilot WAS enabled (the badge/label flipped to "On"/"Leave pilot"), but the
 * checklist step silently never landed and nothing was said — so it reappeared
 * unchecked on the next load. The fix announces the nested failure through the
 * same `actionError` role="alert" surface the screen's other writes use, with a
 * message that does NOT claim the toggle failed (it did not).
 *
 * The failure test is also the NEGATIVE CONTROL: under `.catch(() => undefined)`
 * no alert is raised, so `findByRole('alert')` times out and the test goes red.
 * (Verified by mutation: restoring the swallow → 1 fail; restored byte-identically.)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { route, clearRoutes, unroutedChannels } from './setup';
import { IpcChannel, type OnboardingStatus, type PilotStatus } from '@neuropause/shared';

vi.mock('@renderer/state/ShellProvider', () => ({
  useShell: () => ({ setSection: vi.fn() }),
}));

import { WelcomeView } from '@renderer/views/WelcomeView';

/** A loaded checklist — the view is in its normal state, not the error state. */
const checklist = (): OnboardingStatus => ({
  firstRun: false,
  startedAt: '2026-01-01T00:00:00.000Z',
  completedAt: null,
  steps: [{ id: 'welcome', title: 'Welcome to NeuroPause', description: 'A quick tour.', completedAt: null }],
  nextStep: 'welcome',
});

/** completeStep('pilot') success return — the pilot step now marked done. */
const checklistPilotDone = (): OnboardingStatus => ({
  firstRun: false,
  startedAt: '2026-01-01T00:00:00.000Z',
  completedAt: null,
  steps: [
    { id: 'welcome', title: 'Welcome to NeuroPause', description: 'A quick tour.', completedAt: null },
    { id: 'pilot', title: 'Choose pilot mode', description: 'Opt in to pilot mode.', completedAt: '2026-01-02T00:00:00.000Z' },
  ],
  nextStep: null,
});

const pilotOff: PilotStatus = { enabled: false, joinedAt: null, leftAt: null };
const pilotOn: PilotStatus = { enabled: true, joinedAt: '2026-01-02T00:00:00.000Z', leftAt: null };

beforeEach(() => {
  cleanup();
  clearRoutes();
  route(IpcChannel.OnboardingStatus, () => checklist());
  // NON-null (unlike the D-7 Welcome test) so the button is enabled and reads "Join pilot".
  route(IpcChannel.PilotStatus, () => pilotOff);
});

/**
 * "Join pilot" is the label while pilot is STILL null (button disabled) AND after
 * it loads (enabled), so findByRole alone resolves too early — wait for it to
 * actually become enabled before clicking.
 */
async function findEnabledJoinButton(): Promise<HTMLButtonElement> {
  const btn = (await screen.findByRole('button', { name: 'Join pilot' })) as HTMLButtonElement;
  await waitFor(() => expect(btn.disabled).toBe(false));
  return btn;
}

describe('WelcomeView pilot — a refused nested completeStep speaks (D-7b Site 5)', () => {
  it('a failed complete(pilot) after joining is ANNOUNCED, and tells the truth', async () => {
    let setEnabledCalls = 0;
    let completeStepCalls = 0;
    route(IpcChannel.PilotSetEnabled, () => { setEnabledCalls += 1; return pilotOn; });
    route(IpcChannel.OnboardingCompleteStep, () => { completeStepCalls += 1; throw new Error('onboarding store unavailable'); });

    render(<WelcomeView />);
    const joinBtn = await findEnabledJoinButton();
    expect(screen.queryByRole('alert')).toBeNull(); // no alert at mount (status loaded)

    await userEvent.setup().click(joinBtn);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/could not be marked done/i);        // the step failed
    expect(alert.textContent ?? '').not.toMatch(/could not be changed/i);  // the toggle did NOT fail
    expect(setEnabledCalls).toBe(1);                                        // real handlers reached
    expect(completeStepCalls).toBe(1);
    expect(screen.getByRole('button', { name: 'Leave pilot' })).toBeTruthy(); // honest: pilot IS on
  });
});

describe('WelcomeView pilot — success is preserved and not accidental (D-7b Site 5)', () => {
  it('joining succeeds, marks the step done, and raises no alert', async () => {
    let setEnabledCalls = 0;
    let completeStepCalls = 0;
    route(IpcChannel.PilotSetEnabled, () => { setEnabledCalls += 1; return pilotOn; });
    route(IpcChannel.OnboardingCompleteStep, () => { completeStepCalls += 1; return checklistPilotDone(); });

    render(<WelcomeView />);
    const joinBtn = await findEnabledJoinButton();

    await userEvent.setup().click(joinBtn);

    // setPilot ran → the button relabels; success behaviour preserved.
    expect(await screen.findByRole('button', { name: 'Leave pilot' })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(setEnabledCalls).toBe(1);
    expect(completeStepCalls).toBe(1);       // catches a wrong IpcChannel constant
    expect(unroutedChannels()).toEqual([]);  // nothing silently unrouted
  });
});
