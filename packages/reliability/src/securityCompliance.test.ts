import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createSecurityPlatform } from '@neuropause/security';
import { createProductionPlatform } from '@neuropause/production';
import { createOperationsPlatform } from '@neuropause/operations';
import { createReliabilityPlatform } from './platform';

describe('E7 / E8 / E9 — security hardening, penetration testing, compliance readiness', () => {
  it('runs a REAL secret scan: clean source has 0 findings, a planted key is detected', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const rel = createReliabilityPlatform(rt, { clock });

    const clean = await rel.hardening().scan('secret');
    expect(clean.executed).toBe(true);
    expect(clean.filesScanned).toBeGreaterThan(0);
    expect(clean.findings).toHaveLength(0);

    // Prove the scanner really works: plant an AWS-style key in a temp dir and re-scan.
    const dir = mkdtempSync(join(tmpdir(), 'relsec-'));
    writeFileSync(join(dir, 'leak.ts'), `export const k = "AKIA${'ABCDEFGHIJKLMNOP'}";\n`);
    const rel2 = createReliabilityPlatform(rt, { clock, scanRoots: [dir] });
    const planted = await rel2.hardening().scan('secret');
    expect(planted.findings.length).toBeGreaterThanOrEqual(1);
    expect(planted.findings[0]!.rule).toBe('aws-access-key-id');
  });

  it('configuration scan passes on the strict base tsconfig; external scanners are represented', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const rel = createReliabilityPlatform(rt, { clock });
    const cfg = await rel.hardening().scan('configuration');
    expect(cfg.executed).toBe(true);
    expect(cfg.findings).toHaveLength(0);

    const dep = await rel.hardening().scan('dependency');
    expect(dep.executed).toBe(false);
    expect(dep.evidence).toBe('adapter-verified');
  });

  it('penetration testing represents categories and NEVER certifies', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const rel = createReliabilityPlatform(rt, { clock });
    const plan = await rel.pentest().plan({ scope: 'nems-api' });
    expect(plan.certified).toBe(false);
    expect(plan.authorizedExternalOnly).toBe(true);
    expect(plan.cases.length).toBe(10);
  });

  it('compliance generates an evidence package but NEVER claims compliance/certification', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const sec = createSecurityPlatform(rt, { clock });
    const prod = createProductionPlatform(rt, { clock });
    const ops = createOperationsPlatform(rt, { clock });
    const rel = createReliabilityPlatform(rt, { clock, security: sec, production: prod, operations: ops });

    const pkg = await rel.compliance().assess('SOC 2');
    expect(pkg.certified).toBe(false);
    expect(pkg.reusedProductionAudit).toBe(true);
    expect(pkg.coverage).toBe(1); // all five control mechanisms present via reuse
    expect(pkg.outcome).toBe('readiness-assessed');
    expect(rel.compliance().frameworks()).toContain('HIPAA');
  });
});
