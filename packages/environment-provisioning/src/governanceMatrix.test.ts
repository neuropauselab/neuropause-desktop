import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createEnvironmentProvisioning } from './platform';
import { EP_MATRIX, epReadiness, EXPECTED_ADAPTERS, EXPECTED_INFRA_PENDING } from './evidence';

// External systems, provisioning-run metrics, or real infrastructure — NEVER classified live.
const ADAPTER_OR_DATA =
  /\bAWS\b|\bAzure\b|Google Cloud|\bTerraform\b|\bHelm\b|cert-manager|Provisioning Runs|Cluster Health|Acceptance Results|Monitoring Data|Cloud Accounts|Provisioned VPC|Provisioned Cluster|Provisioned Databases|DNS Zone|TLS Certificate|Production Deployment/;

describe('governance + honesty invariant', () => {
  it('audits every provisioning activity with a replay id and required fields', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ep = createEnvironmentProvisioning(rt, { clock });
    const events: Array<Record<string, unknown>> = [];
    rt.events().subscribe((e) => e.type === 'provisioning.action', (e) => { events.push(e.payload as Record<string, unknown>); });

    await ep.cloud().provision({}); // blocked at PENDING — still audited
    expect(ep.governance().verify()).toBe(true);
    expect(rt.audit().verify().valid).toBe(true);
    const last = events[events.length - 1]!;
    expect(last['replayId']).toBeTruthy();
    expect(last['result']).toBe('PENDING - OPERATOR INPUT REQUIRED');
    expect(last['environment']).toBe('production');
  });

  it('NEVER classifies an external system, provisioning run, or real infrastructure as live', () => {
    const nonLiveClassifiedLive = EP_MATRIX.filter((m) => m.level === 'live-verified' && ADAPTER_OR_DATA.test(m.capability));
    expect(nonLiveClassifiedLive).toHaveLength(0);

    const level = (cap: string): string | undefined => EP_MATRIX.find((m) => m.capability === cap)?.level;
    expect(level('AWS')).toBe('adapter-verified');
    expect(level('Provisioning Runs')).toBe('business-data-pending');
    expect(level('Provisioned Cluster')).toBe('infrastructure-pending');
    expect(level('Production Deployment')).toBe('infrastructure-pending');
    expect(level('Cloud Provisioning Runtime')).toBe('live-verified');
    expect(level('Prerequisite Gate')).toBe('live-verified');

    const r = epReadiness();
    expect(r.total).toBe(30);
    expect(r.liveVerified).toBe(13);
    expect(r.adapterVerified).toBe(EXPECTED_ADAPTERS); // 6
    expect(r.businessDataPending).toBe(4);
    expect(r.infrastructurePending).toBe(EXPECTED_INFRA_PENDING); // 7
  });
});
