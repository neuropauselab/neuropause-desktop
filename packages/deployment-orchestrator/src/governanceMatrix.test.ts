import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createDeploymentOrchestrator } from './platform';
import { DO_MATRIX, doReadiness, EXPECTED_ADAPTERS, EXPECTED_INFRA_PENDING } from './evidence';

// Customers, governments, contracts, revenue, deployments, or production usage — NEVER classified live.
const ADAPTER_OR_DATA =
  /\bCRM\b|\bERP\b|Identity Providers|Email Providers|Payment Providers|Marketplace APIs|Marketplace Publication|Pilot Customers|Enterprise Customers|Government Customers|Contracts|Revenue|Renewals|Production Adoption|Customer Production Environments|Government Production Networks|National Cloud Infrastructure|Production Rollouts/;

describe('E11 / E12 / E14 / E16 — training, documentation, governance, honesty invariant', () => {
  it('generates the launch guide set and training registries', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const orch = createDeploymentOrchestrator(rt, { clock });
    const guides = await orch.documentation().generateAll();
    expect(guides).toHaveLength(8);
    const course = await orch.training().registerCourse({ title: 'Admin 101', track: 'administrator' });
    expect(course.published).toBe(false); // assets represented until created
  });

  it('audits every deployment on the ONE chain with a replay id and EPIC-14 fields', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const orch = createDeploymentOrchestrator(rt, { clock });
    const events: Array<Record<string, unknown>> = [];
    rt.events().subscribe((e) => e.type === 'deployment.action', (e) => { events.push(e.payload as Record<string, unknown>); });

    await orch.deployments().register({ organization: 'Acme', environment: 'staging', version: '1.0.0' });
    expect(orch.governance().verify()).toBe(true);
    expect(rt.audit().verify().valid).toBe(true);
    const last = events[events.length - 1]!;
    expect(last['replayId']).toBeTruthy();
    expect(last['organization']).toBe('Acme');
    expect(last['environment']).toBe('staging');
    expect(last['deploymentVersion']).toBe('1.0.0');
  });

  it('NEVER classifies a customer, government, contract, revenue, or production deployment as live', () => {
    const nonLiveClassifiedLive = DO_MATRIX.filter((m) => m.level === 'live-verified' && ADAPTER_OR_DATA.test(m.capability));
    expect(nonLiveClassifiedLive).toHaveLength(0);

    const level = (cap: string): string | undefined => DO_MATRIX.find((m) => m.capability === cap)?.level;
    expect(level('Contracts')).toBe('business-data-pending');
    expect(level('Revenue')).toBe('business-data-pending');
    expect(level('Enterprise Customers')).toBe('business-data-pending');
    expect(level('Government Customers')).toBe('business-data-pending');
    expect(level('Marketplace Publication')).toBe('infrastructure-pending');
    expect(level('Production Rollouts')).toBe('infrastructure-pending');

    const r = doReadiness();
    expect(r.total).toBe(36);
    expect(r.liveVerified).toBe(18);
    expect(r.adapterVerified).toBe(EXPECTED_ADAPTERS); // 6
    expect(r.businessDataPending).toBe(7);
    expect(r.infrastructurePending).toBe(EXPECTED_INFRA_PENDING); // 5
  });

  it('reports infrastructure-pending capabilities and a live SDK', () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const orch = createDeploymentOrchestrator(rt, { clock });
    expect(orch.infrastructurePendingCaps()).toContain('marketplace-publication');
    expect(orch.sdk().liveCapabilityCount()).toBeGreaterThan(0);
  });
});
