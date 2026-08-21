/**
 * FG-14 — the RENDERER half of causal-episode identity propagation, driven at RUNTIME.
 *
 * The main-process half (`fg14CausalIdentity.test.ts`) proves the value survives the observer,
 * real persistence and read-back. This file proves the half that was ACTUALLY BROKEN: the value
 * surviving the renderer hops, from the hand-off mailbox through the panel to the governed execute
 * IPC payload — as a rendered component tree, not as a source pin.
 *
 * WHY THIS FILE HAD TO EXIST: the three-field mail-intent shape is declared FOUR independent times
 * and none imports another, so TypeScript cannot catch a missed hop — a dropped identity compiles
 * clean and disappears silently, which is precisely how F-P40 arose. Runtime assertion is the only
 * backstop.
 *
 * NO EXTERNAL EFFECT: the execute channel is routed to an in-test stub. Nothing is sent.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import React from 'react';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { route, clearRoutes } from './setup';
import { IpcChannel } from '@neuropause/shared';
import type { ConnectorDto, CapabilityProposeM365ActionResponse } from '@neuropause/shared';
import { EntraConnectorPanel } from '@renderer/connectors/EntraConnectorPanel';
import { setPendingMailProposal, consumePendingMailProposal } from '@renderer/connectors/m365ProposalHandoff';

beforeEach(() => {
  cleanup();
  clearRoutes();
  consumePendingMailProposal();
  route(IpcChannel.ConnectorSyncState, () => []);
});
afterEach(() => {
  cleanup();
  consumePendingMailProposal();
});

function entraDto(): ConnectorDto {
  return {
    id: 'microsoft-entra',
    name: 'Microsoft Entra ID',
    category: 'identity',
    status: 'connected',
    accounts: [{ id: 'acct-1', label: 'ops@example.com', status: 'connected', grantedScopes: ['Mail.Send'] }],
    scopes: [],
  } as unknown as ConnectorDto;
}

/** Capture what the panel actually sends over the governed execute channel. */
function routeExecute(): Record<string, unknown>[] {
  const calls: Record<string, unknown>[] = [];
  route(IpcChannel.M365ActionExecute, (payload) => {
    calls.push(payload as Record<string, unknown>);
    return { ok: true, outcome: 'ACKNOWLEDGED', message: 'accepted' };
  });
  return calls;
}

function routePropose(): void {
  route(IpcChannel.CapabilityProposeM365Action, () => {
    const r: CapabilityProposeM365ActionResponse = {
      ok: true,
      proposal: { to: 'alice@example.com', subject: 'Report', body: 'Attached.' },
      provenance: { capabilityId: 'mail.send', accountId: 'acct-1' },
    } as CapabilityProposeM365ActionResponse;
    return r;
  });
}

async function confirmSend(): Promise<void> {
  await waitFor(() => expect(screen.getByText('Send…')).toBeTruthy());
  fireEvent.click(screen.getByText('Send…'));
  await waitFor(() => expect(screen.getByText('Confirm send')).toBeTruthy());
  fireEvent.click(screen.getByText('Confirm send'));
}

describe('FG-14 · renderer runtime propagation — the hop that was broken', () => {
  it('a correlationId handed to the mailbox reaches the governed execute payload VERBATIM', async () => {
    setPendingMailProposal({
      to: ['alice@example.com'],
      subject: 'Report',
      body: 'Attached.',
      correlationId: 'asst_RUNTIME_A',
    });
    routePropose();
    const calls = routeExecute();

    render(<EntraConnectorPanel dto={entraDto()} />);
    await waitFor(() => expect((screen.getByPlaceholderText('Subject') as HTMLInputElement).value).toBe('Report'));
    await confirmSend();

    await waitFor(() => expect(calls).toHaveLength(1));
    // VALUE equality across the whole renderer chain — not "a field exists".
    expect(calls[0].correlationId).toBe('asst_RUNTIME_A');
    // …and it did not disturb what is actually being sent.
    expect(calls[0].actionId).toBe('mail.send');
    expect(calls[0].confirmed).toBe(true);
  });

  it('ABSENT stays absent — no fabrication, and no fallback to another identity', async () => {
    setPendingMailProposal({ to: ['alice@example.com'], subject: 'Report', body: 'Attached.' });
    routePropose();
    const calls = routeExecute();

    render(<EntraConnectorPanel dto={entraDto()} />);
    await waitFor(() => expect((screen.getByPlaceholderText('Subject') as HTMLInputElement).value).toBe('Report'));
    await confirmSend();

    await waitFor(() => expect(calls).toHaveLength(1));
    // The key must be genuinely absent, not '' and not a substituted neighbour.
    expect('correlationId' in calls[0]).toBe(false);
    expect(calls[0].correlationId).toBeUndefined();
    expect(calls[0].correlationId).not.toBe(calls[0].connectorId);
    expect(calls[0].correlationId).not.toBe(calls[0].accountId);
  });

  it('two episodes requesting the SAME effect stay separable at the execute boundary', async () => {
    routePropose();
    const calls = routeExecute();

    setPendingMailProposal({ to: ['alice@example.com'], subject: 'Report', body: 'Attached.', correlationId: 'asst_RUN_A' });
    const first = render(<EntraConnectorPanel dto={entraDto()} />);
    await waitFor(() => expect((screen.getByPlaceholderText('Subject') as HTMLInputElement).value).toBe('Report'));
    await confirmSend();
    await waitFor(() => expect(calls).toHaveLength(1));
    first.unmount();

    setPendingMailProposal({ to: ['alice@example.com'], subject: 'Report', body: 'Attached.', correlationId: 'asst_RUN_B' });
    render(<EntraConnectorPanel dto={entraDto()} />);
    await waitFor(() => expect((screen.getByPlaceholderText('Subject') as HTMLInputElement).value).toBe('Report'));
    await confirmSend();
    await waitFor(() => expect(calls).toHaveLength(2));

    // Identical effect parameters — deliberately. The kernel will hash these to the SAME idem.
    expect(calls[0].params).toEqual(calls[1].params);
    // And the causal episodes remain distinct. SAME EFFECT REQUEST != SAME CAUSAL EPISODE.
    expect(calls[0].correlationId).toBe('asst_RUN_A');
    expect(calls[1].correlationId).toBe('asst_RUN_B');
    expect(calls[0].correlationId).not.toBe(calls[1].correlationId);
  });
});
