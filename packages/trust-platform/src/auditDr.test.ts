import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createPlatformOperations } from '@neuropause/platform-operations';
import { createTrustPlatform } from './platform';

describe('E8 / E9 — audit & forensics + disaster recovery', () => {
  it('exposes the REUSED audit ledger as an immutable timeline + chain of custody', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const tp = createTrustPlatform(rt, { clock });

    await tp.zeroTrust().definePolicy({ name: 'p', resourceClass: 'internal', minTrust: 'low', permission: 'x:y' });
    await tp.zeroTrust().classify('r1', 'internal');

    const timeline = tp.auditForensics().timeline({ actionPrefix: 'trust.' });
    expect(timeline.length).toBeGreaterThanOrEqual(2);
    expect(tp.auditForensics().verifyIntegrity().valid).toBe(true); // reused ledger's tamper-evident check
    expect(tp.auditForensics().chainOfCustody().length).toBeGreaterThanOrEqual(2);

    const inv = await tp.auditForensics().openInvestigation({ title: 'anomalous access', subject: 'u9' });
    const evi = await tp.auditForensics().addEvidence(inv.id, { reference: 'audit:123', description: 'suspicious login', custodian: 'analyst-a' });
    await tp.auditForensics().transferCustody(inv.id, evi.id, 'analyst-b');
    expect(tp.auditForensics().investigation(inv.id)!.evidence[0]!.custody).toEqual(['analyst-a', 'analyst-b']);

    const correlation = tp.auditForensics().correlate('trust.');
    expect(correlation.total).toBeGreaterThanOrEqual(2);
  });

  it('takes backups + validates recovery via the REUSED backup-recovery engine', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const platformOperations = createPlatformOperations(rt, { clock });
    const tp = createTrustPlatform(rt, { clock, platformOperations });

    await tp.disasterRecovery().createRecoveryPlan({ name: 'primary', rtoMinutes: 60, rpoMinutes: 15, steps: ['restore-db', 'reroute-traffic'] });
    const backup = await tp.disasterRecovery().backup({ targetId: 'tenant-acme', kind: 'database' });
    expect(backup.reusedBackupRecovery).toBe(true);
    expect(tp.disasterRecovery().backupCatalog()).toHaveLength(1);

    const validation = await tp.disasterRecovery().validateRecovery('tenant-acme');
    expect(validation.reusedBackupRecovery).toBe(true);

    const failover = await tp.disasterRecovery().registerFailover({ region: 'us-west-2', mode: 'active-passive' });
    expect(failover.live).toBe(false); // no real region is active until infrastructure exists
  });
});
