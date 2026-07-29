import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createPlatformAutomation } from './platform';

describe('E2 / E3 — Terraform + Kubernetes generation', () => {
  it('generates valid Terraform plans for every provider, plan-only (never applies)', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const pa = createPlatformAutomation(rt, { clock });

    for (const provider of pa.terraform().providers()) {
      const { artifact, commands } = await pa.terraform().plan({ provider, environment: 'production' });
      expect(artifact.format).toBe('hcl');
      expect(artifact.content).toContain('terraform {'); // required block present
      expect(artifact.content).toMatch(/provider\s+"/); // a provider block
      expect(commands.some((c) => c.startsWith('terraform plan'))).toBe(true);
      expect(commands.join(' ')).not.toContain('terraform apply'); // never auto-applies
    }
  });

  it('generates valid Kubernetes manifests reusing the Helm conventions (HPA 2-6)', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const pa = createPlatformAutomation(rt, { clock });

    const artifact = await pa.kubernetes().generateAll({ environment: 'production', host: 'api.example.com' });
    expect(artifact.format).toBe('yaml');
    expect(artifact.content).toContain('kind: Namespace');
    expect(artifact.content).toContain('kind: HorizontalPodAutoscaler');
    expect(artifact.content).toContain('kind: Ingress');
    // HPA bounds match the neuropause-backend chart
    const hpa = pa.kubernetes().hpa();
    expect((hpa.spec as { minReplicas: number }).minReplicas).toBe(2);
    expect((hpa.spec as { maxReplicas: number }).maxReplicas).toBe(6);
    // secret reference embeds NO value
    expect(artifact.content).toContain('ExternalSecret');
    expect(artifact.content).not.toMatch(/JWT_ACCESS_SECRET:\s*['"]?[A-Za-z0-9+/]{8,}/);
  });
});
