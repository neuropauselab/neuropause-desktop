/**
 * NeuroPause OS — Wave 1 (P0-SAFE). The M365 write surface renders the certified path's HONEST outcome
 * class instead of a binary "Sent / Not sent" string. Pins: each governed outcome maps to its own operator
 * state; UNKNOWN is never shown as success or as a definite failure and demands reconciliation; ACKNOWLEDGED
 * is never upgraded to VERIFIED_SUCCESS. Presentation-only — no governance decision is exercised here.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { route, clearRoutes } from './setup';
import { IpcChannel } from '@neuropause/shared';
import type { ConnectorWriteResult, ConnectorSyncSnapshot } from '@neuropause/shared';
import { classifyWriteOutcome } from '@renderer/connectors/m365Outcome';
import { M365WritePanel } from '@renderer/connectors/M365WritePanel';

beforeEach(() => {
  cleanup();
  clearRoutes();
});
afterEach(() => cleanup());

// ── Pure classifier ──────────────────────────────────────────────────────────
describe('classifyWriteOutcome — honest state mapping', () => {
  const withOutcome = (outcome: string, over: Partial<ConnectorWriteResult> = {}): ConnectorWriteResult => ({
    ok: over.ok ?? false,
    message: over.message ?? null,
    requiresConfirmation: over.requiresConfirmation,
    data: { outcome },
  });

  it('ACKNOWLEDGED → ACKNOWLEDGED (never VERIFIED_SUCCESS)', () => {
    const v = classifyWriteOutcome(withOutcome('ACKNOWLEDGED', { ok: true }));
    expect(v.state).toBe('ACKNOWLEDGED');
    // The strongest honest success is ACKNOWLEDGED; VERIFIED_SUCCESS is never produced by this mapping.
    expect(v.state).not.toBe('VERIFIED_SUCCESS' as unknown as typeof v.state);
    expect(v.reconciliationRequired).toBe(false);
    expect(v.detail.toLowerCase()).toContain('not independently verified');
  });

  it('UNKNOWN → OUTCOME_UNKNOWN, warn tone, reconciliation required, not success/failure', () => {
    const v = classifyWriteOutcome(withOutcome('UNKNOWN'));
    expect(v.state).toBe('OUTCOME_UNKNOWN');
    expect(v.tone).toBe('warn');
    expect(v.reconciliationRequired).toBe(true);
    expect(v.state).not.toBe('ACKNOWLEDGED');
    expect(v.state).not.toBe('EXECUTION_FAILED');
  });

  it('EXECUTION_FAILED → EXECUTION_FAILED (error)', () => {
    const v = classifyWriteOutcome(withOutcome('EXECUTION_FAILED'));
    expect(v.state).toBe('EXECUTION_FAILED');
    expect(v.tone).toBe('error');
  });

  it('HOLD → HELD, reconciliation required', () => {
    const v = classifyWriteOutcome(withOutcome('HOLD'));
    expect(v.state).toBe('HELD');
    expect(v.reconciliationRequired).toBe(true);
  });

  it('ESCALATE → ESCALATED', () => {
    expect(classifyWriteOutcome(withOutcome('ESCALATE')).state).toBe('ESCALATED');
  });

  it('DENIED → DENIED (error)', () => {
    const v = classifyWriteOutcome(withOutcome('DENIED'));
    expect(v.state).toBe('DENIED');
    expect(v.tone).toBe('error');
  });

  it('requiresConfirmation wins → APPROVAL_REQUIRED', () => {
    const v = classifyWriteOutcome({ ok: false, message: null, requiresConfirmation: true, data: { outcome: 'HOLD' } });
    expect(v.state).toBe('APPROVAL_REQUIRED');
  });

  it('no outcome class + ok → ACKNOWLEDGED (still not verified); + !ok → EXECUTION_FAILED', () => {
    expect(classifyWriteOutcome({ ok: true, message: 'done' }).state).toBe('ACKNOWLEDGED');
    expect(classifyWriteOutcome({ ok: false, message: 'x' }).state).toBe('EXECUTION_FAILED');
  });
});

// ── Mounted panel wiring ─────────────────────────────────────────────────────
describe('M365WritePanel — surfaces the honest outcome', () => {
  const snaps: ConnectorSyncSnapshot[] = [];

  function routeExecute(result: ConnectorWriteResult): void {
    route(IpcChannel.M365ActionExecute, () => result);
  }

  async function send(): Promise<void> {
    fireEvent.change(screen.getByPlaceholderText('To (comma-separated)'), { target: { value: 'a@b.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send…' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm send' }));
  }

  it('UNKNOWN outcome renders "Outcome unknown" + reconciliation, NOT "Sent"', async () => {
    routeExecute({ ok: false, message: null, data: { outcome: 'UNKNOWN' } });
    render(<M365WritePanel connectorId="microsoft-entra" accountId="acct-1" snaps={snaps} />);
    await send();
    const status = await screen.findByRole('status');
    expect(status.textContent).toContain('Outcome unknown');
    expect(status.textContent).toContain('Reconciliation required');
    expect(status.textContent).not.toContain('Sent');
  });

  it('ACKNOWLEDGED outcome renders "Acknowledged" and clears the compose fields', async () => {
    routeExecute({ ok: true, message: 'queued', data: { outcome: 'ACKNOWLEDGED' } });
    render(<M365WritePanel connectorId="microsoft-entra" accountId="acct-1" snaps={snaps} />);
    await send();
    const status = await screen.findByRole('status');
    expect(status.textContent).toContain('Acknowledged');
    await waitFor(() =>
      expect((screen.getByPlaceholderText('To (comma-separated)') as HTMLInputElement).value).toBe(''),
    );
  });

  it('DENIED outcome renders "Denied", keeps the compose content', async () => {
    routeExecute({ ok: false, message: null, data: { outcome: 'DENIED' } });
    render(<M365WritePanel connectorId="microsoft-entra" accountId="acct-1" snaps={snaps} />);
    await send();
    const status = await screen.findByRole('status');
    expect(status.textContent).toContain('Denied');
    expect((screen.getByPlaceholderText('To (comma-separated)') as HTMLInputElement).value).toBe('a@b.com');
  });
});
