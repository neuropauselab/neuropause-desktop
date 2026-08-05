import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createDeploymentFoundation } from '@neuropause/deploy';
import { createInfrastructurePlatform } from './platform';
import { NO_INFRA_DATA } from './constants';

describe('E12–E14 — monitoring activation, telemetry, alerting', () => {
  it('monitoring components are configured, not marked running, and REUSE deploy config', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const dep = createDeploymentFoundation(rt, { clock });
    const infra = createInfrastructurePlatform(rt, { clock, deploy: dep });
    const prom = await infra.monitoring().activate('prometheus');
    expect(prom.status).toBe('configured');
    expect(infra.monitoring().runningCount()).toBe(0); // never marked running here
    expect(infra.monitoring().configuredComponents().length).toBeGreaterThanOrEqual(5);
  });

  it('telemetry never fabricates — only real values with a real source are recorded', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const infra = createInfrastructurePlatform(rt, { clock });
    expect(infra.telemetry().hasLiveData()).toBe(false);
    expect(infra.telemetry().metric('cpu')).toBe(NO_INFRA_DATA);
    await expect(infra.telemetry().record({ kind: 'cpu', value: 42, source: '' })).rejects.toThrow(/real source/);
    await infra.telemetry().record({ kind: 'cpu', value: 42, source: 'node-exporter' });
    expect(infra.telemetry().metric('cpu')).toBe(42);
    expect(infra.telemetry().metric('memory')).toBe(NO_INFRA_DATA);
  });

  it('alerting registers rules and raises real alerts', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const infra = createInfrastructurePlatform(rt, { clock });
    const rule = await infra.alerting().defineRule({ name: 'api-5xx', severity: 'critical', condition: 'rate(5xx) > 0.05' });
    await infra.alerting().raise({ ruleId: rule.id, severity: 'critical', message: 'API 5xx spike' });
    expect(infra.alerting().alertList('critical')).toHaveLength(1);
  });
});
