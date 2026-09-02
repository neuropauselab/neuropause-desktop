/**
 * ERP Session 34 — the operator-facing Platform Health panel renders liveness + readiness fetched
 * through the governed health IPC (`ipc.platform.health` → `platform:command.dispatch`, health read
 * branch). Proves the real UI → bridge → governed IPC path and that the panel reflects ACTUAL backend
 * state (healthy, alive-but-not-ready, and unhealthy) rather than hardcoding GREEN.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { route, clearRoutes } from './setup';
import { IpcChannel } from '@neuropause/shared';
import { PlatformHealthPanel } from '@renderer/operationsPlatform/PlatformHealthPanel';

beforeEach(() => {
  cleanup();
  clearRoutes();
});

const healthResp = (over: Record<string, unknown>) => ({
  ok: true,
  data: {
    status: 'HEALTHY', live: true, ready: true, checkedAt: '2026-09-02T12:00:00.000Z',
    components: { runtime: { status: 'ok' }, journal: { status: 'ok' }, delivery: { status: 'ok', pendingOutbox: 0 } },
    ...over,
  },
  requestId: 'r', correlationId: 'c', operation: 'QueryPlatformHealth',
});

describe('PlatformHealthPanel', () => {
  it('renders a HEALTHY/READY platform from the governed health read', async () => {
    let sawOperation = '';
    route(IpcChannel.PlatformCommandDispatch, (payload: unknown) => {
      sawOperation = (payload as { operation: string }).operation;
      return healthResp({});
    });
    render(<PlatformHealthPanel />);
    await waitFor(() => expect(screen.getByText('Overall: HEALTHY')).toBeTruthy());
    expect(sawOperation).toBe('QueryPlatformHealth');
    expect(screen.getByText('Live: yes')).toBeTruthy();
    expect(screen.getByText('Ready: yes')).toBeTruthy();
    expect(screen.getByText('Runtime')).toBeTruthy();
  });

  it('reflects ALIVE_NOT_READY (not hardcoded GREEN)', async () => {
    route(IpcChannel.PlatformCommandDispatch, () =>
      healthResp({ status: 'ALIVE_NOT_READY', ready: false, components: { runtime: { status: 'not_ready' }, journal: { status: 'ok' }, delivery: { status: 'ok', pendingOutbox: 0 } } }),
    );
    render(<PlatformHealthPanel />);
    await waitFor(() => expect(screen.getByText('Overall: ALIVE_NOT_READY')).toBeTruthy());
    expect(screen.getByText('Ready: no')).toBeTruthy();
  });

  it('reflects UNHEALTHY when persistence is corrupt', async () => {
    route(IpcChannel.PlatformCommandDispatch, () =>
      healthResp({ status: 'UNHEALTHY', ready: false, components: { runtime: { status: 'ok' }, journal: { status: 'corrupt' }, delivery: { status: 'ok', pendingOutbox: 0 } } }),
    );
    render(<PlatformHealthPanel />);
    await waitFor(() => expect(screen.getByText('Overall: UNHEALTHY')).toBeTruthy());
    expect(screen.getByText('corrupt')).toBeTruthy();
  });
});
