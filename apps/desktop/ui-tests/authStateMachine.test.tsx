/**
 * P13C GATE 2 — the renderer auth state machine, pinned.
 *
 * The matrix residual was "renderer auth state machine untested": nothing
 * asserted which top-level surface `App` renders for each `AuthStatus`. This
 * mounts the REAL `App` routing decision with its heavy leaves (AppShell,
 * LoginScreen, LocalModeBanner) and provider stack mocked to markers, and pins
 * every branch — including the security-relevant ones: the `local` branch gets
 * the full shell (never a wall), and the escape-less `LoginScreen` (no
 * `onDismiss`) is reached ONLY from the genuine sign-in states, never from a
 * device-local session.
 */
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { AuthStatus } from '@neuropause/shared';

const mockState = vi.hoisted(() => ({
  status: { state: 'unauthenticated' } as AuthStatus,
  initializing: false,
}));

vi.mock('@renderer/providers/AuthProvider', () => ({
  useAuth: () => ({ status: mockState.status, initializing: mockState.initializing }),
}));

// Leaf surfaces → identifiable markers. LoginScreen records whether it received
// an onDismiss (the "escape to local mode" affordance) so the wall is testable.
vi.mock('@renderer/shell/AppShell', () => ({
  AppShell: ({ session }: { session: { user: { email: string } } }) => (
    <div data-testid="app-shell" data-email={session.user.email}>
      shell
    </div>
  ),
}));
vi.mock('@renderer/screens/LoginScreen', () => ({
  LoginScreen: ({ onDismiss }: { onDismiss?: () => void }) => (
    <div data-testid="login-screen" data-dismissable={onDismiss ? 'yes' : 'no'}>
      login
    </div>
  ),
}));
vi.mock('@renderer/shell/LocalModeBanner', () => ({
  LocalModeBanner: ({ onConnect }: { onConnect: () => void }) => (
    <button data-testid="local-banner" onClick={onConnect}>
      working locally
    </button>
  ),
}));
vi.mock('@renderer/components/Spinner', () => ({ Spinner: () => <div data-testid="spinner" /> }));

// Providers + ErrorBoundary + LocalModeConnectProvider → pass-throughs. Inlined
// (not a shared helper) because vi.mock factories are hoisted above module scope.
vi.mock('@renderer/components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: unknown }) => <>{children}</>,
}));
vi.mock('@renderer/state/ScaleProvider', () => ({
  ScaleProvider: ({ children }: { children: unknown }) => <>{children}</>,
}));
vi.mock('@renderer/services/ServicesProvider', () => ({
  ServicesProvider: ({ children }: { children: unknown }) => <>{children}</>,
}));
vi.mock('@renderer/state/WorkspaceContextProvider', () => ({
  WorkspaceScopedShellProvider: ({ children }: { children: unknown }) => <>{children}</>,
}));
vi.mock('@renderer/state/DashboardProvider', () => ({
  DashboardProvider: ({ children }: { children: unknown }) => <>{children}</>,
}));
vi.mock('@renderer/state/ToastProvider', () => ({
  ToastProvider: ({ children }: { children: unknown }) => <>{children}</>,
}));
vi.mock('@renderer/state/ConnectionProvider', () => ({
  ConnectionProvider: ({ children }: { children: unknown }) => <>{children}</>,
}));
vi.mock('@renderer/shell/localModeConnect', () => ({
  LocalModeConnectProvider: ({ children }: { children: unknown }) => <>{children}</>,
}));

import App from '@renderer/App';

const LOCAL: AuthStatus = {
  state: 'local',
  principal: { id: 'device-1', displayName: 'Local User', createdAt: '2026-08-18T00:00:00.000Z' },
};

beforeEach(() => {
  mockState.status = { state: 'unauthenticated' };
  mockState.initializing = false;
});
afterEach(() => cleanup());

describe('P13C Gate 2 — App renders the right surface for each AuthStatus', () => {
  it('initializing → the quiet loading spinner (never a premature wall)', () => {
    mockState.initializing = true;
    render(<App />);
    expect(screen.getByTestId('spinner')).toBeTruthy();
    expect(screen.queryByTestId('login-screen')).toBeNull();
  });

  it('authenticated → the full shell', () => {
    mockState.status = {
      state: 'authenticated',
      session: {
        user: {
          id: 'u1',
          email: 'a@example.test',
          displayName: 'A',
          avatarUrl: null,
          createdAt: 'x',
          updatedAt: 'x',
        },
        accessTokenExpiresAt: 0,
      },
    };
    render(<App />);
    expect(screen.getByTestId('app-shell').getAttribute('data-email')).toBe('a@example.test');
    expect(screen.queryByTestId('login-screen')).toBeNull();
  });

  it('local → the FULL shell + the "working locally" banner (no wall), with a @device.invalid display session', () => {
    mockState.status = LOCAL;
    render(<App />);
    expect(screen.getByTestId('app-shell')).toBeTruthy();
    expect(screen.getByTestId('local-banner')).toBeTruthy();
    // The synthetic display session is the non-routable device-local namespace.
    expect(screen.getByTestId('app-shell').getAttribute('data-email')).toBe(
      'local-device-1@device.invalid',
    );
    expect(screen.queryByTestId('login-screen')).toBeNull();
  });

  it('local + "connect" → the sign-in surface WITH a dismiss back to local mode', () => {
    mockState.status = LOCAL;
    render(<App />);
    fireEvent.click(screen.getByTestId('local-banner'));
    const login = screen.getByTestId('login-screen');
    expect(login.getAttribute('data-dismissable')).toBe('yes'); // escape back to local
  });

  it('unauthenticated → the sign-in screen with NO dismiss (the deliberate wall for a genuine sign-in)', () => {
    mockState.status = { state: 'unauthenticated' };
    render(<App />);
    const login = screen.getByTestId('login-screen');
    expect(login.getAttribute('data-dismissable')).toBe('no');
    expect(screen.queryByTestId('app-shell')).toBeNull();
  });

  it('error and authenticating → the sign-in screen (which renders those states itself)', () => {
    mockState.status = { state: 'error', message: 'boom', cause: 'rejected' };
    const { rerender } = render(<App />);
    expect(screen.getByTestId('login-screen')).toBeTruthy();
    mockState.status = { state: 'authenticating', provider: 'google' };
    rerender(<App />);
    expect(screen.getByTestId('login-screen')).toBeTruthy();
  });
});
