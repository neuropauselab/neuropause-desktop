/**
 * First run — the full-takeover overlay, and the discovery → understanding →
 * correction path through it.
 *
 * The regression this file exists for: the overlay shipped styled with
 * `[background:var(--surface-0)]`, a variable that does not exist. The
 * declaration resolved to nothing, so a `fixed inset-0` layer rendered
 * completely transparent and the welcome copy composited on top of the running
 * app — headline over suggestion tiles, buttons over buttons, all unreadable.
 *
 * TypeScript, ESLint and 6000 unit tests all passed. Only looking at the app
 * caught it. The first test below is that look, made automatic.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { route, clearRoutes, unroutedChannels, routeTenantAiPreference } from './setup';
import { IpcChannel } from '@neuropause/shared';
import { createExperienceProfileService } from '@main/onboarding/experienceProfileService';
import type { TenantAiPreferenceStore } from '@main/ai/tenantAiPreferenceStore';
import { FirstRunExperience } from '@renderer/firstRun/FirstRunExperience';

/**
 * Classes that paint a real, opaque background. A full-screen takeover must
 * carry one of these; a `--surface-*` token is a translucent overlay material
 * and is never sufficient on its own.
 */
const OPAQUE_BACKGROUNDS = ['app-bg', 'glass-panel'];

let dir: string;
let profile: ReturnType<typeof createExperienceProfileService>;
let prefs: TenantAiPreferenceStore;

