/**
 * P13C ROUND 36 — GATE 1. A failed runtime init is SAID on screen.
 *
 * Before this notice, `initRuntimeCore` throwing left a complete-looking shell
 * over ~650 dead channels — every screen degraded into its own empty state and
 * nothing named the common cause. These tests pin: the notice renders as a
 * real alert when the state is 'failed' (with the sanitized message), renders
 * NOTHING on a healthy or still-starting boot, and never invents a state when
 * the read fails.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { route, clearRoutes } from './setup';
import { IpcChannel } from '@neuropause/shared';
import type { RuntimeStateDto } from '@neuropause/shared';
import { RuntimeFailureNotice } from '@renderer/shell/RuntimeFailureNotice';

beforeEach(() => {
  cleanup();
  clearRoutes();
});
afterEach(() => cleanup());

describe('RuntimeFailureNotice', () => {
  it('renders a role=alert with the sanitized reason when the runtime failed', async () => {
    route(
      IpcChannel.RuntimeState,
      (): RuntimeStateDto => ({ state: 'failed', message: 'Store scope gate refused.' }),
    );
    render(<RuntimeFailureNotice />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('runtime failed to start');
    expect(alert.textContent).toContain('Store scope gate refused.');
  });

  it('renders nothing while starting — the boot window is not an error', async () => {
    route(IpcChannel.RuntimeState, (): RuntimeStateDto => ({ state: 'starting', message: null }));
    const { container } = render(<RuntimeFailureNotice />);
    await waitFor(() => expect(container.innerHTML).toBe(''));
  });

  it('renders nothing when ready', async () => {
    route(IpcChannel.RuntimeState, (): RuntimeStateDto => ({ state: 'ready', message: null }));
    const { container } = render(<RuntimeFailureNotice />);
    await waitFor(() => expect(container.innerHTML).toBe(''));
  });

  it('renders nothing when the state read itself fails — absence, never invention', async () => {
    // No route registered: the invoke rejects (UNROUTED_CHANNEL). The notice
    // must not fabricate a failure banner out of its own read failing.
    const { container } = render(<RuntimeFailureNotice />);
    await waitFor(() => expect(container.innerHTML).toBe(''));
  });
});
