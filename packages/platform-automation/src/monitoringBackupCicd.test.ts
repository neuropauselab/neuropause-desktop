import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createPlatformOperations } from '@neuropause/platform-operations';
import { createTrustPlatform } from '@neuropause/trust-platform';
import { createPlatformAutomation } from './platform';

describe('E7 / E8 / E9 — monitoring, backup (reuse), and CI/CD (reuse)', () => {
  it('generates monitoring descriptors targeting the real /metrics endpoint + dashboards', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const pa = createPlatformAutomation(rt, { clock });

    const artifact = await pa.monitoring().generateAll();
    expect(artifact.content).toContain('/metrics');
    expect(artifact.content).toContain('PrometheusRule');
    // a dashboard for every target
    for (const target of pa.monitoring().dashboardTargets()) {
      expect(pa.monitoring().dashboard(target).title).toContain(target);
    }
  });

  it('validates recovery via the REUSED platform-operations backup-recovery engine', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const platformOperations = createPlatformOperations(rt, { clock });
    const pa = createPlatformAutomation(rt, { clock, platformOperations });

    const artifact = await pa.backup().generateWorkflow();
    expect(artifact.content).toContain('scripts/backup-db.sh');
    const validation = await pa.backup().validateRecovery('tenant-acme');
    expect(validation.reusedBackupRecovery).toBe(true);
  });

  it('generates a GitHub Actions workflow whose deploy job is approval-gated and never auto-applies', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const trustPlatform = createTrustPlatform(rt, { clock });
    const pa = createPlatformAutomation(rt, { clock, trustPlatform });

    const artifact = await pa.cicd().generateWorkflow();
    expect(artifact.content).toContain('deployment-validation');
    expect(artifact.content).toContain('environment: production'); // required-reviewers gate
    expect(artifact.content).not.toContain('kubectl apply'); // never auto-deploys
    // SBOM generation reuses the trust-platform supply chain
    const sbom = await pa.cicd().generateSbom('1.1.0');
    expect(sbom.reusedTrustPlatform).toBe(true);
  });
});
