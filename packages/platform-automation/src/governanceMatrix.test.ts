import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createPlatformAutomation } from './platform';
import { PA_MATRIX, paReadiness, EXPECTED_ADAPTERS, EXPECTED_INFRA_PENDING } from './evidence';

// External tools, production-run metrics, or real infrastructure — NEVER classified live.
const ADAPTER_OR_DATA =
  /Terraform Providers|\bVault\b|Cloud Secret Managers|GitHub Actions|cert-manager|Production Automation Runs|Deployment Metrics|Operational KPIs|Cloud Accounts|Kubernetes Clusters|DNS Zones|TLS Certificates|Production Networks/;

describe('E13 / E15 — governance + honesty invariant', () => {
  it('audits every automation on the ONE chain with a replay id and EPIC-13 fields', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const pa = createPlatformAutomation(rt, { clock });
    const events: Array<Record<string, unknown>> = [];
    rt.events().subscribe((e) => e.type === 'automation.action', (e) => { events.push(e.payload as Record<string, unknown>); });

    await pa.terraform().generateModule({ provider: 'aws', environment: 'production' });
    expect(pa.governance().verify()).toBe(true);
    expect(rt.audit().verify().valid).toBe(true);
    const last = events[events.length - 1]!;
    expect(last['replayId']).toBeTruthy();
    expect(last['operator']).toBeTruthy();
    expect(last['environment']).toBe('production');
    expect(last['target']).toBeTruthy();
    expect(last['result']).toBeTruthy();
  });

  it('NEVER classifies an external tool, production run, or real infrastructure as live', () => {
    const nonLiveClassifiedLive = PA_MATRIX.filter((m) => m.level === 'live-verified' && ADAPTER_OR_DATA.test(m.capability));
    expect(nonLiveClassifiedLive).toHaveLength(0);

    const level = (cap: string): string | undefined => PA_MATRIX.find((m) => m.capability === cap)?.level;
    expect(level('Terraform Providers')).toBe('adapter-verified');
    expect(level('Production Automation Runs')).toBe('business-data-pending');
    expect(level('Kubernetes Clusters')).toBe('infrastructure-pending');
    expect(level('TLS Certificates')).toBe('infrastructure-pending');
    // the generators themselves ARE live
    expect(level('Terraform Generator')).toBe('live-verified');
    expect(level('Automation Engine')).toBe('live-verified');

    const r = paReadiness();
    expect(r.total).toBe(31);
    expect(r.liveVerified).toBe(18);
    expect(r.adapterVerified).toBe(EXPECTED_ADAPTERS); // 5
    expect(r.businessDataPending).toBe(3);
    expect(r.infrastructurePending).toBe(EXPECTED_INFRA_PENDING); // 5
  });

  it('reuses prior platforms and exposes a live SDK', () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const pa = createPlatformAutomation(rt, { clock });
    expect(pa.infrastructurePendingCaps()).toContain('kubernetes-clusters');
    expect(pa.sdk().liveCapabilityCount()).toBeGreaterThan(0);
  });
});
