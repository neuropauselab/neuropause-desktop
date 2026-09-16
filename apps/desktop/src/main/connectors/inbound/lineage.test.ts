/**
 * S119 — inbound-event lineage: a READ-ONLY, tenant-scoped projection over the S114 verified webhook
 * events, proven against the REAL EventBus ring. Adversarial: tenant isolation, payload-cannot-forge-
 * tenant, fail-closed on unresolved/malformed, no credentials, no ERP mutation, S114 semantics intact.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EventBus } from '../../platform/eventBus';
import { projectInboundLineage, readInboundLineage, summarizeInboundLineage, summarizeInboundLineageTrend, composeConnectorInboundIntelligence, type InboundLineageRow } from './lineage';
import type { PlatformEventInput } from '@neuropause/shared';

function row(connectorId: string, provider: string, receivedAt: number): InboundLineageRow {
  return { eventId: `${connectorId}-${receivedAt}`, connectorId, provider, verifiedSource: provider, receivedAt, tenantId: 'tenant-A', dedupeRef: null, credentialsPresent: false };
}

function inbound(connectorId: string, provider: string, over: Record<string, string | number | boolean | null> = {}): PlatformEventInput {
  return {
    type: 'connector.online',
    category: 'connector',
    source: 'connectors',
    actor: { kind: 'connector', id: connectorId },
    resource: { type: 'connector', id: connectorId, name: null },
    metadata: { connectorId, provider, kind: 'inbound_webhook', receivedAt: 1_700_000_000_000, ...over },
  };
}

function busFor(tenantRef: { t: string | null }): EventBus {
  const bus = new EventBus({});
  bus.bindTenant(() => tenantRef.t);
  return bus;
}

describe('S119 · inbound-event lineage (read-only, tenant-scoped)', () => {
  it('projects a verified inbound webhook for the reader tenant only', () => {
    const ref = { t: 'tenant-A' as string | null };
    const bus = busFor(ref);
    bus.publish(inbound('github', 'github'));
    ref.t = 'tenant-B';
    bus.publish(inbound('slack', 'slack'));

    ref.t = 'tenant-A';
    const a = readInboundLineage(bus, 'tenant-A');
    expect(a.map((r) => r.connectorId)).toEqual(['github']);
    expect(a[0]).toMatchObject({ provider: 'github', verifiedSource: 'github', tenantId: 'tenant-A', dedupeRef: null, credentialsPresent: false });
  });

  it('a reader CANNOT see another tenant’s lineage (isolation)', () => {
    const ref = { t: 'tenant-A' as string | null };
    const bus = busFor(ref);
    bus.publish(inbound('github', 'github'));
    ref.t = 'tenant-B';
    const b = readInboundLineage(bus, 'tenant-B');
    expect(b).toEqual([]); // A's delivery is invisible to B
  });

  it('a webhook payload CANNOT forge tenant identity (authoritative bus stamp wins)', () => {
    const ref = { t: 'tenant-A' as string | null };
    const bus = busFor(ref);
    // the delivery metadata lies about its tenant; the bus stamps the real one (tenant-A)
    bus.publish(inbound('github', 'github', { tenantId: 'tenant-B-EVIL' }));
    ref.t = 'tenant-A';
    const a = readInboundLineage(bus, 'tenant-A');
    expect(a).toHaveLength(1);
    expect(a[0].tenantId).toBe('tenant-A'); // never the forged value
    ref.t = 'tenant-B-EVIL';
    expect(readInboundLineage(bus, 'tenant-B-EVIL')).toEqual([]); // forged tenant reads nothing
  });

  it('non-inbound connector events are excluded', () => {
    const events = [
      { id: 'e1', tenantId: 'tenant-A', type: 'connector.online', timestamp: '2026-09-04T00:00:00Z', metadata: { connectorId: 'x', provider: 'github' /* no kind */ } },
    ] as never;
    expect(projectInboundLineage(events, 'tenant-A')).toEqual([]);
  });

  it('malformed lineage (missing connectorId or provider) is DROPPED, not fabricated', () => {
    const events = [
      { id: 'e1', tenantId: 'tenant-A', type: 'connector.online', timestamp: '2026-09-04T00:00:00Z', metadata: { provider: 'github', kind: 'inbound_webhook' } },
      { id: 'e2', tenantId: 'tenant-A', type: 'connector.online', timestamp: '2026-09-04T00:00:00Z', metadata: { connectorId: 'gh', kind: 'inbound_webhook' } },
    ] as never;
    expect(projectInboundLineage(events, 'tenant-A')).toEqual([]);
  });

  it('duplicate deliveries remain DISTINCT rows and dedupeRef stays null (S114 dedupe semantics unchanged)', () => {
    const ref = { t: 'tenant-A' as string | null };
    const bus = busFor(ref);
    bus.publish(inbound('github', 'github'));
    bus.publish(inbound('github', 'github'));
    const rows = readInboundLineage(bus, 'tenant-A');
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.eventId)).size).toBe(2); // distinct event ids
    expect(rows.every((r) => r.dedupeRef === null)).toBe(true);
  });

  it('fail-closed: no resolved tenant → no lineage', () => {
    const ref = { t: null as string | null };
    const bus = busFor(ref);
    ref.t = 'tenant-A';
    bus.publish(inbound('github', 'github'));
    ref.t = null;
    expect(readInboundLineage(bus, null)).toEqual([]);
    expect(projectInboundLineage([], '')).toEqual([]);
  });

  it('lineage rows carry NO credential/secret material and a fixed safe shape', () => {
    const ref = { t: 'tenant-A' as string | null };
    const bus = busFor(ref);
    bus.publish(inbound('github', 'github'));
    const [row] = readInboundLineage(bus, 'tenant-A');
    expect(Object.keys(row).sort()).toEqual(['connectorId', 'credentialsPresent', 'dedupeRef', 'eventId', 'provider', 'receivedAt', 'tenantId', 'verifiedSource']);
    const blob = JSON.stringify(row).toLowerCase();
    for (const forbidden of ['secret', 'token', 'signature', 'authorization', 'header', 'payload', 'rawbody']) {
      expect(blob).not.toContain(forbidden);
    }
  });

  it('S121 — summarizeInboundLineage rolls up per connector, most-recent first, no invented data', () => {
    const ref = { t: 'tenant-A' as string | null };
    const bus = busFor(ref);
    bus.publish(inbound('github', 'github', { receivedAt: 1000 }));
    bus.publish(inbound('github', 'github', { receivedAt: 3000 }));
    bus.publish(inbound('slack', 'slack', { receivedAt: 2000 }));
    const rows = readInboundLineage(bus, 'tenant-A');
    const summary = summarizeInboundLineage(rows);
    expect(summary.map((s) => s.connectorId)).toEqual(['github', 'slack']); // github last=3000 > slack last=2000
    const gh = summary.find((s) => s.connectorId === 'github')!;
    expect(gh).toMatchObject({ provider: 'github', events: 2, lastReceivedAt: 3000 });
  });

  it('S123 — inbound trend: <2 rows ⇒ not comparable (no fabricated trend)', () => {
    expect(summarizeInboundLineageTrend([]).comparable).toBe(false);
    expect(summarizeInboundLineageTrend([row('github', 'github', 1)]).comparable).toBe(false);
  });

  it('S123 — inbound trend classifies NEW, QUIET, and per-connector volume movement', () => {
    // previous half (older): github×1, slack×1 ; recent half (newer): github×2, notion×1 (slack goes quiet, notion is new)
    const rows = [
      row('github', 'github', 100),
      row('slack', 'slack', 200),
      row('github', 'github', 300),
      row('github', 'github', 400),
      row('notion', 'notion', 500),
      row('notion', 'notion', 600),
    ];
    // window 3, 6 rows → previous=[github,slack,github], recent=[github,notion,notion].
    const tr = summarizeInboundLineageTrend(rows, { window: 3 });
    expect(tr.comparable).toBe(true);
    expect(tr.newConnectors).toContain('notion'); // recent-only
    expect(tr.quietConnectors).toContain('slack'); // previous-only
    const gh = tr.byConnector.find((c) => c.connectorId === 'github');
    expect(gh?.direction).toBe('DECREASE'); // github 2 → 1
  });

  it('S123 — inbound trend is order-independent (sorts by receivedAt) and credential-free', () => {
    const shuffled = [row('a', 'a', 400), row('a', 'a', 100), row('b', 'b', 300), row('a', 'a', 200)];
    const tr = summarizeInboundLineageTrend(shuffled, { window: 2 });
    expect(tr.comparable).toBe(true);
    const blob = JSON.stringify(tr).toLowerCase();
    for (const forbidden of ['secret', 'token', 'signature', 'authorization', 'payload', 'rawbody']) {
      expect(blob).not.toContain(forbidden);
    }
  });

  it('S135 — connector intelligence merges count/latest/trend/state per connector (descriptive only)', () => {
    // github increases (prev 1 → recent 2), slack is QUIET (prev-only), stripe is NEW (recent-only).
    const rows = [
      row('github', 'github', 100), row('slack', 'slack', 150), // previous half
      row('github', 'github', 300), row('github', 'github', 400), row('stripe', 'stripe', 350), // recent half
    ];
    const intel = composeConnectorInboundIntelligence(rows, { window: 3 });
    const by = new Map(intel.map((c) => [c.connectorId, c]));
    expect(by.get('github')!.events).toBe(3);
    expect(by.get('github')!.state).toBe('ACTIVE'); // present in both windows
    expect(by.get('github')!.trendDirection).toBe('INCREASE');
    expect(by.get('github')!.lastReceivedAt).toBe(400);
    expect(by.get('stripe')!.state).toBe('NEW');
    expect(by.get('slack')!.state).toBe('QUIET');
    // honest descriptive fields on every connector
    for (const c of intel) {
      expect(c.correlatable).toBe(false); // inbound carries no correlationId (S126)
      expect(c.dedupeRefStatus).toBe('absent'); // S114 carries no dedupe reference
      expect(c.verifiedSource).toBe(c.provider);
      expect(c.sampleEventIds.length).toBeGreaterThan(0);
    }
  });

  it('S135 — intelligence: not comparable (fewer than two rows) ⇒ ACTIVE + null trend, never fabricated', () => {
    expect(composeConnectorInboundIntelligence([])).toEqual([]);
    const one = composeConnectorInboundIntelligence([row('github', 'github', 1)]);
    expect(one).toHaveLength(1);
    expect(one[0].state).toBe('ACTIVE');
    expect(one[0].trendDirection).toBeNull();
    expect(one[0].events).toBe(1);
  });

  it('S135 — intelligence is credential-free + bounded provenance', () => {
    const rows = Array.from({ length: 20 }, (_, i) => row('github', 'github', i + 1));
    const intel = composeConnectorInboundIntelligence(rows);
    expect(intel[0].sampleEventIds.length).toBeLessThanOrEqual(5); // MAX_CONNECTOR_INTEL_EVENT_IDS
    const blob = JSON.stringify(intel).toLowerCase();
    for (const forbidden of ['secret', 'token', 'signature', 'authorization', 'payload', 'rawbody', 'credential']) {
      expect(blob).not.toContain(forbidden);
    }
  });

  it('STRUCTURAL: lineage imports ONLY the shared type — no store/command-bus/executor/router', () => {
    const src = readFileSync(join(__dirname, 'lineage.ts'), 'utf8');
    const importLines = src.split('\n').filter((l) => /^\s*import\s/.test(l));
    for (const line of importLines) expect(/from '@neuropause\/shared'/.test(line)).toBe(true);
    for (const forbidden of ['EnterpriseRecordStore', 'commandBus', 'dispatchCommand', 'executor', '/cst', 'connectorStore', './router', './verify']) {
      expect(src.includes(forbidden)).toBe(false);
    }
  });
});
