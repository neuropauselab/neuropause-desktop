import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createTrustPlatform } from './platform';
import { TP_MATRIX, tpReadiness, EXPECTED_ADAPTERS, EXPECTED_INFRA_PENDING } from './evidence';

// External systems, real production security data, certifications, or audits — NEVER classified live.
const ADAPTER_OR_DATA =
  /Vault|Azure Key Vault|AWS Secrets Manager|Google Secret Manager|External SIEM|Enterprise SIEM|External Identity Providers|Production Security Events|Customer Incidents|Threat Intelligence|Security Metrics|Compliance Assessments?|External Secret Stores|Production HSM|Third-Party Audit Environment|Compliance Audit Engagement/;

describe('E13 / E14 / E16 — documentation, governance, honesty invariant', () => {
  it('generates the full security guide set', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const tp = createTrustPlatform(rt, { clock });
    const guides = await tp.documentation().generateAll();
    expect(guides).toHaveLength(8);
    expect(guides.find((g) => g.guide === 'Compliance Readiness Guide')!.sections.length).toBeGreaterThan(0);
  });

  it('audits every operation on the ONE chain with a replay id', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const tp = createTrustPlatform(rt, { clock });
    const events: Array<Record<string, unknown>> = [];
    rt.events().subscribe((e) => e.type === 'trust.action', (e) => { events.push(e.payload as Record<string, unknown>); });

    await tp.zeroTrust().classify('r1', 'restricted');
    expect(tp.governance().verify()).toBe(true);
    expect(rt.audit().verify().valid).toBe(true);
    expect(events[events.length - 1]!['replayId']).toBeTruthy();
    // EPIC 14 required fields are on the record
    expect(events[events.length - 1]!['environment']).toBeTruthy();
    expect(events[events.length - 1]!['policy']).toBeTruthy();
  });

  it('NEVER classifies a certification, production data, or external system as live', () => {
    const nonLiveClassifiedLive = TP_MATRIX.filter((m) => m.level === 'live-verified' && ADAPTER_OR_DATA.test(m.capability));
    expect(nonLiveClassifiedLive).toHaveLength(0);

    const level = (cap: string): string | undefined => TP_MATRIX.find((m) => m.capability === cap)?.level;
    expect(level('Compliance Assessments')).toBe('business-data-pending');
    expect(level('Production Security Events')).toBe('business-data-pending');
    expect(level('External Identity Providers')).toBe('adapter-verified');
    expect(level('Compliance Audit Engagement')).toBe('infrastructure-pending');
    expect(level('Production HSM')).toBe('infrastructure-pending');

    const r = tpReadiness();
    expect(r.total).toBe(38);
    expect(r.liveVerified).toBe(22);
    expect(r.adapterVerified).toBe(EXPECTED_ADAPTERS); // 6
    expect(r.businessDataPending).toBe(5);
    expect(r.infrastructurePending).toBe(EXPECTED_INFRA_PENDING); // 5
  });

  it('reuses multiple prior platforms and reports infrastructure-pending capabilities', () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const tp = createTrustPlatform(rt, { clock });
    expect(tp.infrastructurePendingCaps()).toContain('compliance-audit-engagement');
    expect(tp.sdk().liveCapabilityCount()).toBeGreaterThan(0);
  });
});
