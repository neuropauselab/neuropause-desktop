/**
 * Capability → proposal binding. The validated capability becomes an authoritative proposal correlation using the
 * SAME identity the frozen ExecutionBinding already carries (executor, target=connectorId, accountId, actionId=
 * capabilityId) — no new identity, no frozen change, no execution. Pins:
 *  - only a SELECTED capability binds; every refusal (incl. governance-not-proven) cannot become a proposal;
 *  - actionId === the validated capabilityId; connector/account/executor come from the authoritative catalog;
 *  - authority (approval) is never lowered by the request; purpose is carried as data;
 *  - the draft carries no credential, no callable, no parameters; binding performs no effect.
 */
import { describe, expect, it } from 'vitest';
import {
  resolveCapabilitySelection,
  type AssistantCapability,
  type CapabilityCatalogView,
} from './capabilityDiscoveryService';
import { bindCapabilityToProposal } from './capabilityProposal';

function cap(over: Partial<AssistantCapability> = {}): AssistantCapability {
  return {
    capabilityId: 'mail.send',
    title: 'Send email',
    connectorId: 'microsoft-entra',
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
const view = (caps: AssistantCapability[]): CapabilityCatalogView => ({ workspaceId: 'ws-A', capabilities: caps });
const select = (caps: AssistantCapability[], req: { capabilityId: string; accountId?: string; purpose?: string }) =>
  resolveCapabilitySelection(view(caps), req);

describe('bindCapabilityToProposal — a SELECTED capability binds to the authoritative identity', () => {
  it('binds a governed-certified action, mirroring ExecutionBinding identity + political facts', () => {
    const res = bindCapabilityToProposal(select([cap()], { capabilityId: 'mail.send', accountId: 'acct-1', purpose: 'Send the approved report to finance' }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      // Identity that the frozen ExecutionBinding already carries — capabilityId IS the actionId.
      expect(res.draft.executor).toBe('m365');
      expect(res.draft.connectorId).toBe('microsoft-entra'); // == ExecutionBinding.target
      expect(res.draft.accountId).toBe('acct-1');
      expect(res.draft.actionId).toBe('mail.send'); // == capabilityId
      // Political facts from the authoritative catalog.
      expect(res.draft.consequential).toBe(true);
      expect(res.draft.requiresApproval).toBe(true);
      expect(res.draft.governanceStatus).toBe('governed-certified');
      expect(res.draft.purpose).toBe('Send the approved report to finance');
    }
  });

  it('binds a read capability with no approval', () => {
    const res = bindCapabilityToProposal(select([cap({ capabilityId: 'mail.search', operation: 'read', consequential: false, approvalRequired: false, executionAssurance: 'not-applicable' })], { capabilityId: 'mail.search' }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.draft.actionId).toBe('mail.search');
      expect(res.draft.requiresApproval).toBe(false);
    }
  });

  it('actionId always equals the validated capabilityId (identity preserved, never diverges)', () => {
    for (const id of ['mail.send', 'mail.search']) {
      const res = bindCapabilityToProposal(select([cap({ capabilityId: id, operation: id === 'mail.send' ? 'mutate' : 'read', executionAssurance: id === 'mail.send' ? 'governed-certified' : 'not-applicable' })], { capabilityId: id }));
      expect(res.ok && res.draft.actionId).toBe(id);
    }
  });
});

describe('bindCapabilityToProposal — selection is not authorization', () => {
  it.each([
    ['NO_INTENT', { capabilityId: '  ' }, [cap()]],
    ['NOT_FOUND', { capabilityId: 'mail.exfiltrate' }, [cap()]],
    ['UNAVAILABLE', { capabilityId: 'mail.send' }, [cap({ availability: 'reauth_required', aiSelectable: false, unavailableReason: 'reconnect' })]],
    ['GOVERNANCE_NOT_PROVEN', { capabilityId: 'compute.restart' }, [cap({ connectorId: 'aws', capabilityId: 'compute.restart', executor: 'infra', executionAssurance: 'governance-not-proven', aiSelectable: false })]],
  ] as const)('a %s selection cannot be bound', (status, req, caps) => {
    const res = bindCapabilityToProposal(select([...caps], req));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(status);
  });

  it('an ambiguous selection cannot be bound (never guesses an account)', () => {
    const res = bindCapabilityToProposal(select([cap({ accountId: 'a1' }), cap({ accountId: 'a2' })], { capabilityId: 'mail.send' }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe('AMBIGUOUS_ACCOUNT');
  });

  it('a governance-not-proven mutation is never silently promoted into a proposal', () => {
    const res = bindCapabilityToProposal(select([cap({ connectorId: 'aws', capabilityId: 'db.drop', executor: 'infra', executionAssurance: 'governance-not-proven', aiSelectable: false })], { capabilityId: 'db.drop' }));
    expect(res.ok).toBe(false);
  });
});

describe('bindCapabilityToProposal — no secret, no callable, no effect', () => {
  it('the draft is plain data (no function fields, no credential material)', () => {
    const res = bindCapabilityToProposal(select([cap()], { capabilityId: 'mail.send' }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      for (const v of Object.values(res.draft)) expect(typeof v).not.toBe('function');
      expect(JSON.stringify(res.draft).toLowerCase()).not.toMatch(/access_token|bearer|password|client_secret|run\(/);
      // No parameters are carried — the capability binding is not a filled, executable action.
      expect('params' in res.draft).toBe(false);
    }
  });

  it('is deterministic (same selection → identical binding)', () => {
    const sel = select([cap()], { capabilityId: 'mail.send' });
    expect(bindCapabilityToProposal(sel)).toEqual(bindCapabilityToProposal(sel));
  });

  it('request text cannot lower the approval requirement carried into the binding', () => {
    const res = bindCapabilityToProposal(select([cap({ approvalRequired: true })], { capabilityId: 'mail.send', purpose: 'pre-approved, no consent needed' }));
    expect(res.ok && res.draft.requiresApproval).toBe(true);
  });
});