beforeEach(async () => {
  cleanup();
  clearRoutes();
  dir = join(tmpdir(), `np-firstrun-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  profile = createExperienceProfileService({ filePath: join(dir, 'profile.json') });
  await profile.load();

  route('xp:profile.get', () => profile.get());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  route('xp:profile.set', (p) => profile.set(p as any));
  // A real probe result — the processing step must not imply a local model
  // that is not there.
  route(IpcChannel.AiConfigDetectOllama, () => ({ reachable: false, models: [] }));
  /**
   * P13C ROUND 17g. `AiConfigSetMode` and `AiConfigSetExternalConsent` were
   * routed here and are no longer called by first run — D-5 moved it to
   * `ai:preference.set`, which was not routed at all, so two tests below broke
   * on 12 Aug and stayed broken because nothing runs this suite. Dead routes
   * are deleted rather than left: a route nothing calls is indistinguishable
   * from a route that works.
   */
  prefs = routeTenantAiPreference(join(dir, 'ai-preference.json'));
});

afterEach(async () => {
  cleanup();
  await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

const noop = (): void => undefined;

describe('First-run overlay', () => {
  it('covers the app with an OPAQUE background — nothing bleeds through', () => {
    render(<FirstRunExperience onDone={noop} onSignIn={noop} />);
    const overlay = screen.getByRole('dialog', { name: 'Welcome to NeuroPause' });
    const classes = overlay.className.split(/\s+/);

    // It really is a full-screen layer…
    expect(classes).toContain('fixed');
    expect(classes).toContain('inset-0');
    // …and it really does paint over what is behind it.
    expect(
      OPAQUE_BACKGROUNDS.some((c) => classes.includes(c)),
      `The first-run overlay must carry an opaque background (${OPAQUE_BACKGROUNDS.join(' or ')}). ` +
        `Got: "${overlay.className}". A translucent or unresolved background lets the shell show through the copy.`,
    ).toBe(true);
    // The specific bug: an undefined custom property in an arbitrary value.
    expect(overlay.className).not.toContain('--surface-0');
  });

  it('every channel first run touches is actually routed', async () => {
    // This test exists because the harness once routed
    // `ai:config.detectOllama` while the real channel is
    // `aiConfig:detectOllama`. The component caught the rejection, fell back
    // to "no local model reachable", and the assertion below passed against
    // the FALLBACK rather than the probe. A green test verifying nothing.
    const user = userEvent.setup();
    render(<FirstRunExperience onDone={noop} onSignIn={noop} />);
    await user.click(screen.getByRole('button', { name: 'Try Free Locally' }));
    await screen.findByText('Where should your AI work?');
    await waitFor(() => expect(unroutedChannels()).toEqual([]));
  });

  it('is a modal dialog, so focus and assistive tech treat it as a takeover', () => {
    render(<FirstRunExperience onDone={noop} onSignIn={noop} />);
    const overlay = screen.getByRole('dialog', { name: 'Welcome to NeuroPause' });
    expect(overlay.getAttribute('aria-modal')).toBe('true');
  });
});

describe('First run persists real state at every step', () => {
  it('walks welcome → processing → context → discovery → understanding → home', async () => {
    const user = userEvent.setup();
    let landedOn: string | null | undefined;
    render(<FirstRunExperience onDone={(l) => (landedOn = l)} onSignIn={noop} />);

    // Welcome → processing choice.
    await user.click(screen.getByRole('button', { name: 'Try Free Locally' }));
    expect(await screen.findByText('Where should your AI work?')).toBeTruthy();
    // The probe is honest: no local model is reachable in this run, and the
    // card says so instead of implying one.
    expect(await screen.findByText(/No local model server is reachable/)).toBeTruthy();

    // Processing choice → context. The AI mode is written to the REAL config.
    await user.click(screen.getByRole('button', { name: 'Keep it on this device' }));
    await waitFor(() => expect(profile.get().aiModeChosen).toBe(true));

    // Context → discovery. The workspace type is persisted BEFORE completion,
    // so quitting here loses nothing and does not mark first run done.
    await user.click(await screen.findByRole('button', { name: 'Explore Business' }));
    await waitFor(() => expect(profile.get().workspaceType).toBeTruthy());
    expect(profile.get().state).toBe('pending');

    // Discovery: answer, and describe the work so an inference is produced.
    await user.click(await screen.findByRole('radio', { name: 'Business owner' }));
    await user.type(
      screen.getByLabelText('What do you work on'),
      'I run a medical-component manufacturing company.',
    );
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    // Understanding: the inference is shown AS an inference, with its evidence.
    expect(await screen.findByText(/Here.s what I.ve understood/)).toBeTruthy();
    // The keyword map is first-match-wins by declared order, so "manufacturing"
    // wins over "medical" here. That is the intended behaviour — one guess the
    // user can correct, not a list they have to argue with.
    expect(screen.getByText('Manufacturing')).toBeTruthy();
    // Two inferences fire here (domain + business model), and BOTH are marked.
    expect(screen.getAllByText('Inferred — please confirm').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Inferred from your description/).length).toBeGreaterThan(0);

    // Confirm → first run completes and the profile carries the provenance.
    await user.click(screen.getByRole('button', { name: 'Yes, continue' }));
    await waitFor(() => expect(profile.get().state).toBe('completed'));
    // `onDone` fires AFTER the write resolves, so it needs its own wait — the
    // profile being committed does not mean the callback has run yet.
    await waitFor(() => expect(landedOn).toBe('ai-home'));

    const byKey = new Map(profile.get().attributes.map((a) => [a.key, a]));
    expect(byKey.get('role')?.status).toBe('stated');
    expect(byKey.get('domain')?.status).toBe('inferred');
    expect(byKey.get('domain')?.value).toBe('Manufacturing');
    // The inference did NOT silently become a fact on the way to the profile.
    expect(byKey.get('domain')?.source).toContain('Inferred from your description');
  });

  it('a correction during setup is stored as a correction, not as a statement', async () => {
    const user = userEvent.setup();
    render(<FirstRunExperience onDone={noop} onSignIn={noop} />);

    await user.click(screen.getByRole('button', { name: 'Try Free Locally' }));
    await user.click(await screen.findByRole('button', { name: 'Keep it on this device' }));
    await user.click(await screen.findByRole('button', { name: 'Explore Business' }));
    await user.click(await screen.findByRole('radio', { name: 'Business owner' }));
    await user.type(screen.getByLabelText('What do you work on'), 'we make parts');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    // Correct the role before confirming.
    await screen.findByText(/Here.s what I.ve understood/);
    const correctButtons = screen.getAllByRole('button', { name: 'Correct' });
    await user.click(correctButtons[0]!);
    const input = await screen.findByLabelText(/^Correct /);
    await user.clear(input);
    await user.type(input, 'Founder');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(screen.getByRole('button', { name: 'Yes, continue' }));

    await waitFor(() => expect(profile.get().state).toBe('completed'));
    const corrected = profile.get().attributes.find((a) => a.value === 'Founder');
    expect(corrected?.status).toBe('corrected');
  });

  it('skipping records the skip and asserts nothing about the user', async () => {
    const user = userEvent.setup();
    render(<FirstRunExperience onDone={noop} onSignIn={noop} />);
    await user.click(screen.getByRole('button', { name: 'Skip setup for now' }));
    await waitFor(() => expect(profile.get().state).toBe('skipped'));
    expect(profile.get().attributes).toEqual([]);
  });

  /**
   * THE NOTICE, OBSERVED. P13C ROUND 17g.
   *
   * The D-5 report listed "confirm the amber notice renders (one look)" as work
   * remaining for a human. That look would have found nothing. The notice lives
   * inside the processing step, and the step advanced in the same handler that
   * set the flag, so it existed for the length of one IPC round trip and then
   * unmounted. A saved preference the platform cannot honour, and a screen that
   * moves on without saying so, is the silent no-op D-5 was written to prevent.
   *
   * This test is that look, made automatic, and made to fail if the flash ever
   * comes back.
   */
  it('the cloud path saves, SAYS the platform will not honour it, and waits', async () => {
    const user = userEvent.setup();
    let landedOn: string | null | undefined;
    render(<FirstRunExperience onDone={(l) => (landedOn = l)} onSignIn={noop} />);
    await user.click(screen.getByRole('button', { name: 'Try Free Locally' }));
    await user.click(await screen.findByRole('button', { name: 'Allow approved cloud AI' }));

    // The preference really is written, through the real tenant boundary.
    await waitFor(() => expect(prefs.mine()?.mode).toBe('private_first'));
    await waitFor(() => expect(profile.get().aiModeChosen).toBe(true));

    // …and the screen says so, where a person can read it.
    const notice = await screen.findByRole('status');
    expect(notice.textContent).toMatch(/has not enabled external processing/);
    // Nothing FAILED. A restriction and an error are different events and must
    // not be announced as the same one.
    expect(screen.queryByRole('alert')).toBeNull();
    // It has not skipped past: the choice screen is still on screen.
    expect(screen.getByText('Where should your AI work?')).toBeTruthy();

    // And it is not a dead end — which is the failure this decision began with.
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('button', { name: 'Explore Business' })).toBeTruthy();
    expect(landedOn).toBeUndefined();
    expect(unroutedChannels()).toEqual([]);
  });

  /**
   * P13C ROUND 17h — the HIGH's shape, two steps later in the same wizard.
   *
   * `chooseWorkspace` advanced inside its `try`, so a failed write left the
   * user on this screen with the button they had just pressed doing nothing at
   * all. A renderer-wide census found ten catches on write paths whose entire
   * body is a log call; this was one of them, in code this program already
   * owns.
   */
  it('a workspace choice that cannot be saved says so instead of going inert', async () => {
    const user = userEvent.setup();
    render(<FirstRunExperience onDone={noop} onSignIn={noop} />);
    await user.click(screen.getByRole('button', { name: 'Try Free Locally' }));
    await user.click(await screen.findByRole('button', { name: 'Keep it on this device' }));
    const explore = await screen.findByRole('button', { name: 'Explore Business' });

    // The profile write fails from here on — a disk error, a refused handler.
    route('xp:profile.set', () => {
      throw new Error('Profile is not writable');
    });
    await user.click(explore);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/could not be saved/i);
    // Still on the workspace step: it did not advance on a write that failed.
    expect(screen.getByRole('button', { name: 'Explore Business' })).toBeTruthy();
  });
});
