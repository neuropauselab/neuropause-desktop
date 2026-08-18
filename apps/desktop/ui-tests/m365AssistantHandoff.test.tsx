/**
 * NeuroPause OS — Wave 2 / Slice 13. The renderer half of the assistant→panel flow: a mail proposal handed off by
 * the assistant prefills the EXISTING M365WritePanel through the Slice-12 feed, and is consumed EXACTLY ONCE
 * (amendment 3) — a remount / back-navigation must not re-fire the propose call or refill from a stale intent.
 *
 * This is the NON-frozen half (mailbox → panel). The MAIN half (assistant turn → envelope.mailIntent → mailbox)
 * is gated behind FG-3 and lands with the frozen field; it is not exercised here.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { route, clearRoutes } from './setup';
import { IpcChannel } from '@neuropause/shared';
import type { ConnectorDto, CapabilityProposeM365ActionResponse } from '@neuropause/shared';
import { EntraConnectorPanel } from '@renderer/connectors/EntraConnectorPanel';
import { setPendingMailProposal, peekPendingMailProposal, consumePendingMailProposal } from '@renderer/connectors/m365ProposalHandoff';

beforeEach(() => {
  cleanup();
  clearRoutes();
  consumePendingMailProposal(); // ensure an empty mailbox to start
  route(IpcChannel.ConnectorSyncState, () => []);
});
afterEach(() => {
  cleanup();
  consumePendingMailProposal();
});

function entraDto(): ConnectorDto {
  return {
    id: 'microsoft-entra',
    accounts: [{ id: 'acct-1', label: 'Work', grantedScopes: [], accessTokenExpiresAt: null }],
    scopes: [],
  } as unknown as ConnectorDto;
}

function routePropose(): Array<Record<string, unknown>> {
  const calls: Array<Record<string, unknown>> = [];
  const response: CapabilityProposeM365ActionResponse = {
    ok: true,
    proposal: { to: 'alice@example.com', subject: 'Report', body: 'Attached.' },
    provenance: { capabilityId: 'mail.send', accountId: 'acct-1' },
  };
  route(IpcChannel.CapabilityProposeM365Action, (payload: unknown) => {
    calls.push(payload as Record<string, unknown>);
    return response;
  });
  return calls;
}

describe('Slice 13 — assistant hand-off → M365WritePanel (consume-once)', () => {
  it('a handed-off proposal prefills the panel via the S12 feed on mount', async () => {
    setPendingMailProposal({ to: ['alice@example.com'], subject: 'Report', body: 'Attached.' });
    const calls = routePropose();
    render(<EntraConnectorPanel dto={entraDto()} />);

    await waitFor(() => expect((screen.getByPlaceholderText('Subject') as HTMLInputElement).value).toBe('Report'));
    expect((screen.getByPlaceholderText('To (comma-separated)') as HTMLInputElement).value).toBe('alice@example.com');
    expect(calls).toHaveLength(1); // fed through the propose feed exactly once
    expect(peekPendingMailProposal()).toBeNull(); // the mailbox was cleared on consume
  });

  it('a remount does not re-fire the propose call or refill from a stale intent', async () => {
    setPendingMailProposal({ to: ['alice@example.com'], subject: 'Report', body: 'Attached.' });
    const calls = routePropose();
    const first = render(<EntraConnectorPanel dto={entraDto()} />);
    await waitFor(() => expect(calls).toHaveLength(1));

    first.unmount();
    render(<EntraConnectorPanel dto={entraDto()} />);
    // The mailbox was consumed on the first mount; the second mount finds it empty.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(calls).toHaveLength(1);
    expect((screen.getByPlaceholderText('Subject') as HTMLInputElement).value).toBe(''); // no stale refill
  });

  it('with no pending proposal, mounting fires nothing', async () => {
    const calls = routePropose();
    render(<EntraConnectorPanel dto={entraDto()} />);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(calls).toHaveLength(0);
  });
});
