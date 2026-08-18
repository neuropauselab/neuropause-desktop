/**
 * S17 local-first — the ONE affordance a device-local session shows, and the
 * way back to it from the sign-in surface. UI truth: "working locally" is stated
 * because the app is in the `local` branch, and the CTA reveals the REAL sign-in
 * path (never a fake one).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { AuthStatus } from '@neuropause/shared';

const mockState = vi.hoisted(() => ({ status: { state: 'unauthenticated' } as AuthStatus }));

vi.mock('@renderer/lib/ipc', () => ({
  ipc: { auth: { providers: () => Promise.resolve({ providers: [] }) } },
}));
vi.mock('@renderer/providers/AuthProvider', () => ({
  useAuth: () => ({
    status: mockState.status,
    loginOAuth: vi.fn(),
    loginEmail: vi.fn(),
    registerEmail: vi.fn(),
  }),
}));

import { LocalModeBanner } from '@renderer/shell/LocalModeBanner';
import { LoginScreen } from '@renderer/screens/LoginScreen';
import { CloudUnavailableLocal } from '@renderer/shell/CloudUnavailableLocal';
import { LocalModeConnectProvider } from '@renderer/shell/localModeConnect';

beforeEach(() => {
  mockState.status = { state: 'unauthenticated' };
});
afterEach(() => cleanup());

describe('LocalModeBanner (S17 affordance)', () => {
  it('states "working locally" and offers to connect an account', () => {
    render(<LocalModeBanner onConnect={vi.fn()} />);
    // getByRole/getByText throw when absent, so a returned node IS the assertion.
    expect(screen.getByRole('status', { name: 'Working locally' })).toBeTruthy();
    expect(screen.getByText(/working locally/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /connect an account to sync/i })).toBeTruthy();
  });

  it('the CTA fires onConnect (reveals the real sign-in path)', () => {
    const onConnect = vi.fn();
    render(<LocalModeBanner onConnect={onConnect} />);
    fireEvent.click(screen.getByRole('button', { name: /connect an account to sync/i }));
    expect(onConnect).toHaveBeenCalledTimes(1);
  });
});

describe('CloudUnavailableLocal (S17 honest cloud absence)', () => {
  it('states honest absence for the feature + offers the connect affordance', () => {
    const connect = vi.fn();
    render(
      <LocalModeConnectProvider value={connect}>
        <CloudUnavailableLocal feature="Organization management" />
      </LocalModeConnectProvider>,
    );
    // Honest absence, NOT an error/red state, NOT "Sign in to manage organizations."
    expect(screen.getByText(/Organization management is unavailable while working locally/i)).toBeTruthy();
    expect(screen.queryByText(/sign in to manage/i)).toBeNull();
    // The connect affordance is present and wired to the shell's connect action.
    const btn = screen.getByRole('button', { name: /connect an account to sync/i });
    fireEvent.click(btn);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('honors an explicit action override', () => {
    render(
      <LocalModeConnectProvider value={vi.fn()}>
        <CloudUnavailableLocal feature="Billing" action={<span>custom cta</span>} />
      </LocalModeConnectProvider>,
    );
    expect(screen.getByText('custom cta')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /connect an account to sync/i })).toBeNull();
  });
});

describe('LoginScreen — the way back to local mode', () => {
  it('shows "Keep working locally" ONLY when reached from local mode, and it dismisses', () => {
    const onDismiss = vi.fn();
    const { rerender } = render(<LoginScreen />);
    // Classic first-run screen (no account yet): no way-back affordance.
    expect(screen.queryByRole('button', { name: /keep working locally/i })).toBeNull();
    // Reached from local mode: the dismiss affordance appears and works.
    rerender(<LoginScreen onDismiss={onDismiss} />);
    const back = screen.getByRole('button', { name: /keep working locally/i });
    fireEvent.click(back);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
