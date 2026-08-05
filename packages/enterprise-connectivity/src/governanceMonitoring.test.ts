import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createPlatformOperations } from '@neuropause/platform-operations';
import { createEnterpriseConnectivity } from './platform';
import { EC_MATRIX, ecReadiness, EXPECTED_ADAPTERS, EXPECTED_INFRA_PENDING } from './evidence';

// External systems, real enterprise data, or credentials — must NEVER be classified live.
const ADAPTER_OR_DATA = /Microsoft 365|Google Workspace|Slack|Teams|Salesforce|\bSAP\b|OpenAI|Anthropic|Gemini|Google Drive|OneDrive|Customer Records|ERP Data|CRM Data|Email Data|Calendar Data|File Metadata|AI Usage|Enterprise OAuth|Customer APIs|Production Webhooks|Enterprise Tenant/;

describe('E13 / E14 / E16 — monitoring, governance, honesty invariant', () => {
  it('reports live connector/sync/AI dashboards but OAuth + API errors as pending', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const platformOperations = createPlatformOperations(rt, { clock });
    const ec = createEnterpriseConnectivity(rt, { clock, platformOperations });

    const tiles = ec.monitoring().snapshot();
    expect(tiles.find((t) => t.dashboard === 'connector-health')!.live).toBe(true);
    expect(tiles.find((t) => t.dashboard === 'ai-provider-status')!.live).toBe(true);
    expect(tiles.find((t) => t.dashboard === 'authentication-status')!.live).toBe(false); // OAuth requires credentials
    expect(tiles.find((t) => t.dashboard === 'api-errors')!.live).toBe(false); // requires production traffic
    expect(ec.monitoring().platformHealth().reusedPlatformOperations).toBe(true);
  });

  it('audits every operation on the ONE chain with a replay id', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ec = createEnterpriseConnectivity(rt, { clock });
    const events: Array<Record<string, unknown>> = [];
    rt.events().subscribe((e) => e.type === 'connectivity.action', (e) => { events.push(e.payload as Record<string, unknown>); });
    await ec.connectors().register({ name: 'x', category: 'crm', system: 'HubSpot' });
    expect(ec.governance().verify()).toBe(true);
    expect(rt.audit().verify().valid).toBe(true);
    expect(events[events.length - 1]!['replayId']).toBeTruthy();
  });

  it('NEVER promotes evidence incorrectly — no live OAuth, customer data, or external AI usage', () => {
    const nonLiveClassifiedLive = EC_MATRIX.filter((m) => m.level === 'live-verified' && ADAPTER_OR_DATA.test(m.capability));
    expect(nonLiveClassifiedLive).toHaveLength(0);

    const level = (cap: string): string | undefined => EC_MATRIX.find((m) => m.capability === cap)?.level;
    expect(level('AI Usage')).toBe('business-data-pending');
    expect(level('Customer Records')).toBe('business-data-pending');
    expect(level('Enterprise OAuth Credentials')).toBe('infrastructure-pending');

    const r = ecReadiness();
    expect(r.total).toBe(EC_MATRIX.length);
    expect(r.liveVerified).toBe(11);
    expect(r.adapterVerified).toBe(EXPECTED_ADAPTERS); // 12
    expect(r.businessDataPending).toBe(7);
    expect(r.infrastructurePending).toBe(EXPECTED_INFRA_PENDING); // 4
  });
});
