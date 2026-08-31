/**
 * D-7 — A REFUSED PIN/FAVORITE WRITE IS REPORTED.
 *
 * `OperationsProvider:371` caught a refused `registry:setFlags` into `log.warn`
 * and returned, then ran `void refreshRegistry()` — which repainted the OLD
 * state. The star or pin the user clicked simply bounced back, with no message
 * anywhere. The write is permission-gated (`dashboard:read`), stamped
 * `audit: true`, and durably persisted with an integrity-checksum recompute, so
 * "it's only cosmetic" is not available as a defence.
 *
 * WHY `appendLog` AND NOT A NEW BANNER. This provider already has one failure
 * surface — `appendLog`, used by 26 call sites and rendered by `LogsPanel` — and
 * six sibling catches in this very file already report through it. `setFlags` was
 * the lone exception. Adding a second, competing error channel here would have
 * been the defect the first-run screen already learned once: one channel per
 * screen, named for the action.
 *
 * TWO failure modes are pinned, because the site has two and only one throws:
 *  1. the IPC rejects — the catch reports;
 *  2. the IPC RESOLVES with `null`. `registry:setFlags` answers
 *     `RegistryEntryDto | null`, and an unknown slug returns `null` rather than
 *     throwing, so the catch never runs and the write silently did not happen.
 *     That second mode is invisible to any test that only makes the channel throw.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { route, clearRoutes } from './setup';
import { IpcChannel } from '@neuropause/shared';

// `OperationsProvider` reads `openApp` from the shell. Mocked so the provider can
// mount standalone -- the behaviour under test is its own write path, not the shell.
vi.mock('@renderer/state/ShellProvider', () => ({
  useShell: () => ({ openApp: vi.fn() }),
}));

import { OperationsProvider, useOperations } from '@renderer/operations/OperationsProvider';

/** Reads the provider's REAL log feed — the surface `LogsPanel` renders. */
function Probe(): JSX.Element {
  const { logEntries, setFlags } = useOperations();
  return (
    <div>
      <div data-testid="log-count">{logEntries.length}</div>
      <div data-testid="log-top">
        {logEntries[0] ? `${logEntries[0].tone}|${logEntries[0].title}|${logEntries[0].detail ?? ''}` : ''}
      </div>
      <button type="button" onClick={() => void setFlags('acme-app', { favorite: true })}>
        probe-favorite
      </button>
    </div>
  );
}

const mount = (): void => {
  render(
    <OperationsProvider>
      <Probe />
    </OperationsProvider>,
  );
};

beforeEach(() => {
  cleanup();
  clearRoutes();
});

describe('OperationsProvider — a refused pin/favorite is reported (D-7)', () => {
  it('a REJECTED setFlags appends a red log entry naming the app and the reason', async () => {
    let calls = 0;
    route(IpcChannel.RegistrySetFlags, () => {
      calls += 1;
      throw new Error('Not authorized: missing permission "dashboard:read".');
    });
    mount();

    await userEvent.setup().click(screen.getByRole('button', { name: 'probe-favorite' }));

    await waitFor(() => {
      const top = screen.getByTestId('log-top').textContent ?? '';
      expect(top).toContain('red|');
      expect(top).toContain('acme-app');
      expect(top).toContain('dashboard:read');
    });
    expect(calls).toBe(1);
  });

  it('a RESOLVED-null setFlags is reported too — the mode the catch never sees', async () => {
    // The real refusal shape for an unknown slug: it resolves, it does not throw.
    route(IpcChannel.RegistrySetFlags, () => null);
    mount();

    await userEvent.setup().click(screen.getByRole('button', { name: 'probe-favorite' }));

    await waitFor(() => {
      const top = screen.getByTestId('log-top').textContent ?? '';
      expect(top).toContain('red|');
      expect(top).toContain('acme-app');
      expect(top).toMatch(/was not saved/i);
    });
  });

  it('a SUCCEEDING setFlags adds no failure entry (the control)', async () => {
    route(IpcChannel.RegistrySetFlags, () => ({
      slug: 'acme-app',
      name: 'Acme',
      pinned: false,
      favorite: true,
    }));
    mount();

    const before = Number(screen.getByTestId('log-count').textContent);
    await userEvent.setup().click(screen.getByRole('button', { name: 'probe-favorite' }));

    await waitFor(() => expect(screen.getByTestId('log-top')).toBeTruthy());
    // No failure entry was appended for a write that worked.
    expect(screen.getByTestId('log-top').textContent ?? '').not.toContain('Update failed');
    expect(Number(screen.getByTestId('log-count').textContent)).toBe(before);
  });
});
