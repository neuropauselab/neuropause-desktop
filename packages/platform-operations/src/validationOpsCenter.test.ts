import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createSecurityPlatform } from '@neuropause/security';
import { createOperationsPlatform } from '@neuropause/operations';
import { createAiRuntime } from '@neuropause/ai-runtime';
import { createReliabilityPlatform } from '@neuropause/reliability';
import { createPlatformOperations } from './platform';

describe('E15 / E11 / E10 — validation, operations center, monitoring', () => {
  it('validates production by REUSING the Sprint-4 end-to-end validation (measured only)', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const sec = createSecurityPlatform(rt, { clock });
    const opsPlat = createOperationsPlatform(rt, { clock });
    const ai = createAiRuntime(rt);
    const reliability = createReliabilityPlatform(rt, { clock, security: sec, operations: opsPlat, aiRuntime: ai });
    const ops = createPlatformOperations(rt, { clock, reliability, operations: opsPlat });

    const report = await ops.validation().validate();
    expect(report.reusedReliability).toBe(true);
    expect(report.passed).toBe(true);
    expect(report.readinessScore).not.toBeNull();
    expect(report.areas.find((a) => a.area === 'identity')!.status).toBe('passed');
  });

  it('operations center reports honest health and tracks a real operations incident', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const opsPlat = createOperationsPlatform(rt, { clock });
    const ops = createPlatformOperations(rt, { clock, operations: opsPlat });

    const health = ops.operationsCenter().healthSnapshot();
    expect(health.find((h) => h.domain === 'cluster')!.live).toBe(false); // no running nodes
    expect(health.find((h) => h.domain === 'cluster')!.status).toBe('infrastructure-pending');

    const inc = await ops.operationsCenter().openIncident({ title: 'api latency', severity: 'sev3' });
    expect(inc.operationsIncidentId).toBeTruthy();
    await ops.operationsCenter().resolveIncident(inc.id, 'scaled gateway');
    expect(ops.operationsCenter().incidentList()[0]!.state).toBe('resolved');

    const dash = await ops.monitoring().declareDashboard({ kind: 'infrastructure', name: 'infra-overview' });
    expect(dash.live).toBe(false); // descriptor, not a live panel
    expect(ops.monitoring().platformHealth().live).toBe(true); // reused operations overview
  });
});
