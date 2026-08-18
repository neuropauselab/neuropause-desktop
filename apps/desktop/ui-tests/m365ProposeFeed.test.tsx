/**
 * NeuroPause OS — Wave 2 / Slice 12. The FIRST production feed of `capability:m365.propose`.
 *
 * A dev-triggered renderer path invokes the data-only propose handler (Slice 11) with manual params; the
 * NeuroPause-VALIDATED proposal prefills the certified write panel; the human still confirms downstream through
 * the unchanged `M365ActionExecute` path. This pins the composition invariants at the new seam:
 *  - a proposal is DATA — it prefills, it never sends (propose ≠ consent; zero execute calls on propose);
 *  - the four refusal reasons render as typed, inert text — no prefill, no effect;
 *  - a transport error is NOT a semantic refusal — it is surfaced distinctly;
 *  - hostile subject/body arrive as INERT text (no HTML injection, no markup interpreted);
 *  - the action the human ultimately CONFIRMS is exactly the proposed action, executed through the certified IPC.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { route, clearRoutes } from './setup';
import { IpcChannel } from '@neuropause/shared';
import type { ConnectorDto, CapabilityProposeM365ActionResponse } from '@neuropause/shared';
import { EntraConnectorPanel } from '@renderer/connectors/EntraConnectorPanel';

type ExecCall = { connectorId: string; accountId: string; actionId: string; params: Record<string, unknown>; confirmed: boolean };

beforeEach(() => {
  cleanup();
  clearRoutes();
  // The panel loads directory sync on mount; route it to an empty snapshot so the mount is quiet.
  route(IpcChannel.ConnectorSyncState, () => []);
});
afterEach(() => cleanup());

/** A minimal Entra ConnectorDto with one connected account — only the fields the panel reads. */
function entraDto(): ConnectorDto {
  return {
    id: 'microsoft-entra',
    accounts: [{ id: 'acct-1', label: 'Work', grantedScopes: [], accessTokenExpiresAt: null }],
    scopes: [],
  } as unknown as ConnectorDto;
}

/** Route the propose channel to a fixed response, recording the requests it received. */
function routePropose(response: CapabilityProposeM365ActionResponse): Array<Record<string, unknown>> {
  const calls: Array<Record<string, unknown>> = [];
  route(IpcChannel.CapabilityProposeM365Action, (payload: unknown) => {
    calls.push(payload as Record<string, unknown>);
    return response;
  });
  return calls;
}

/** Route the certified execute IPC to a recorder returning an honest ACKNOWLEDGED outcome. */
function routeExecute(): ExecCall[] {
  const calls: ExecCall[] = [];
  route(IpcChannel.M365ActionExecute, (payload: unknown) => {
    calls.push(payload as ExecCall);
    return { ok: true, message: null, data: { outcome: 'ACKNOWLEDGED' } };
  });
  return calls;
}

const okProposal = (proposal: { to: string; subject: string; body: string }): CapabilityProposeM365ActionResponse => ({
  ok: true,
  proposal,
  provenance: { capabilityId: 'mail.send', accountId: 'acct-1' },
});

describe('Slice 12 — capability:m365.propose production feed', () => {
  it('a validated proposal prefills the panel and never sends by itself (propose ≠ consent)', async () => {
    const proposeCalls = routePropose(okProposal({ to: 'finance@example.com', subject: 'Monthly report', body: 'Attached.' }));
    const execCalls = routeExecute();
    render(<EntraConnectorPanel dto={entraDto()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Propose (dev)' }));

    // The panel's own compose fields (distinct placeholders from the dev inputs) receive the proposed values.
    await waitFor(() => expect((screen.getByPlaceholderText('Subject') as HTMLInputElement).value).toBe('Monthly report'));
    expect((screen.getByPlaceholderText('To (comma-separated)') as HTMLInputElement).value).toBe('finance@example.com');
    expect((screen.getByPlaceholderText('Body') as HTMLInputElement).value).toBe('Attached.');

    // Exactly one propose call, carrying the manual params + the re-resolvable capabilityId — and NO send occurred.
    expect(proposeCalls).toHaveLength(1);
    expect(proposeCalls[0].capabilityId).toBe('mail.send');
    expect(execCalls).toHaveLength(0);
  });

  it('the proposed action is exactly what the human then confirms through the certified path', async () => {
    routePropose(okProposal({ to: 'finance@example.com', subject: 'Approved report', body: 'Please review.' }));
    const execCalls = routeExecute();
    render(<EntraConnectorPanel dto={entraDto()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Propose (dev)' }));
    await waitFor(() => expect((screen.getByPlaceholderText('Subject') as HTMLInputElement).value).toBe('Approved report'));

    fireEvent.click(screen.getByRole('button', { name: 'Send…' }));
    expect(execCalls).toHaveLength(0); // reaching the confirm step is not an effect
    fireEvent.click(screen.getByRole('button', { name: 'Confirm send' }));

    await waitFor(() => expect(execCalls).toHaveLength(1));
    expect(execCalls[0].actionId).toBe('mail.send');
    expect(execCalls[0].confirmed).toBe(true);
    expect(execCalls[0].params).toEqual({ to: ['finance@example.com'], subject: 'Approved report', body: 'Please review.' });
    // The renderer supplies no authority — actor/tenant are resolved server-side.
    for (const forbidden of ['actor', 'actorId', 'tenant', 'tenantId', 'workspaceId', 'principal', 'token']) {
      expect(Object.keys(execCalls[0])).not.toContain(forbidden);
    }
  });

  it.each([
    ['PRINCIPAL_UNRESOLVED', /No resolved principal/],
    ['CAPABILITY_NOT_SELECTED', /not available on this account/],
    ['UNSUPPORTED_ACTION', /not supported yet/],
    ['INVALID_PARAMS', /parameters were rejected/],
  ] as const)('a %s refusal renders typed, inert text — no prefill, no send', async (reason, textRe) => {
    routePropose({ ok: false, reason, detail: 'sub-cause detail' });
    const execCalls = routeExecute();
    render(<EntraConnectorPanel dto={entraDto()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Propose (dev)' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(new RegExp(`Proposal refused — ${reason}`));
    expect(alert.textContent).toMatch(textRe);
    // The panel is NOT prefilled by a refusal, and nothing is sent.
    expect((screen.getByPlaceholderText('Subject') as HTMLInputElement).value).toBe('');
    expect(execCalls).toHaveLength(0);
  });

  it('a transport error is surfaced distinctly — not misreported as a semantic refusal', async () => {
    route(IpcChannel.CapabilityProposeM365Action, () => {
      throw new Error('boom');
    });
    render(<EntraConnectorPanel dto={entraDto()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Propose (dev)' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/transport error/);
    expect(alert.textContent).not.toMatch(/Proposal refused —/); // not one of the four typed reasons
  });

  it('a hostile subject/body arrives as INERT text — no markup is interpreted', async () => {
    const hostile = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>';
    routePropose(okProposal({ to: 'a@b.com', subject: hostile, body: hostile }));
    render(<EntraConnectorPanel dto={entraDto()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Propose (dev)' }));
    await waitFor(() => expect((screen.getByPlaceholderText('Subject') as HTMLInputElement).value).toBe(hostile));

    // The string is a VALUE, never parsed: no <img>/<script> element was injected, and no side effect ran.
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('script')).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });
});
