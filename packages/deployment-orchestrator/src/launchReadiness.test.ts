import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createPlatformOperations } from '@neuropause/platform-operations';
import { createCustomerExperience } from '@neuropause/customer-experience';
import { createEnterpriseConnectivity } from '@neuropause/enterprise-connectivity';
import { createTrustPlatform } from '@neuropause/trust-platform';
import { createDeploymentOrchestrator } from './platform';

describe('E10 / E13 — launch operations center + business launch readiness', () => {
  it('composes the reused readiness of prior platforms into a launch-readiness score', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const platformOperations = createPlatformOperations(rt, { clock });
    const customerExperience = createCustomerExperience(rt, { clock });
    const enterpriseConnectivity = createEnterpriseConnectivity(rt, { clock });
    const trustPlatform = createTrustPlatform(rt, { clock });
    const orch = createDeploymentOrchestrator(rt, { clock, platformOperations, customerExperience, enterpriseConnectivity, trustPlatform });

    const composed = orch.launchReadiness().composedReadiness();
    expect(composed.platforms).toBeGreaterThanOrEqual(4);
    expect(composed.totalCapabilities).toBeGreaterThan(0);
    expect(composed.liveCapabilities).toBeGreaterThan(0); // real sum over reused matrices

    const score = orch.launchReadiness().score();
    expect(score.totalDomains).toBe(9);
    expect(score.readyDomains).toBe(9); // every domain backed by a wired-in platform
    expect(score.scorePct).toBe(100);
    expect(score.verdict).toBe('launch-ready');
  });

  it('is only conditionally ready when platforms are not wired in', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const orch = createDeploymentOrchestrator(rt, { clock });
    const score = orch.launchReadiness().score();
    expect(score.scorePct).toBeLessThan(100); // platform/trust/etc not wired → not fully ready
    expect(['conditionally-ready', 'not-ready']).toContain(score.verdict);
  });

  it('shows a Launch Operations Center with customer + commercial tiles honestly pending', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const platformOperations = createPlatformOperations(rt, { clock });
    const orch = createDeploymentOrchestrator(rt, { clock, platformOperations });

    await orch.deployments().register({ organization: 'Acme', environment: 'x', version: '1.0.0' });
    const tiles = orch.launchOps().snapshot();
    expect(tiles.find((t) => t.dashboard === 'deployment-pipeline')!.live).toBe(true);
    expect(tiles.find((t) => t.dashboard === 'customer-readiness')!.live).toBe(false); // real adoption pending
    expect(tiles.find((t) => t.dashboard === 'commercial-readiness')!.live).toBe(false); // real contracts/revenue pending
    expect(tiles.find((t) => t.dashboard === 'executive-status')!.live).toBe(true);
  });
});
