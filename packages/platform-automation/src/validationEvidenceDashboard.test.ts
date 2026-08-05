import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createTrustPlatform } from '@neuropause/trust-platform';
import { createPlatformAutomation } from './platform';

describe('E10 / E11 / E12 — validation, evidence, and operations dashboard', () => {
  it('produces a machine-readable validation report with every target pending', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const pa = createPlatformAutomation(rt, { clock });

    const artifact = await pa.validation().generateReport();
    const report = JSON.parse(artifact.content) as { appliedToInfrastructure: boolean; checks: Array<{ status: string }> };
    expect(report.appliedToInfrastructure).toBe(false);
    expect(report.checks.length).toBe(8);
    expect(report.checks.every((c) => c.status === 'pending')).toBe(true); // no fabricated pass
  });

  it('opens evidence packages that are never auto-promoted', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const trustPlatform = createTrustPlatform(rt, { clock });
    const pa = createPlatformAutomation(rt, { clock, trustPlatform });

    const pkg = await pa.evidenceCollector().openPackage('k8s-deploy');
    expect(pkg.promoted).toBe(false);
    expect(pkg.items.every((i) => i.status === 'pending')).toBe(true);
    const attached = await pa.evidenceCollector().attach(pkg.id, 'image-digest', 'sha256:abc');
    expect(attached.promoted).toBe(false); // attaching evidence never promotes
    expect(pa.evidenceCollector().sbomEvidence('1.1.0').reusedTrustPlatform).toBe(true);
  });

  it('dashboard reports real run status with zero verified and no simulated metrics', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const pa = createPlatformAutomation(rt, { clock });
    await pa.engine().register({ id: 'k8s', name: 'k8s', environment: 'production', dependsOn: [], generate: () => [] });
    await pa.engine().preview('k8s');
    await pa.engine().execute({ id: 'k8s', operator: 'op', approved: true });

    const snap = pa.opsDashboard().snapshot();
    expect(snap.previewed).toBe(1);
    expect(snap.prepared).toBe(1);
    expect(snap.verified).toBe(0); // real verification is out-of-band
    expect(snap.productionMetrics).toBe('No production automation data available');
  });
});
