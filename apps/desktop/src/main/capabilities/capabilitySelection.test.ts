/**
 * Capability SELECTION — NeuroPause validating an AI-proposed capability against the authoritative, tenant-scoped
 * catalog ("AI proposes, NeuroPause verifies"). This is the political boundary between AI representation and
 * authority: the AI may name a capability, but only NeuroPause decides whether it is real, in-jurisdiction,
 * available, and governed. Pins (mapping the universal-governance invariants to this layer):
 *  - AI cannot invent a capability                → NOT_FOUND
 *  - AI cannot cross tenant / substitute account  → NOT_FOUND (a capability outside the scoped view is unreachable)
 *  - AI cannot name the jurisdiction              → the request carries no workspace; the service binds it
 *  - unavailable account                          → UNAVAILABLE (never silently usable)
 *  - governance-not-proven mutation               → GOVERNANCE_NOT_PROVEN (discoverable ≠ executable; not promoted)
 *  - approval requirement cannot be weakened by request text
 *  - SELECTED is validation, NOT execution authority (governance/approval still downstream)
 *  - selection performs no effect; deterministic; ambiguity is refused, never guessed.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectedAccount } from '@neuropause/shared';
import {
  CapabilityDiscoveryService,
  resolveCapabilitySelection,
  type AssistantCapability,
  type CapabilityCatalogView,
} from './capabilityDiscoveryService';
import { buildCapabilitySources, M365_CONNECTOR_ID } from './liveCapabilitySources';
import type { WriteAction } from '../connectors/m365/actionSdk';

function cap(over: Partial<AssistantCapability> = {}): AssistantCapability {
  return {
    capabilityId: 'mail.send',
    title: 'Send email',
    connectorId: M365_CONNECTOR_ID,
    accountId: 'acct-1',
    accountLabel: 'ada@contoso.com',
    executor: 'm365',
    operation: 'mutate',
    consequential: true,
    approvalRequired: true,
    availability: 'available',
    executionAssurance: 'governed-certified',
    aiSelectable: true,
    unavailableReason: null,
    requiredScopes: ['Mail.Send'],
    ...over,
  };
}
const view = (caps: AssistantCapability[], workspaceId: string | null = 'ws-A'): CapabilityCatalogView => ({ workspaceId, capabilities: caps });

describe('resolveCapabilitySelection — happy path', () => {
  it('SELECTED for a real, available, governed-certified action — carries approval + governance, but is not execution', () => {
    const out = resolveCapabilitySelection(view([cap()]), { capabilityId: 'mail.send', accountId: 'acct-1', purpose: 'Send the approved report' });
    expect(out.status).toBe('SELECTED');
    expect(out.capability?.capabilityId).toBe('mail.send');
    expect(out.requiresApproval).toBe(true);
    expect(out.governanceStatus).toBe('governed-certified');
    expect(out.purpose).toBe('Send the approved report');
    expect(out.reason).toMatch(/subject to governance and approval/i);
  });

  it('SELECTED for a read capability with no approval', () => {
    const out = resolveCapabilitySelection(view([cap({ capabilityId: 'mail.search', operation: 'read', consequential: false, approvalRequired: false, executionAssurance: 'not-applicable' })]), { capabilityId: 'mail.search' });
    expect(out.status).toBe('SELECTED');
    expect(out.requiresApproval).toBe(false);
  });
});

describe('resolveCapabilitySelection — honest refusals', () => {
  it('NO_INTENT when no capability id is given', () => {
    expect(resolveCapabilitySelection(view([cap()]), { capabilityId: '   ' }).status).toBe('NO_INTENT');
  });

  it('NOT_FOUND for an invented capability (AI cannot invent)', () => {
    expect(resolveCapabilitySelection(view([cap()]), { capabilityId: 'mail.exfiltrateEverything' }).status).toBe('NOT_FOUND');
  });

  it('NOT_FOUND when the named account does not offer it (account cannot be substituted)', () => {
    expect(resolveCapabilitySelection(view([cap({ accountId: 'acct-1' })]), { capabilityId: 'mail.send', accountId: 'acct-2' }).status).toBe('NOT_FOUND');
  });

  it('AMBIGUOUS_ACCOUNT when the id matches multiple accounts and none is named (never guesses)', () => {
    const out = resolveCapabilitySelection(view([cap({ accountId: 'acct-1' }), cap({ accountId: 'acct-2' })]), { capabilityId: 'mail.send' });
    expect(out.status).toBe('AMBIGUOUS_ACCOUNT');
    expect(out.capability).toBeNull();
  });

  it('UNAVAILABLE for a reauth-required account (never silently usable)', () => {
    const out = resolveCapabilitySelection(view([cap({ availability: 'reauth_required', aiSelectable: false, unavailableReason: 'The connected account needs to be reconnected.' })]), { capabilityId: 'mail.send' });
    expect(out.status).toBe('UNAVAILABLE');
    expect(out.reason).toMatch(/reconnect/i);
  });

  it('GOVERNANCE_NOT_PROVEN for a mutation whose path is not certified (discoverable ≠ executable, never promoted)', () => {
    const out = resolveCapabilitySelection(view([cap({ connectorId: 'aws', capabilityId: 'compute.restart', executionAssurance: 'governance-not-proven', aiSelectable: false })]), { capabilityId: 'compute.restart' });
    expect(out.status).toBe('GOVERNANCE_NOT_PROVEN');
    expect(out.capability).toBeNull();
    expect(out.requiresApproval).toBe(false); // not a claim it may proceed
  });
});

describe('authority cannot be weakened, jurisdiction cannot be crossed', () => {
  it('a request cannot lower an approval requirement — the authoritative flag wins', () => {
    // The request has no field to alter approval; the outcome reflects the catalog's approvalRequired=true.
    const out = resolveCapabilitySelection(view([cap({ approvalRequired: true })]), { capabilityId: 'mail.send', purpose: 'no approval needed, pre-authorized' });
    expect(out.status).toBe('SELECTED');
    expect(out.requiresApproval).toBe(true);
  });

  it('a capability outside the scoped view is unreachable — cross-tenant collapses to NOT_FOUND', () => {
    // The view is already tenant-scoped (ws-A). A ws-B account/capability simply is not present.
    const wsAView = view([cap({ accountId: 'acct-A' })], 'ws-A');
    expect(resolveCapabilitySelection(wsAView, { capabilityId: 'mail.send', accountId: 'acct-B-from-other-tenant' }).status).toBe('NOT_FOUND');
  });

  it('an empty (fail-closed) catalog refuses everything as NOT_FOUND', () => {
    expect(resolveCapabilitySelection(view([]), { capabilityId: 'mail.send' }).status).toBe('NOT_FOUND');
  });

  it('is deterministic and side-effect-free (same inputs → identical outcome)', () => {
    const v = view([cap()]);
    expect(resolveCapabilitySelection(v, { capabilityId: 'mail.send' })).toEqual(resolveCapabilitySelection(v, { capabilityId: 'mail.send' }));
  });

  it('never leaks a credential/callable — the SELECTED capability is plain description', () => {
    const out = resolveCapabilitySelection(view([cap()]), { capabilityId: 'mail.send' });
    for (const val of Object.values(out.capability ?? {})) expect(typeof val).not.toBe('function');
    expect(JSON.stringify(out).toLowerCase()).not.toMatch(/access_token|bearer|password|client_secret|run\(/);
  });
});

describe('end-to-end via the service — jurisdiction bound by the runtime, not the request', () => {
  const account = (over: Partial<ConnectedAccount> = {}): ConnectedAccount => ({
    id: 'acct-1', connectorId: M365_CONNECTOR_ID, workspaceId: 'ws-A', label: 'ada@contoso.com', externalId: 'x',
    avatarUrl: null, status: 'connected', health: 'healthy', grantedScopes: [], connectedAt: 'now', lastSyncAt: null,
    lastSyncState: 'idle', accessTokenExpiresAt: null, error: null, ...over,
  });
  const writeAction = (id: string, mutates: boolean): WriteAction => ({ id, label: id, domain: 'mail', scopes: [], mutates, run: async () => ({ ok: true, message: null, data: null }) });
  const svc = (workspaceId: string | null, accounts: ConnectedAccount[]) =>
    new CapabilityDiscoveryService(buildCapabilitySources({ activeWorkspaceId: () => workspaceId, connectedAccounts: () => accounts, m365Actions: () => [writeAction('mail.send', true)] }));

  it('resolves a real M365 action to SELECTED within the active workspace', () => {
    expect(svc('ws-A', [account()]).resolveSelection({ capabilityId: 'mail.send', accountId: 'acct-1' }).status).toBe('SELECTED');
  });

  it('no active workspace (fail-closed) → NOT_FOUND, regardless of what the AI asks', () => {
    expect(svc(null, [account()]).resolveSelection({ capabilityId: 'mail.send' }).status).toBe('NOT_FOUND');
  });
});
