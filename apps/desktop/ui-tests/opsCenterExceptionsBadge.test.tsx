/**
 * S141 — the primary Operations navigation carries an honest "Needs attention" badge, reused from the SAME
 * governed QueryOperationalExceptions read (S139) on `platform:command.dispatch`. Proves: a real count when
 * the read succeeds, "0" honestly when there are none, and an explicit "unavailable" when the read fails
 * (NEVER a fabricated 0). Read-only; tenant is server-resolved; the renderer supplies no tenant.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { route, clearRoutes } from './setup';
import { IpcChannel } from '@neuropause/shared';
import { OpsCenterRoot } from '@renderer/operationsCenter/OpsCenterView';

beforeEach(() => {
  cleanup();
  clearRoutes();
});

const exc = (over: Record<string, unknown>) => ({
  ok: true,
  data: { counts: { retryingDeliveries: 0, heldReconciliations: 0, total: 0, ...(over.counts as object ?? {}) }, exceptions: [] },
  requestId: 'r', correlationId: 'c', operation: 'QueryOperationalExceptions',
});

describe('OpsCenter — S141 needs-attention nav badge', () => {
  it('shows a real count when the governed exceptions read succeeds', async () => {
    route(IpcChannel.PlatformCommandDispatch, (payload: unknown) => {
      const op = (payload as { operation: string }).operation;
      if (op === 'QueryOperationalExceptions') return exc({ counts: { total: 3 } });
      return { ok: true, data: {}, requestId: 'r', correlationId: 'c', operation: op };
    });
    render(<OpsCenterRoot />);
    await waitFor(() => expect(screen.getByText('Needs attention: 3')).toBeTruthy());
  });

  it('shows an honest 0 when there are genuinely no exceptions (read succeeded)', async () => {
    route(IpcChannel.PlatformCommandDispatch, (payload: unknown) => {
      const op = (payload as { operation: string }).operation;
      if (op === 'QueryOperationalExceptions') return exc({ counts: { total: 0 } });
      return { ok: true, data: {}, requestId: 'r', correlationId: 'c', operation: op };
    });
    render(<OpsCenterRoot />);
    await waitFor(() => expect(screen.getByText('Needs attention: 0')).toBeTruthy());
  });

  it('shows "unavailable" when the exceptions read fails — never a fabricated 0', async () => {
    route(IpcChannel.PlatformCommandDispatch, (payload: unknown) => {
      const op = (payload as { operation: string }).operation;
      if (op === 'QueryOperationalExceptions') return { ok: false, error: { code: 'UNAUTHORIZED', message: 'no' }, requestId: 'r', correlationId: 'c', operation: op };
      return { ok: true, data: {}, requestId: 'r', correlationId: 'c', operation: op };
    });
    render(<OpsCenterRoot />);
    await waitFor(() => expect(screen.getByText('Needs attention: unavailable')).toBeTruthy());
    expect(screen.queryByText('Needs attention: 0')).toBeNull();
  });
});
