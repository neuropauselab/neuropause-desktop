import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createOperatorDeployment } from './platform';
import { OD_MATRIX, odReadiness, EXPECTED_ADAPTERS, EXPECTED_INFRA_PENDING } from './evidence';

// External systems, deployment-run metrics, or real infrastructure — NEVER classified live.
const ADAPTER_OR_DATA =
  /Cloud Credentials|Kubernetes API|Container Registry|DNS Provider|TLS Issuer|Deployment Runs|Rollout Metrics|Live Validation Results|Reachable Cluster|Reachable Databases|Reachable Registry|Reachable DNS|Production Rollout/;

describe('governance + honesty invariant', () => {
  it('audits every operator activity with a replay id', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const od = createOperatorDeployment(rt, { clock });
    const events: Array<Record<string, unknown>> = [];
    rt.events().subscribe((e) => e.type === 'operator-deployment.action', (e) => { events.push(e.payload as Record<string, unknown>); });

    await od.validator().validate({});
    expect(od.governance().verify()).toBe(true);
    expect(rt.audit().verify().valid).toBe(true);
    const last = events[events.length - 1]!;
    expect(last['replayId']).toBeTruthy();
    expect(last['result']).toBe('PENDING - OPERATOR ACTION REQUIRED');
  });

  it('NEVER classifies an external system, deployment run, or real infrastructure as live', () => {
    const nonLiveClassifiedLive = OD_MATRIX.filter((m) => m.level === 'live-verified' && ADAPTER_OR_DATA.test(m.capability));
    expect(nonLiveClassifiedLive).toHaveLength(0);

    const level = (cap: string): string | undefined => OD_MATRIX.find((m) => m.capability === cap)?.level;
    expect(level('Cloud Credentials')).toBe('adapter-verified');
    expect(level('Deployment Runs')).toBe('business-data-pending');
    expect(level('Production Rollout')).toBe('infrastructure-pending');
    expect(level('Deployment Executor')).toBe('live-verified');
    expect(level('Environment Validator')).toBe('live-verified');

    const r = odReadiness();
    expect(r.total).toBe(22);
    expect(r.liveVerified).toBe(9);
    expect(r.adapterVerified).toBe(EXPECTED_ADAPTERS); // 5
    expect(r.businessDataPending).toBe(3);
    expect(r.infrastructurePending).toBe(EXPECTED_INFRA_PENDING); // 5
  });
});
