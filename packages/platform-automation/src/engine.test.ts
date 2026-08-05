import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createPlatformAutomation } from './platform';
import type { Artifact } from './types';

const stub = (name: string): Artifact => ({ kind: 'kubernetes', name, format: 'yaml', content: 'kind: X', note: 'stub' });

describe('E1 — infrastructure automation engine (preview + approval-gated execute)', () => {
  it('plans automations in dependency (topological) order', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const pa = createPlatformAutomation(rt, { clock });
    const eng = pa.engine();
    await eng.register({ id: 'cluster', name: 'cluster', environment: 'production', dependsOn: [], generate: () => [stub('a')] });
    await eng.register({ id: 'app', name: 'app', environment: 'production', dependsOn: ['cluster'], generate: () => [stub('b')] });

    const order = pa.engine().plan(['app']).map((s) => s.id);
    expect(order).toEqual(['cluster', 'app']); // dependency resolved + included transitively
  });

  it('PREVIEW generates artifacts and never mutates infrastructure', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const pa = createPlatformAutomation(rt, { clock });
    await pa.engine().register({ id: 'k8s', name: 'k8s', environment: 'production', dependsOn: [], generate: () => [stub('m1'), stub('m2')] });
    const preview = await pa.engine().preview('k8s');
    expect(preview.mutated).toBe(false); // strictly side-effect-free
    expect(preview.artifacts).toHaveLength(2);
  });

  it('EXECUTE refuses without approval, and only PREPARES (never applies) with approval', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const pa = createPlatformAutomation(rt, { clock });
    await pa.engine().register({ id: 'k8s', name: 'k8s', environment: 'production', dependsOn: [], generate: () => [stub('m1')], applyCommands: ['kubectl apply -f m1'] });

    const refused = await pa.engine().execute({ id: 'k8s', operator: 'op', approved: false });
    expect(refused.status).toBe('approval-required');
    expect(refused.appliedToInfrastructure).toBe(false);

    const prepared = await pa.engine().execute({ id: 'k8s', operator: 'op', approved: true });
    expect(prepared.status).toBe('prepared'); // prepared, NOT deployed
    expect(prepared.appliedToInfrastructure).toBe(false); // never applies
    expect(prepared.commands).toContain('kubectl apply -f m1');
  });

  it('plans rollback without executing, and detects dependency cycles', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const pa = createPlatformAutomation(rt, { clock });
    await pa.engine().register({ id: 'x', name: 'x', environment: 'production', dependsOn: [], generate: () => [stub('m')], rollbackSteps: ['helm rollback np'] });
    const rb = await pa.engine().planRollback('x');
    expect(rb.executed).toBe(false);
    expect(rb.steps).toContain('helm rollback np');

    await pa.engine().register({ id: 'c1', name: 'c1', environment: 'production', dependsOn: ['c2'], generate: () => [] });
    await pa.engine().register({ id: 'c2', name: 'c2', environment: 'production', dependsOn: ['c1'], generate: () => [] });
    expect(() => pa.engine().plan(['c1'])).toThrow(/cycle/);
  });
});
