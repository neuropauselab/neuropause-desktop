/**
 * P13C F-8 / F-9 — the login screen must not offer what does not exist, and its
 * primary action must be readable.
 *
 * F-8: `PROVIDER_CATALOGUE` used to be rendered unconditionally while
 * `/auth/providers` returned `[]`, so four OAuth buttons were offered and none
 * could work — most likely the founder's first click.
 *
 * F-9: `--accent` is `255 255 255` (index.css:11) and the submit button carried
 * `bg-accent … text-white`. White on white. The design system ships
 * `--accent-fg` (0 0 0) for exactly this and ten other call sites use it.
 * Observed as a blank white bar in four screenshots before it was traced to the
 * token.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

const mockState = vi.hoisted(() => ({
  providers: [] as string[],
  reject: false,
}));

vi.mock('@renderer/lib/ipc', () => ({
  ipc: {
    auth: {
      providers: () =>
        mockState.reject
          ? Promise.reject(new Error('unreachable'))
          : Promise.resolve({ providers: mockState.providers }),
    },
    system: {
      backendReachability: () =>
        Promise.resolve({ reachable: true, checkedAt: '2026-08-13T08:00:00.000Z', lastError: null }),
    },
  },
}));

vi.mock('@renderer/providers/AuthProvider', () => ({
  useAuth: () => ({
    status: { state: 'unauthenticated' },
    loginOAuth: vi.fn(),
    loginEmail: vi.fn(),
    registerEmail: vi.fn(),
  }),
}));

import { LoginScreen } from '@renderer/screens/LoginScreen';

const OAUTH_LABELS = [
  'Continue with Google',
  'Continue with GitHub',
  'Continue with Microsoft',
  'Continue with Apple',
];

beforeEach(() => {
  mockState.providers = [];
  mockState.reject = false;
});
afterEach(() => cleanup());

describe('F-8 · the screen offers only what the server has', () => {
  it('offers NO OAuth button when the server reports none — the shipped state today', async () => {
    render(<LoginScreen />);
    await screen.findByPlaceholderText('Email');
    for (const label of OAUTH_LABELS) {
      expect(screen.queryByRole('button', { name: label })).toBeNull();
    }
    // and the "or" divider goes with them
    expect(screen.queryByText('or')).toBeNull();
  });

  it('offers exactly the providers the server names, and no others', async () => {
    mockState.providers = ['google'];
    render(<LoginScreen />);
    await screen.findByRole('button', { name: 'Continue with Google' });
    for (const label of OAUTH_LABELS.slice(1)) {
      expect(screen.queryByRole('button', { name: label })).toBeNull();
    }
    expect(screen.getByText('or')).toBeTruthy();
  });

  it('ignores a provider it has no button for, rather than crashing', async () => {
    mockState.providers = ['google', 'saml', 'okta'];
    render(<LoginScreen />);
    await screen.findByRole('button', { name: 'Continue with Google' });
    expect(screen.queryByText(/saml|okta/i)).toBeNull();
  });

  it('offers none when the lookup fails — unknown is not "all four"', async () => {
    mockState.reject = true;
    render(<LoginScreen />);
    await screen.findByPlaceholderText('Email');
    for (const label of OAUTH_LABELS) {
      expect(screen.queryByRole('button', { name: label })).toBeNull();
    }
  });

  it('always keeps the path that works — email and Create one', async () => {
    render(<LoginScreen />);
    await screen.findByPlaceholderText('Email');
    expect(screen.getByPlaceholderText('Password')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create one' })).toBeTruthy();
  });
});

describe('F-9 · the primary action is readable', () => {
  /**
   * NEGATIVE CONTROL: put `text-white` back on the submit button and this fails.
   * `--accent` is white, so `bg-accent` + `text-white` is an invisible label on
   * the first button anyone sees.
   */
  it('the submit button does not paint accent-on-accent', async () => {
    render(<LoginScreen />);
    const submit = await screen.findByRole('button', { name: /Sign in/i });
    const cls = submit.className;
    expect(cls).toContain('bg-accent');
    expect(cls).toContain('text-accent-fg');
    expect(cls).not.toContain('text-white');
  });

  it('the submit button carries a visible label', async () => {
    render(<LoginScreen />);
    const submit = await screen.findByRole('button', { name: /Sign in/i });
    expect((submit.textContent ?? '').trim().length).toBeGreaterThan(0);
  });
});
