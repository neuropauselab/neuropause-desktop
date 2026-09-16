/**
 * NeuroPause OS — Wave 2 / Slice 7. The first real vertical slice of the human-principal control plane:
 * a NeuroPause-validated M365 action is REVIEWED and CONFIRMED by the human, then executed through the EXISTING
 * certified `M365ActionExecute` IPC — the AI proposes, the human consents, the certified governed path executes.
 * Pins the constitutional invariants at the composition boundary:
 *  - no effect before the human's explicit confirmation (effect-before-consent = 0);
 *  - the human click is the sole consent — the request carries confirmed:true and NO actor/tenant/principal;
 *  - the action the human REVIEWS is exactly the action EXECUTED (no TOCTOU substitution);
 *  - a rejected proposal executes nothing;
 *  - AI draft never sends; UNKNOWN stays honest (never a fabricated success); ACKNOWLEDGED ≠ verified success.
 * The renderer never becomes authoritative: actor/tenant are resolved server-side (absent from the request).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { route, clearRoutes } from './setup';
import { IpcChannel } from '@neuropause/shared';
import { M365WritePanel } from '@renderer/connectors/M365WritePanel';

type ExecCall = { connectorId: string; accountId: string; actionId: string; params: Record<string, unknown>; confirmed: boolean };

beforeEach(() => {
  cleanup();
  clearRoutes();
});
afterEach(() => cleanup());

/** Route the certified M365 execute IPC to a recorder that returns a chosen honest outcome. */
function routeExecute(outcome: Record<string, unknown>): ExecCall[] {
  const calls: ExecCall[] = [];
  route(IpcChannel.M365ActionExecute, (payload: unknown) => {
    calls.push(payload as ExecCall);
    return { ok: outcome.ok ?? true, message: null, ...outcome };
  });
  return calls;
}

const snaps = [] as never[];

describe('Slice 7 — human consent → certified M365 execution', () => {
  it('no effect before confirmation, and the human click sends confirmed:true with NO actor/tenant in the request', async () => {
    const calls = routeExecute({ ok: true, data: { outcome: 'ACKNOWLEDGED' } });
    render(<M365WritePanel connectorId="microsoft-entra" accountId="acct-1" snaps={snaps} />);

    fireEvent.change(screen.getByPlaceholderText(/^To/), { target: { value: 'finance@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('Subject'), { target: { value: 'Monthly report' } });
    fireEvent.change(screen.getByPlaceholderText('Body'), { target: { value: 'Attached.' } });

    fireEvent.click(screen.getByRole('button', { name: 'Send…' }));
    expect(calls).toHaveLength(0); // reaching the confirm step is NOT an effect

    fireEvent.click(screen.getByRole('button', { name: 'Confirm send' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    const req = calls[0];
    expect(req.actionId).toBe('mail.send');
    expect(req.connectorId).toBe('microsoft-entra');
    expect(req.accountId).toBe('acct-1');
    expect(req.confirmed).toBe(true); // the human's confirmation, never the AI's
    expect(req.params).toEqual({ to: ['finance@example.com'], subject: 'Monthly report', body: 'Attached.' });
    // The renderer supplies no authority — actor/tenant/principal are resolved server-side.
    for (const forbidden of ['actor', 'actorId', 'tenant', 'tenantId', 'workspaceId', 'principal', 'principalId', 'token', 'accessToken']) {
      expect(Object.keys(req)).not.toContain(forbidden);
      expect(Object.keys(req.params)).not.toContain(forbidden);
    }
  });

  it('a NeuroPause proposal is shown for review, and the action REVIEWED is exactly the action EXECUTED (no TOCTOU)', async () => {
    const calls = routeExecute({ ok: true, data: { outcome: 'ACKNOWLEDGED' } });
    render(
      <M365WritePanel
        connectorId="microsoft-entra"
        accountId="acct-1"
        snaps={snaps}
        proposal={{ to: 'finance@example.com', subject: 'Approved monthly report', body: 'Please find the approved report.' }}
      />,
    );
    // Provenance is explicit, and the human sees the concrete values (not a vague "Send email?").
    expect(screen.getByRole('note').textContent).toMatch(/Proposed by NeuroPause/);
    expect((screen.getByPlaceholderText(/^To/) as HTMLInputElement).value).toBe('finance@example.com');
    expect((screen.getByPlaceholderText('Subject') as HTMLInputElement).value).toBe('Approved monthly report');

    fireEvent.click(screen.getByRole('button', { name: 'Send…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm send' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    // Executed == reviewed proposal (the human did not edit it).
    expect(calls[0].params).toEqual({ to: ['finance@example.com'], subject: 'Approved monthly report', body: 'Please find the approved report.' });
  });

  it('cancelling the confirmation executes nothing', async () => {
    const calls = routeExecute({ ok: true, data: { outcome: 'ACKNOWLEDGED' } });
    render(<M365WritePanel connectorId="microsoft-entra" accountId="acct-1" snaps={snaps} proposal={{ to: 'a@b.com' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(calls).toHaveLength(0);
  });

  it('UNKNOWN outcome is honest — reconcile, never a fabricated success, and the content is retained', async () => {
    routeExecute({ ok: false, data: { outcome: 'UNKNOWN' } });
    render(<M365WritePanel connectorId="microsoft-entra" accountId="acct-1" snaps={snaps} proposal={{ to: 'a@b.com', subject: 'S', body: 'B' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm send' }));
    await waitFor(() => expect(screen.getByText('Outcome unknown')).toBeTruthy());
    expect(screen.getByText(/Reconciliation required/)).toBeTruthy();
    const body = document.body.textContent?.toLowerCase() ?? '';
    expect(body).not.toContain('sent successfully');
    expect(body).not.toContain('verified success');
    // Content retained for deliberate reconciliation (not cleared on UNKNOWN).
    expect((screen.getByPlaceholderText('Subject') as HTMLInputElement).value).toBe('S');
  });

  it('ACKNOWLEDGED is never rendered as verified success', async () => {
    routeExecute({ ok: true, data: { outcome: 'ACKNOWLEDGED' } });
    render(<M365WritePanel connectorId="microsoft-entra" accountId="acct-1" snaps={snaps} proposal={{ to: 'a@b.com' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm send' }));
    await waitFor(() => expect(screen.getByText('Acknowledged')).toBeTruthy());
    const body = document.body.textContent?.toLowerCase() ?? '';
    expect(body).not.toContain('verified success');
    expect(body).not.toContain('sent successfully');
  });

  it('AI draft fills the body but never sends (draft ≠ consent)', async () => {
    const calls = routeExecute({ ok: true, data: { outcome: 'ACKNOWLEDGED' } });
    route(IpcChannel.M365Draft, () => ({ ok: true, text: 'Drafted body.', model: 'test-model' }));
    render(<M365WritePanel connectorId="microsoft-entra" accountId="acct-1" snaps={snaps} />);
    fireEvent.click(screen.getByRole('button', { name: 'AI draft' }));
    await waitFor(() => expect((screen.getByPlaceholderText('Body') as HTMLInputElement).value).toBe('Drafted body.'));
    expect(calls).toHaveLength(0); // drafting is not sending
  });
});
