import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runDiscovery, type DiscoveryRequest } from './environmentDiscovery';
import { liveDiscoverySources, type DiscoveryEvidenceDeps } from './liveSources';
import type { RequiredElement } from '../environmentModel/environmentModel';
// REAL upstream — the fail-closed catalog path is exercised through the real service:
import {
  CapabilityDiscoveryService,
  type CapabilityCatalogView,
  type AssistantCapability,
} from '../capabilities/capabilityDiscoveryService';

const cap = (id: string): RequiredElement => ({ id, kind: 'capability', label: id });
const req = (ids: string[]): DiscoveryRequest => ({ purpose: 'send-email', minimumRequired: ids.map(cap) });

// A real-shaped AssistantCapability (the exact projection CapabilityDiscoveryService.catalog() returns).
const assistantCap = (capabilityId: string, availability: AssistantCapability['availability']): AssistantCapability => ({
  capabilityId,
  title: capabilityId,
  connectorId: 'microsoft-entra',
  accountId: 'acct-1',
  accountLabel: 'Work',
  executor: 'm365',
  operation: 'mutate',
  consequential: true,
  approvalRequired: true,
  availability,
  executionAssurance: 'governed-certified',
  aiSelectable: availability === 'available',
  unavailableReason: null,
  requiredScopes: [],
});
const view = (caps: AssistantCapability[]): CapabilityCatalogView => ({ workspaceId: 'ws-1', capabilities: caps });

const deps = (o: Partial<DiscoveryEvidenceDeps>): DiscoveryEvidenceDeps => ({
  workspaceResolved: () => true,
  connectedAccountCount: () => 1,
  catalog: () => view([]),
  ...o,
});

describe('L3 · live wiring — NEVER A SILENT SCAN (authority decided without touching the catalog)', () => {
  it('the real catalog probe is NEVER invoked when authority is absent (no workspace / no account)', () => {
    const catalog = vi.fn(() => view([assistantCap('mail.send', 'available')]));

    // No resolved workspace → authority 'unknown' → collection never runs.
    const r1 = runDiscovery(req(['mail.send']), liveDiscoverySources(deps({ workspaceResolved: () => false, catalog })));
    expect(r1.results[0].outcome).toBe('AUTHORITY_UNKNOWN');

    // Resolved workspace but zero connected accounts → authority 'denied' → collection never runs.
    const r2 = runDiscovery(req(['mail.send']), liveDiscoverySources(deps({ connectedAccountCount: () => 0, catalog })));
    expect(r2.results[0].outcome).toBe('DENIED');

    expect(catalog).not.toHaveBeenCalled(); // the scan never happened without authority
  });

  it('the catalog probe runs ONLY once authority is granted', () => {
    const catalog = vi.fn(() => view([assistantCap('mail.send', 'available')]));
    runDiscovery(req(['mail.send']), liveDiscoverySources(deps({ catalog })));
    expect(catalog).toHaveBeenCalled();
  });
});

describe('L3 · live wiring — collection classified from the REAL catalog shape', () => {
  it('granted: available capability → HAVE; reauth-required → NEED; absent from catalog → UNAVAILABLE', () => {
    const catalog = () =>
      view([assistantCap('mail.send', 'available'), assistantCap('mail.stale', 'reauth_required')]);
    const run = runDiscovery(
      req(['mail.send', 'mail.stale', 'mail.absent']),
      liveDiscoverySources(deps({ catalog })),
    );
    expect(run.results.map((r) => [r.element.id, r.outcome, r.state])).toEqual([
      ['mail.send', 'COLLECTED', 'HAVE'],
      ['mail.stale', 'COLLECTED', 'NEED'],
      ['mail.absent', 'COLLECTION_FAILED', 'UNAVAILABLE'],
    ]);
  });

  it('bound to the REAL CapabilityDiscoveryService — its fail-closed empty catalog → UNAVAILABLE (never fabricated)', () => {
    // A real service with no resolved workspace returns an empty catalog (fail-closed).
    const service = new CapabilityDiscoveryService({
      activeWorkspaceId: () => null,
      accounts: () => [],
      actionSources: () => [],
      mutationAssurance: () => 'governance-not-proven',
    });
    expect(service.catalog().capabilities).toEqual([]); // the real fail-closed contract

    // Authority is present (a workspace + account), but the real collector yields nothing → UNAVAILABLE.
    const run = runDiscovery(
      req(['mail.send']),
      liveDiscoverySources(deps({ catalog: () => service.catalog() })),
    );
    expect(run.results[0]).toMatchObject({ outcome: 'COLLECTION_FAILED', state: 'UNAVAILABLE' });
  });
});

describe('L3 · live wiring — invariant', () => {
  it('READ-ONLY ADAPTER — imports only TYPES; no value import into collection/execution', () => {
    const src = readFileSync(join(__dirname, 'liveSources.ts'), 'utf8');
    const valueImports = src.match(/^import\s+(?!type\b)[^;]*from\s+'[^']*'/gm) ?? [];
    expect(valueImports).toEqual([]);
  });
});
