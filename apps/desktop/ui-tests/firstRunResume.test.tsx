/**
 * P13C ROUND 36 — GATE 13. ONBOARDING RESUMES, GOES BACK, AND FAILS HONESTLY.
 *
 * Four REDs pinned here:
 *  1. RESUME — the service promised "quitting mid-flow … resumes where it left
 *     off" since round 17, while the step lived in `useState('welcome')` and
 *     every relaunch replayed the whole flow. The rule is now the pure
 *     `resumeStep(profile)` plus the component honoring it.
 *  2. BACK — every step after welcome was one-way.
 *  3. The FINAL "Yes, continue" swallowed a failed completion write silently.
 *  4. skip() fired `onDone` from a finally even when the persist THREW — the
 *     takeover re-rendered with no explanation.
 * Same harness as firstRun.ui.test.tsx: the REAL profile service over a real
 * temp file, real Zod-checked routes.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { route, clearRoutes, routeTenantAiPreference } from './setup';
import { IpcChannel } from '@neuropause/shared';
import { createExperienceProfileService } from '@main/onboarding/experienceProfileService';
import { FirstRunExperience } from '@renderer/firstRun/FirstRunExperience';
import { resumeStep } from '@renderer/firstRun/experienceModel';

let dir: string;
let profile: ReturnType<typeof createExperienceProfileService>;

beforeEach(async () => {
  cleanup();
  clearRoutes();
  dir = join(tmpdir(), `np-fr-resume-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  profile = createExperienceProfileService({ filePath: join(dir, 'profile.json') });
  await profile.load();
  route('xp:profile.get', () => profile.get());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  route('xp:profile.set', (p) => profile.set(p as any));
  route(IpcChannel.AiConfigDetectOllama, () => ({
    installed: false, version: null, reachable: false, models: [], endpoint: 'http://localhost:11434',
  }));
  routeTenantAiPreference(join(dir, 'ai-preference.json'));
});

afterEach(async () => {
  cleanup();
  await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

const noop = (): void => undefined;

describe('resumeStep — the pure rule', () => {
  it('derives the step from what is persisted', () => {
    expect(resumeStep({ aiModeChosen: false, workspaceType: null })).toBe('welcome');
    expect(resumeStep({ aiModeChosen: true, workspaceType: null })).toBe('workspace');
    expect(resumeStep({ aiModeChosen: true, workspaceType: 'business' })).toBe('discovery');
  });
});

describe('the flow resumes where the user left off', () => {
  it('a relaunch after choosing AI mode + workspace lands on discovery, not welcome', async () => {
    // The persisted state a mid-flow quit leaves behind.
    await profile.set({ aiModeChosen: true });
    await profile.set({ workspaceType: 'business' });
    const persisted = profile.get();
    render(<FirstRunExperience onDone={noop} onSignIn={noop} profile={persisted} />);
    // Discovery step — and the welcome step's own CTA is NOT rendered.
    expect(await screen.findByText(/What best describes you\?/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Skip setup for now/ })).toBeNull();
  });
});

describe('back paths', () => {
  it('discovery can go back to workspace', async () => {
    await profile.set({ aiModeChosen: true });
    await profile.set({ workspaceType: 'business' });
    render(<FirstRunExperience onDone={noop} onSignIn={noop} profile={profile.get()} />);
    await screen.findByText(/What best describes you\?/);
    await userEvent.setup().click(screen.getByRole('button', { name: /Back/ }));
    expect(await screen.findByText(/How do you want to use NeuroPause\?/)).toBeTruthy();
  });
});

describe('failures are said, not swallowed', () => {
  it('a failed completion write surfaces an alert instead of an inert button', async () => {
    await profile.set({ aiModeChosen: true });
    await profile.set({ workspaceType: 'personal' });
    // The completion write fails; earlier per-step writes succeeded.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    route('xp:profile.set', (p: any) => {
      if (p.state === 'completed') throw new Error('disk full');
      return profile.set(p);
    });
    const user = userEvent.setup();
    render(<FirstRunExperience onDone={noop} onSignIn={noop} profile={profile.get()} />);
    await screen.findByText(/What do you usually want help with\?/); // the personal branch
    // Walk to understanding via the skip-questions path, then confirm.
    await user.click(screen.getByRole('button', { name: /Skip these questions/ }));
    await user.click(await screen.findByRole('button', { name: /Yes, continue/ }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('could not be saved');
  });

  it('a failed skip is said and the flow does NOT pretend to close', async () => {
    let doneCalls = 0;
    route('xp:profile.set', () => {
      throw new Error('store locked');
    });
    const user = userEvent.setup();
    render(<FirstRunExperience onDone={() => { doneCalls += 1; }} onSignIn={noop} />);
    await user.click(await screen.findByRole('button', { name: /Skip setup for now/ }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('could not be saved');
    expect(doneCalls).toBe(0);
  });
});
