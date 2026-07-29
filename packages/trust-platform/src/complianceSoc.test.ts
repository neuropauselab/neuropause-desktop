import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createSecurityPlatform } from '@neuropause/security';
import { createOperationsPlatform } from '@neuropause/operations';
import { createTrustPlatform } from './platform';

describe('E10 / E11 / E12 — compliance readiness + SOC + Trust Center', () => {
  it('reports framework READINESS (never certification) reusing the security ComplianceService', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const security = createSecurityPlatform(rt, { clock });
    const tp = createTrustPlatform(rt, { clock, security });

    const soc2 = tp.compliance().readiness('SOC2');
    expect(soc2.reusedCompliance).toBe(true);
    expect(soc2.certified).toBe(false); // NEVER certified
    expect(soc2.implemented).toBeGreaterThan(0);

    const nist = tp.compliance().readiness('NIST-CSF');
    expect(nist.reusedCompliance).toBe(false); // NIST represented from the local control mapping
    expect(nist.total).toBe(6);
    expect(nist.certified).toBe(false);

    const report = await tp.compliance().assessmentReport('HIPAA');
    expect(report.certified).toBe(false);
    expect(tp.compliance().gapAnalysis('GDPR').length).toBeGreaterThan(0); // real gaps surfaced
  });

  it('runs a SOC incident queue on the REUSED Operations incident registry', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const operations = createOperationsPlatform(rt, { clock });
    const tp = createTrustPlatform(rt, { clock, operations });

    const inc = await tp.soc().openIncident({ title: 'brute-force attempt', severity: 'sev2' });
    expect(inc.reusedOperations).toBe(true);
    await tp.soc().acknowledgeIncident(inc.id, 'analyst-1');
    expect(tp.soc().incidentQueue()).toHaveLength(1);
    await tp.soc().resolveIncident(inc.id);
    expect(tp.soc().incidentQueue()).toHaveLength(0);

    await tp.soc().addPlaybook({ name: 'phishing-response', steps: ['isolate', 'reset', 'notify'] });
    const dash = tp.soc().dashboard();
    expect(dash.reusedOperations).toBe(true);
    expect(dash.productionThreatIntel).toBe('No production security data available'); // honest
  });

  it('Trust Center reports every framework certified:false and no production availability', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const security = createSecurityPlatform(rt, { clock });
    const tp = createTrustPlatform(rt, { clock, security });

    const status = tp.trustCenter().complianceStatus();
    expect(status.length).toBe(5);
    expect(status.every((s) => s.certified === false)).toBe(true);
    expect(tp.trustCenter().availabilityStatus().live).toBe(false);
    expect(tp.trustCenter().incidentHistory().productionIncidents).toBe(0);
  });
});
