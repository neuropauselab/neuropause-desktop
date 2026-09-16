/**
 * S23 · the certification kit, BACK-FILLED with M365 `mail.send` as the reference record — the kit derived
 * RETROACTIVELY from the one proven path. Every artifact points at the REAL module that proved it (the shared
 * authority/oracle derivations, the real propose-core refusals, the real CST EffectBinding field set, the shipped
 * read-back orchestrator). The kit DESCRIBES what was proven; nothing here invents a new standard.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { runKitChecks, kitComplete, type CapabilityCertificationRecord, type RefusalFixture } from './certificationKit';
import { deriveAuthority, deriveOracle } from '../liveBrain/executionGate';
import { runProposeM365Action, type ProposeM365Deps } from './capabilityProposeCore';
import type { CapabilitySelectionOutcome, AssistantCapability } from './capabilityDiscoveryService';

const TARGET = { connector: 'microsoft-entra', account: 'acct-1', tenantId: 'ws-1', scope: 'ws-1' };

// ── The real propose edge, driven through the PURE core with minimal fixtures. ───────────────────────────────
const selectedCap = (capabilityId: string): AssistantCapability =>
  ({
    capabilityId, title: 'x', connectorId: 'microsoft-entra', accountId: 'acct-1', accountLabel: 'Mailbox',
    executor: 'm365', operation: 'mutate', consequential: true, approvalRequired: true,
    availability: 'available', executionAssurance: 'governed-certified',
  }) as unknown as AssistantCapability;

const selected = (capabilityId: string): CapabilitySelectionOutcome =>
  ({
    status: 'SELECTED', capability: selectedCap(capabilityId), requiresApproval: true,
    governanceStatus: 'governed-certified', purpose: 'send-email', reason: 'selected',
  }) as unknown as CapabilitySelectionOutcome;

const NOT_FOUND: CapabilitySelectionOutcome = {
  status: 'NOT_FOUND', capability: null, requiresApproval: false, governanceStatus: null, purpose: null, reason: 'nf',
} as unknown as CapabilitySelectionOutcome;

function proposeWith(over: Partial<ProposeM365Deps>, params: Record<string, unknown>): string | null {
  const deps: ProposeM365Deps = {
    resolveSelection: () => selected('mail.send'),
    subjectId: () => 'user-1',
    scope: () => ({ tenantId: 'org-1', workspaceId: 'ws-1' }),
    ...over,
  };
  const r = runProposeM365Action(deps, { capabilityId: 'mail.send', accountId: 'acct-1', purpose: 'p', params });
  return r.ok ? null : r.reason;
}

const goodMailParams = { to: ['neuropause033@gmail.com'], subject: 'hello', body: 'world' };

const refusalFixtures: RefusalFixture[] = [
  { name: 'principal-unresolved', expectReason: 'PRINCIPAL_UNRESOLVED',
    run: () => proposeWith({ subjectId: () => null }, goodMailParams) },
  { name: 'capability-not-selected', expectReason: 'CAPABILITY_NOT_SELECTED',
    run: () => proposeWith({ resolveSelection: () => NOT_FOUND }, goodMailParams) },
  { name: 'unsupported-action (connector certified ≠ action certified, at the propose edge)', expectReason: 'UNSUPPORTED_ACTION',
    run: () => proposeWith({ resolveSelection: () => selected('calendar.create') }, { subject: 's', start: '2026-08-20T10:00:00Z', end: '2026-08-20T11:00:00Z' }) },
  { name: 'invalid-params (comma-hardening, S12)', expectReason: 'INVALID_PARAMS',
    run: () => proposeWith({}, { to: ['a@b.com,evil@x.com'], subject: 's', body: 'b' }) },
];

// ── The reference record: mail.send, each artifact the PROVEN thing. ─────────────────────────────────────────
export const mailSendCertification: CapabilityCertificationRecord = {
  entry: { capabilityId: 'mail.send', connectorId: 'microsoft-entra', mutates: true, label: 'Send email' },
  authority: deriveAuthority, // the shared derivation both propose and execute use (single source)
  oracle: deriveOracle, // the registry: mail.send → verifyEffect (send-corroboration)
  paramsSchema: z
    .object({
      to: z.array(z.string().min(3).refine((s) => !s.includes(','), 'comma-hardened')).min(1),
      subject: z.string(),
      body: z.string(),
    })
    .strict(),
  cstBindingFields: ['executor', 'target', 'accountId', 'actionId', 'params', 'actor', 'tenantId', 'decisionId'],
  refusalFixtures,
  readBackPlan:
    'verifyGovernedSend → verifyEffect: corroborated Sent Items match (recipient + subject + timestamp window, ' +
    'never id alone) + Inbox bounce scan; terminals VERIFIED_SUCCESS / VERIFY_FAILED; UNKNOWN → HOLD, never auto-promoted.',
  evidenceTemplate:
    'certification/source-update/PHASE-I-A3-NEUROPAUSE-OS-*-EVIDENCE.md — labels SOURCE-PROVEN / TEST-VERIFIED / ' +
    'LIVE-VERIFIED, never stronger than the evidence beneath.',
};

describe('S23 · certification kit — mail.send back-fill (the reference record)', () => {
  const findings = runKitChecks(mailSendCertification, {
    target: TARGET,
    goodParams: goodMailParams,
    badParams: [{ to: 'x' }, { to: ['a,b@c.com'], subject: 's', body: 'b' }, {}, { to: [], subject: 's', body: 'b' }],
  });

  it('the kit COMPLETES for mail.send — every artifact check passes', () => {
    const failed = findings.filter((f) => !f.ok);
    expect(failed).toEqual([]);
    expect(kitComplete(findings)).toBe(true);
  });

  it('the oracle artifact is a REAL registry entry (verifiable, named oracle) — not an UNVERIFIABLE declaration', () => {
    const plan = mailSendCertification.oracle('mail.send');
    expect(plan.verifiable).toBe('send-corroboration');
    expect(plan.oracleId).toBe('verifyEffect');
  });

  it('the authority artifact is the SHARED derivation and requires human approval', () => {
    const auth = mailSendCertification.authority('mail.send', TARGET);
    expect(auth.requiresApproval).toBe(true);
    expect(auth.requiredGate).toBe('human-confirm + CST admission');
  });

  it('every refusal fixture refuses with its typed reason at the REAL propose core', () => {
    for (const f of mailSendCertification.refusalFixtures) {
      expect({ name: f.name, got: f.run() }).toEqual({ name: f.name, got: f.expectReason });
    }
  });

  it('kit-complete is NOT "certified" — the kit is pure description; certification additionally needs the live chain', () => {
    // The kit exposes no certifier, grants nothing, and its record carries no callable into any executor.
    expect(Object.keys(mailSendCertification)).not.toContain('certify');
    expect(JSON.stringify(Object.keys(mailSendCertification))).not.toMatch(/execute|send|confirm/i);
  });
});
