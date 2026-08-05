import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createReleasePlatform } from '@neuropause/release';
import { createTrustPlatform } from './platform';

describe('E5 / E6 — vulnerability management + software supply chain', () => {
  it('registers vulnerabilities with real risk classification and never fabricates a scan', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const tp = createTrustPlatform(rt, { clock });

    const vuln = await tp.vulnerability().registerVulnerability({ title: 'Prototype pollution', severity: 'high', component: 'lodash', cve: 'CVE-2020-8203' });
    expect(vuln.riskScore).toBe(80); // deterministic severity → risk mapping
    expect(vuln.state).toBe('open');

    await tp.vulnerability().registerCve({ cve: 'CVE-2020-8203', cvss: 7.4, description: 'prototype pollution' });
    const patch = await tp.vulnerability().registerPatch({ vulnerabilityId: vuln.id, description: 'upgrade to 4.17.19' });
    const mitigated = await tp.vulnerability().mitigate(vuln.id, 'mitigated', patch.id);
    expect(mitigated.state).toBe('mitigated');
    expect(tp.vulnerability().openVulnerabilities()).toHaveLength(0);

    const scan = tp.vulnerability().scanStatus();
    expect(scan.scanned).toBe(false); // honest: no automated scan is performed here
  });

  it('builds provenance + verifies a release via the REUSED Release platform, and builds a real SBOM', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const release = createReleasePlatform(rt, { clock });
    const tp = createTrustPlatform(rt, { clock, release });

    const provenance = await tp.supplyChain().buildProvenance('1.0.0');
    expect(provenance.reusedRelease).toBe(true);
    expect(provenance.artifacts.length).toBeGreaterThan(0);
    expect(provenance.artifacts.every((a) => a.built === false)).toBe(true); // honest: not actually built

    const verification = await tp.supplyChain().verifyRelease('1.0.0');
    expect(verification.reusedRelease).toBe(true);

    await tp.supplyChain().addComponent({ name: '@neuropause/security', version: '1.0.0', checksum: 'abc' });
    const sbom = tp.supplyChain().generateSbom('1.0.0');
    expect(sbom.componentCount).toBe(1);

    const integrity = tp.supplyChain().verifyIntegrity({ name: 'blob', content: 'hello', expectedChecksum: 'x' });
    expect(integrity.valid).toBe(false); // real SHA-256 comparison
    const roundtrip = tp.supplyChain().verifyIntegrity({ name: 'blob', content: 'hello', expectedChecksum: integrity.computed });
    expect(roundtrip.valid).toBe(true);
  });
});
