/**
 * P13C — O-4. ONE failure is stated ONCE.
 *
 * Observed on screen, not in a test: an unreachable backend produced two
 * stacked banners. The F-7 notice said "The service address could not be found
 * on this network." Immediately below it the auth banner said "Could not reach
 * the NeuroPause backend. Is it running?" — a second box, for the same outage,
 * asking the reader to check something a founder who ran an installer cannot
 * check. That question is the exact copy rule BackendReachabilityNotice was
 * written to enforce, violated by the component underneath it.
 *
 * The suppression is keyed on `status.cause`, NOT on message text. Matching
 * strings is how `not.toContain('http')` matched `http_error` earlier in this
 * programme.
 *
 * NEGATIVE CONTROL — change the guard in LoginScreen back to
 * `if (status.state === 'error') return status.message;` and case 1 fails.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { AuthStatus } from '@neuropause/shared';

const mockState = vi.hoisted(() => ({
  status: { state: 'unauthenticated' } as AuthStatus,
  reachable: true,
  lastError: null as string | null,
}));

vi.mock('@renderer/lib/ipc', () => ({
  ipc: {
    auth: { providers: () => Promise.resolve({ providers: [] }) },
    system: {
      backendReachability: () =>
        Promise.resolve({
          reachable: mockState.reachable,
          checkedAt: '2026-08-13T08:00:00.000Z',
          lastError: mockState.lastError,
        }),
    },
  },
}));

vi.mock('@renderer/providers/AuthProvider', () => ({
  useAuth: () => ({
    status: mockState.status,
    loginOAuth: vi.fn(),
    loginEmail: vi.fn(),
    registerEmail: vi.fn(),
  }),
}));

import { LoginScreen } from '@renderer/screens/LoginScreen';

beforeEach(() => {
  mockState.status = { state: 'unauthenticated' };
  mockState.reachable = true;
  mockState.lastError = null;
});
afterEach(() => cleanup());

describe('O-4 — a single outage produces a single banner', () => {
  it('suppresses the auth banner when the service is unreachable', async () => {
    mockState.reachable = false;
    mockState.lastError = 'dns';
    mockState.status = {
      state: 'error',
      message: 'Could not reach the NeuroPause backend. Is it running?',
      cause: 'unreachable',
    };

    render(<LoginScreen />);

    // The notice owns this story and tells it with the failure class.
    expect(await screen.findByText(/could not be found on this network/i)).toBeTruthy();
    // The duplicate — and the unanswerable question — must be gone.
    expect(screen.queryByText(/Is it running\?/i)).toBeNull();
  });

  it('still shows a refusal from the service — the notice says nothing about it', async () => {
    mockState.status = {
      state: 'error',
      message: 'Invalid email or password.',
      cause: 'rejected',
    };

    render(<LoginScreen />);

    expect(await screen.findByText('Invalid email or password.')).toBeTruthy();
  });

  it('still shows an error of unknown cause rather than swallowing it', async () => {
    mockState.status = { state: 'error', message: 'Unexpected error', cause: 'unknown' };

    render(<LoginScreen />);

    expect(await screen.findByText('Unexpected error')).toBeTruthy();
  });

  it('shows an error with no cause at all — the field is additive, not required', async () => {
    mockState.status = { state: 'error', message: 'Legacy message' };

    render(<LoginScreen />);

    expect(await screen.findByText('Legacy message')).toBeTruthy();
  });

  it('keeps the four failure classes distinguishable in the notice', async () => {
    for (const [code, phrase] of [
      ['dns', /could not be found on this network/i],
      ['timeout', /did not respond in time/i],
      ['refused', /refused the connection/i],
      ['http_error', /reported a problem/i],
    ] as const) {
      cleanup();
      mockState.reachable = false;
      mockState.lastError = code;
      mockState.status = { state: 'error', message: 'suppressed', cause: 'unreachable' };
      render(<LoginScreen />);
      expect(await screen.findByText(phrase)).toBeTruthy();
    }
  });
});
