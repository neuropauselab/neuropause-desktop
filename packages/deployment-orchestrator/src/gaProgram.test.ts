import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createReleasePlatform } from '@neuropause/release';
import { createDeploymentOrchestrator } from './platform';

describe('E5 — General Availability program (reused Release GA gate)', () => {
  it('evaluates the GA go/no-go gate via the reused Release platform, never releasing to the real world', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const release = createReleasePlatform(rt, { clock });
    const orch = createDeploymentOrchestrator(rt, { clock, release });

    await orch.ga().addChecklistItem('1.0.0', 'docs complete');
    await orch.ga().addChecklistItem('1.0.0', 'security review');
    await orch.ga().completeChecklistItem('1.0.0', 'docs complete');
    await orch.ga().completeChecklistItem('1.0.0', 'security review');

    const gate = await orch.ga().evaluateGaGate({ version: '1.0.0', executiveApprover: 'ceo', risk: 'low' });
    expect(gate.reusedRelease).toBe(true);
    expect(gate.releasedToRealWorld).toBe(false); // hard honesty flag from the reused gate
    expect(gate.checklistComplete).toBe(true);
    expect(typeof gate.decision).toBe('string');
  });

  it('promotes a version and produces a rollback plan via the reused Release management runtime', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const release = createReleasePlatform(rt, { clock });
    const orch = createDeploymentOrchestrator(rt, { clock, release });

    const promoted = await orch.ga().promote({ version: '1.0.0', channel: 'stable' });
    expect(promoted.reusedRelease).toBe(true);
    expect(promoted.channel).toBe('stable');

    const rollback = orch.ga().rollbackPlan('1.0.0');
    expect(rollback.reusedRelease).toBe(true);
    expect(rollback.steps.length).toBeGreaterThan(0);
  });

  it('represents the GA gate honestly when no Release platform is wired in', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const orch = createDeploymentOrchestrator(rt, { clock });
    const gate = await orch.ga().evaluateGaGate({ version: '1.0.0' });
    expect(gate.reusedRelease).toBe(false);
    expect(gate.decision).toBe('no-go');
    expect(gate.releasedToRealWorld).toBe(false);
  });
});
