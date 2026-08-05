import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createOperationsPlatform } from '@neuropause/operations';
import { createProductionPlatform } from '@neuropause/production';
import { createConnectorPlatform } from '@neuropause/connectors';
import { createExecutionPlatform } from '@neuropause/execution';
import { createIntegrationPlatform } from './platform';
import { INTEGRATION_MATRIX, integrationReadiness, EXPECTED_ADAPTERS, EXPECTED_INFRA_PENDING } from './evidence';
import { NO_INTEGRATION_DATA } from './constants';

const ADAPTER_OR_DATA = /^(SAP|Oracle|Dynamics|NetSuite|Salesforce|HubSpot|Microsoft 365|Google Workspace|Slack|Teams|Stripe|Epic|Oracle Health|Kafka|RabbitMQ|OpenAI|Anthropic|Gemini)$|Data$|not configured|not provided|network connections|message brokers|databases$|Customer Records/;

describe('E18, E20, E19, E22 — monitoring, documentation, governance, honesty boundary', () => {
  it('monitoring reads real connector state and REUSES operations health', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ops = createOperationsPlatform(rt);
    const ip = createIntegrationPlatform(rt, { clock, operations: ops });
    await ip.runtime().register({ name: 'x', category: 'crm', system: 'Salesforce' });
    expect(ip.monitoring().connectorHealth().total).toBe(1);
    expect(typeof ip.monitoring().apiHealth().status).toBe('string');
    const solo = createIntegrationPlatform(rt, { clock });
    expect(solo.monitoring().apiHealth().status).toBe(NO_INTEGRATION_DATA);
  });

  it('documentation generates 9 guides and REUSES production docs for overlapping kinds', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const prod = createProductionPlatform(rt, { clock });
    const ip = createIntegrationPlatform(rt, { clock, production: prod });
    expect(ip.documentation().guideKinds().length).toBe(9);
    expect((await ip.documentation().generate('security')).reusedProduction).toBe(true);
    expect((await ip.documentation().generate('integration')).reusedProduction).toBe(false);
  });

  it('reuses the base connectors platform registry and the Wave 5 connector count', () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const conn = createConnectorPlatform(rt, { clock });
    const exec = createExecutionPlatform(rt, { clock });
    const ip = createIntegrationPlatform(rt, { clock, connectors: conn, execution: exec });
    expect(ip.runtime().connectorRegistryReused().reused).toBe(true);
    expect(ip.reusedConnectorCount()).toBe(22);
  });

  it('every integration action is audited on the ONE chain with evidence + a replay id', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ip = createIntegrationPlatform(rt, { clock });
    const events: Array<Record<string, unknown>> = [];
    rt.events().subscribe((e) => e.type === 'integration.action', (e) => { events.push(e.payload as Record<string, unknown>); });
    await ip.runtime().register({ name: 'x', category: 'erp', system: 'Odoo' });
    expect(ip.governance().verify()).toBe(true);
    expect(rt.audit().verify().valid).toBe(true);
    const last = events[events.length - 1]!;
    expect(last['replayId']).toBeTruthy();
    expect(last['epic']).toBeTruthy();
  });

  it('never promotes evidence incorrectly — only in-process runtimes are live', () => {
    const nonLiveClassifiedLive = INTEGRATION_MATRIX.filter((m) => m.level === 'live-verified' && ADAPTER_OR_DATA.test(m.capability));
    expect(nonLiveClassifiedLive).toHaveLength(0);
    const r = integrationReadiness();
    expect(r.total).toBe(INTEGRATION_MATRIX.length);
    expect(r.liveVerified).toBe(10);
    expect(r.adapterVerified).toBe(EXPECTED_ADAPTERS); // 18
    expect(r.businessDataPending).toBe(7);
    expect(r.infrastructurePending).toBe(EXPECTED_INFRA_PENDING); // 5
  });
});
