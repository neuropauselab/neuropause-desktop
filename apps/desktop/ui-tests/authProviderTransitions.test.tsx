/**
 * P13C GATE 2 — the renderer learns auth transitions LIVE.
 *
 * The other half of "renderer auth state machine untested": the real
 * `AuthProvider` must seed from the main process and then stay live via the
 * `AuthStatusChanged` broadcast. This drives the REAL provider over a mocked
 * `ipc.auth`, proving the seed clears `initializing` and a subsequent broadcast
 * (e.g. the Gate-2 re-restore promoting local → authenticated) reaches the UI.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, act, cleanup, waitFor } from '@testing-library/react';
import type { AuthStatus } from '@neuropause/shared';

const hoisted = vi.hoisted(() => ({
  getStatus: (async () => ({ state: 'unauthenticated' })) as () => Promise<AuthStatus>,
  listener: null as null | ((s: AuthStatus) => void),
}));

vi.mock('@renderer/lib/ipc', () => ({
  ipc: {
    auth: {
      getStatus: () => hoisted.getStatus(),
      onStatusChanged: (cb: (s: AuthStatus) => void) => {
        hoisted.listener = cb;
        return () => {
          hoisted.listener = null;
        };
      },
    },
  },
}));

import { AuthProvider, useAuth } from '@renderer/providers/AuthProvider';

function Probe(): JSX.Element {
  const { status, initializing } = useAuth();
  return (
    <div data-testid="probe" data-state={status.state} data-init={initializing ? 'yes' : 'no'} />
  );
}

const LOCAL: AuthStatus = {
  state: 'local',
  principal: { id: 'd', displayName: 'L', createdAt: '2026-08-18T00:00:00.000Z' },
};

afterEach(() => cleanup());

describe('P13C Gate 2 — AuthProvider seeds and stays live', () => {
  it('seeds the status from the main process and clears initializing', async () => {
    hoisted.getStatus = async () => LOCAL;
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('probe').getAttribute('data-init')).toBe('no'));
    expect(screen.getByTestId('probe').getAttribute('data-state')).toBe('local');
  });

  it('a statusChanged broadcast updates the rendered state (local → authenticated, the re-restore path)', async () => {
    hoisted.getStatus = async () => LOCAL;
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('probe').getAttribute('data-state')).toBe('local'));
    act(() => {
      hoisted.listener?.({
        state: 'authenticated',
        session: {
          user: {
            id: 'u',
            email: 'a@b.test',
            displayName: 'A',
            avatarUrl: null,
            createdAt: 'x',
            updatedAt: 'x',
          },
          accessTokenExpiresAt: 0,
        },
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId('probe').getAttribute('data-state')).toBe('authenticated'),
    );
  });
});
