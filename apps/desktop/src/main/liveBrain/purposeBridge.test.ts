import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bridgePurpose, type BridgeDeps } from './purposeBridge';
import { evaluatePurpose } from '../purposeEngine/purposeEngine';
import { composeCapabilityGraph } from '../capabilityGraph/capabilityGraph';
import { capabilityGraphSources } from '../capabilityGraph/liveSources';

const consentReady = () =>
  evaluatePurpose({ text: 'send-email' }, {
    recognize: () => true, route: () => ({ capability: 'mail.send', connector: 'microsoft-entra', workflow: 'wf' }),
    authority: () => 'permit', propose: () => ({ capability: 'mail.send', summary: 'send' }),
  });
const notReady = () =>
  evaluatePurpose({ text: 'send-email' }, {
    recognize: () => true, route: () => 'unknown', authority: () => 'permit', propose: () => null,
  }); // route unknown → halts at RECOGNIZED, no proposal

const graph = (mutations: { capabilityId: string; connectorId: string }[] = [{ capabilityId: 'mail.send', connectorId: 'microsoft-entra' }]) =>
  composeCapabilityGraph(capabilityGraphSources({ mutations: () => mutations, scope: () => true }));

const deps = (o: Partial<BridgeDeps> = {}): BridgeDeps => ({
  evaluation: consentReady(), graph: graph(), tenantId: 'tenant-A', scope: 'ws-A', evidence: [], ...o,
});

describe('S4.1 · L5 operational bridge', () => {
  it('BRIDGED — a consent-ready purpose maps to its ONE resolved, governed-routed capability', () => {
    const r = bridgePurpose(deps());
    expect(r.status).toBe('BRIDGED');
    if (r.status !== 'BRIDGED') return;
    expect(r.bridge.capabilities).toEqual(['mail.send']);
    expect(r.bridge.consentState).toBe('CONSENT_READY');
    expect(r.bridge.tenantId).toBe('tenant-A');
    expect(r.bridge.purposeId).toBe('purpose:send-email');
  });

  it('NOT_READY — a purpose that is not consent-ready maps NO capability', () => {
    const r = bridgePurpose(deps({ evaluation: notReady() }));
    expect(r.status).toBe('NOT_READY');
  });

  it('NOTHING INFERRED — a resolved capability that is NOT a governed route is not mapped (never because merely possible)', () => {
    // The purpose resolves mail.send, but the L4 graph has no governed route for it.
    const r = bridgePurpose(deps({ graph: graph([{ capabilityId: 'chat.post', connectorId: 'slack' }]) }));
    expect(r.status).toBe('NOT_READY');
    if (r.status !== 'NOT_READY') return;
    expect(r.reason).toMatch(/governed route/);
  });

  it('GROUNDED (S4.2 fix) — an untrusted propose() naming a capability != the purpose route → NOT_READY', () => {
    const ev = evaluatePurpose({ text: 'send-email' }, {
      recognize: () => true, route: () => ({ capability: 'mail.send', connector: 'microsoft-entra', workflow: 'wf' }),
      authority: () => 'permit', propose: () => ({ capability: 'mail.deleteAllFolders', summary: 'send' }),
    });
    const r = bridgePurpose(deps({ evaluation: ev }));
    expect(r.status).toBe('NOT_READY');
    if (r.status === 'NOT_READY') expect(r.reason).toMatch(/does not match/);
  });

  it('ZERO-RUNTIME-IMPORT — types only; the bridge holds no authority', () => {
    const src = readFileSync(join(__dirname, 'purposeBridge.ts'), 'utf8');
    expect(src.match(/^import(?!\s+type\b)[^\n]*/gm) ?? []).toEqual([]);
    expect(src).not.toMatch(/\bimport\s*\(|\brequire\s*\(/);
  });
});
