/**
 * P13C GATE 13 — ONE onboarding journey, verified in the real rendered shell.
 *
 * Before: a brand-new user saw TWO onboarding systems back-to-back — the
 * `FirstRunExperience` takeover, then (the instant it finished) a separate
 * "Welcome to NeuroPause" checklist modal (`OnboardingWizard`) that did no setup
 * and duplicated the journey just completed. Round 58 consolidated to ONE flow:
 * FirstRunExperience is the single onboarding; the second modal is removed (its
 * checklist content lives on, un-popped, as the Getting Started section).
 *
 * These drive the REAL App/AppShell over the real IPC harness and pin:
 *   • first launch (pending profile) shows exactly ONE onboarding surface;
 *   • once the profile is completed/skipped, NO onboarding overlay appears —
 *     EVEN when the onboarding service still reports firstRun:true (the exact
 *     condition that used to pop the second modal). This is the decisive
 *     back-to-back regression;
 *   • a returning (completed) user sees no onboarding at all.
 *
 * Only `useAuth` (→ local) is mocked; the shell/AppShell/providers are real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { AuthStatus, ExperienceProfile } from '@neuropause/shared';
import { IpcChannel } from '@neuropause/shared';
import { route, clearRoutes } from './setup';

vi.stubGlobal('matchMedia', (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  addListener: () => undefined,
  removeListener: () => undefined,
  dispatchEvent: () => false,
}));

const LOCAL: AuthStatus = {
  state: 'local',
  principal: { id: 'device-1', displayName: 'Local User', createdAt: '2026-08-18T00:00:00.000Z' },
};

vi.mock('@renderer/providers/AuthProvider', () => ({
  AuthProvider: ({ children }: { children: unknown }) => children,
  useAuth: () => ({
    status: LOCAL,
    initializing: false,
    loginOAuth: vi.fn(),
    loginEmail: vi.fn(),
    registerEmail: vi.fn(),
    logout: vi.fn(),
  }),
}));

import App from '@renderer/App';
import { ThemeProvider } from '@renderer/providers/ThemeProvider';

/** Boot channels, minus xp:profile.get + onboarding:status which each test sets. */
function routeBootBase(): void {
  route(IpcChannel.WorkspaceCtxBootstrap, () => ({
    workspaces: [{ id: 'wsc_1', name: 'Default', color: '#8888ff' }],
    activeId: 'wsc_1',
    activeSnapshot: { activeSection: 'intent-home', tabs: [], activeTabId: null },
  }));
  route(IpcChannel.AppGetThemeSource, () => 'system');
  route(IpcChannel.AppGetInfo, () => ({ version: '0.0.0-test', platform: 'darwin', arch: 'arm64' }));
  route(IpcChannel.LiveSyncStatus, () => null);
  route(IpcChannel.IntentBoard, () => ({ intents: [], roleViews: [] }));
  route(IpcChannel.IntentWorkspaces, () => ({ workspaces: [] }));
  route(IpcChannel.IntentGovernance, () => ({}));
  // FirstRunExperience probes the local model server on the processing step.
  route(IpcChannel.AiConfigDetectOllama, () => ({ reachable: false, models: [] }));
}

function profile(state: ExperienceProfile['state']): ExperienceProfile {
  return {
    state,
    workspaceType: null,
    aiModeChosen: state !== 'pending',
    attributes: [],
    completedAt: state === 'completed' ? '2026-08-18T00:00:00.000Z' : null,
    updatedAt: '2026-08-18T00:00:00.000Z',
  } as ExperienceProfile;
}

// The onboarding service reports firstRun:true WITH a real next step — the exact
// condition that USED to pop the second "Welcome to NeuroPause" modal (the old
// wizard rendered null without a step, so the step is what makes this a genuine
// negative control). It must no longer produce any overlay.
function onboardingWouldPopOldWizard(): void {
  const status = {
    firstRun: true,
    startedAt: null,
    completedAt: null,
    steps: [{ id: 'welcome', title: 'Welcome', description: 'Get started.', done: false }],
    nextStep: 'welcome',
  };
  route(IpcChannel.OnboardingStatus, () => status);
  route(IpcChannel.OnboardingStart, () => status);
}

async function mountShell(): Promise<void> {
  render(
    <ThemeProvider>
      <App />
    </ThemeProvider>,
  );
  // The shell mounts (Business nav present) even behind the first-run takeover.
  await screen.findByRole('button', { name: 'Business' }, { timeout: 5000 });
}

beforeEach(() => {
  cleanup();
  clearRoutes();
});
afterEach(() => cleanup());

describe('P13C Gate 13 — one onboarding journey', () => {
  it('first launch (pending) shows exactly ONE onboarding surface — the first-run experience', async () => {
    routeBootBase();
    route(IpcChannel.ExperienceProfileGet, () => profile('pending'));
    onboardingWouldPopOldWizard();
    await mountShell();

    // The single onboarding surface appears…
    const dialogs = await screen.findAllByRole('dialog', { name: 'Welcome to NeuroPause' });
    expect(dialogs).toHaveLength(1); // never two stacked onboarding modals
  });

  it('after completion, NO second onboarding overlay pops — even with onboarding firstRun:true (the back-to-back is gone)', async () => {
    routeBootBase();
    route(IpcChannel.ExperienceProfileGet, () => profile('completed'));
    onboardingWouldPopOldWizard(); // the exact state that used to pop the wizard
    await mountShell();

    // Give any deferred overlay a chance to mount, then assert none did.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('dialog', { name: 'Welcome to NeuroPause' })).toBeNull();
    // The shell is usable (not trapped behind a modal).
    expect(screen.getByRole('button', { name: 'Business' })).toBeTruthy();
  });

  it('a skipped profile likewise shows no onboarding overlay', async () => {
    routeBootBase();
    route(IpcChannel.ExperienceProfileGet, () => profile('skipped'));
    onboardingWouldPopOldWizard();
    await mountShell();

    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('dialog', { name: 'Welcome to NeuroPause' })).toBeNull();
  });

  it('a returning (completed) user with onboarding already settled sees no onboarding', async () => {
    routeBootBase();
    route(IpcChannel.ExperienceProfileGet, () => profile('completed'));
    route(IpcChannel.OnboardingStatus, () => ({
      firstRun: false,
      startedAt: '2026-08-18T00:00:00.000Z',
      completedAt: '2026-08-18T00:00:00.000Z',
      steps: [],
      nextStep: null,
    }));
    await mountShell();

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Welcome to NeuroPause' })).toBeNull(),
    );
    expect(screen.getByRole('button', { name: 'Business' })).toBeTruthy();
  });
});
