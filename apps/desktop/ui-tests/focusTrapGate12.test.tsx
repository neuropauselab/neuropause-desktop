/**
 * P13C ROUND 50 — GATE 12. THE FIVE REMAINING HAND-ROLLED OVERLAYS TRAP FOCUS.
 *
 * Round 36 gave the shared `Modal` (and the destructive-delete alertdialog) a
 * real focus trap; the audit's other hand-rolled overlays kept announcing
 * `aria-modal` while Tab walked straight out into the shell:
 *   1. the first-run takeover (`FirstRunExperience`)
 *   2. the sandbox inspector drawer (`sandbox/panels/shared` `Drawer`)
 *   3. the AI-Store install dialog (`InstallFlow` — which also never declared
 *      `role="dialog"` at all)
 *   4. the Developer Portal modal (`developer/primitives` `Modal`)
 * All now use the round-36 `useFocusTrap`; Escape closes the dismissible ones
 * through their existing close paths (parity with backdrop clicks), while the
 * first-run takeover deliberately does NOT close on Escape — it is a required
 * flow with an explicit Skip. Every suite includes the negative: focus cannot
 * escape. (Gate 13, round 58: the onboarding-wizard overlay was removed when the
 * second onboarding system was consolidated away — see AppShell.)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React, { useState } from 'react';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { route, clearRoutes } from './setup';
import { IpcChannel } from '@neuropause/shared';

import { Drawer } from '@renderer/sandbox/panels/shared';
import { Modal as DevModal } from '@renderer/developer/primitives';
import { InstallFlow } from '@renderer/store/InstallFlow';
import { FirstRunExperience } from '@renderer/firstRun/FirstRunExperience';

beforeEach(() => {
  cleanup();
  clearRoutes();
});

/** Walk Tab further than the dialog has focusables; focus must never escape. */
function assertTrapped(dialog: HTMLElement, steps = 8): void {
  for (let i = 0; i < steps; i += 1) {
    fireEvent.keyDown(document.activeElement as Element, { key: 'Tab' });
    expect(dialog.contains(document.activeElement)).toBe(true);
  }
  fireEvent.keyDown(document.activeElement as Element, { key: 'Tab', shiftKey: true });
  expect(dialog.contains(document.activeElement)).toBe(true);
}

describe('sandbox Drawer (Gate 12, round 50)', () => {
  function Harness(): JSX.Element {
    const [open, setOpen] = useState(true);
    return (
      <div>
        <button type="button">Behind the drawer</button>
        <Drawer open={open} title="Run detail" onClose={() => setOpen(false)}>
          <button type="button">First</button>
          <button type="button">Second</button>
        </Drawer>
      </div>
    );
  }

  it('traps focus and Escape closes (parity with the backdrop click)', async () => {
    render(<Harness />);
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    assertTrapped(dialog);
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('Developer Portal Modal (Gate 12, round 50)', () => {
  it('traps focus while open and restores it on close', async () => {
    function Harness(): JSX.Element {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button type="button" onClick={() => setOpen(true)}>
            Open dev modal
          </button>
          <DevModal open={open} title="API key" onClose={() => setOpen(false)}>
            <button type="button">Copy</button>
            <button type="button">Rotate</button>
          </DevModal>
        </div>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open dev modal' });
    opener.focus();
    fireEvent.click(opener);

    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    assertTrapped(dialog);

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});

describe('AI-Store InstallFlow (Gate 12, round 50)', () => {
  const APP = {
    slug: 'test-app',
    name: 'Test App',
    developer: { name: 'Acme' },
    iconTone: 'blue',
    icon: 'grid',
    permissions: [],
  } as never;

  it('finally declares role=dialog, traps focus, and Escape closes', async () => {
    let closed = 0;
    render(
      <InstallFlow app={APP} onClose={() => (closed += 1)} onInstalled={() => undefined} onLaunch={() => undefined} />,
    );
    const dialog = await screen.findByRole('dialog', { name: /Install Test App/ });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    assertTrapped(dialog);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(closed).toBe(1);
  });
});

// NOTE (Gate 13, round 58): the OnboardingWizard overlay + its focus-trap block
// were REMOVED here when the second, back-to-back onboarding system was
// consolidated away (the component no longer exists). The other four overlays
// below/above keep their round-50 focus-trap coverage unchanged.

describe('FirstRunExperience takeover (Gate 12, round 50)', () => {
  vi.stubGlobal('scrollTo', () => undefined);

  function routeFirstRun(): void {
    route('xp:profile.get' as never, () => ({
      state: 'pending',
      aiModeChosen: false,
      workspaceType: null,
      milestones: {},
    }));
    route('xp:profile.set' as never, (p: unknown) => p);
    route(IpcChannel.AiConfigDetectOllama, () => ({ reachable: false, models: [] }));
  }

  it('traps focus for its whole life, and Escape does NOT dismiss the required flow', async () => {
    routeFirstRun();
    render(<FirstRunExperience onDone={() => undefined} onSignIn={() => undefined} />);
    const dialog = await screen.findByRole('dialog', { name: 'Welcome to NeuroPause' });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    assertTrapped(dialog, 10);

    // Deliberate: a required flow with an explicit Skip must not vanish on a
    // stray key — consent-bearing steps cannot be Escape-dismissed.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'Welcome to NeuroPause' })).toBeTruthy();
  });
});
