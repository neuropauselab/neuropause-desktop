import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createSecurityPlatform } from '@neuropause/security';
import { createOperationsPlatform } from '@neuropause/operations';
import { createAiRuntime } from '@neuropause/ai-runtime';
import { createReliabilityPlatform } from '@neuropause/reliability';
import { createReleasePlatform, type ReleasePlatform } from './platform';
import { GA_VERSION_TARGET } from './constants';

function wiredRelease(clock: ManualClock): ReleasePlatform {
  const rt = createEnterpriseRuntime({ clock });
  const sec = createSecurityPlatform(rt, { clock });
  const ops = createOperationsPlatform(rt, { clock });
  const ai = createAiRuntime(rt);
  const reliability = createReliabilityPlatform(rt, { clock, security: sec, operations: ops, aiRuntime: ai });
  return createReleasePlatform(rt, { clock, reliability });
}

describe('E3 / E4 — RC validation + GA gate', () => {
  it('validates the RC by REUSING the Sprint-4 end-to-end validation', async () => {
    const clock = new ManualClock(1000);
    const release = wiredRelease(clock);
    const report = await release.rcValidation().validate({ version: GA_VERSION_TARGET });
    expect(report.reusedReliability).toBe(true);
    expect(report.passed).toBe(true);
    expect(report.readinessScore).not.toBeNull();
    expect(report.areas.find((a) => a.area === 'identity')!.status).toBe('passed');
  });

  it('GA gate goes GO only with RC pass + complete checklist + a REAL executive approver', async () => {
    const clock = new ManualClock(1000);
    const release = wiredRelease(clock);
    const rcReport = await release.rcValidation().validate({ version: GA_VERSION_TARGET });
    const checklist = [{ item: 'security sign-off', done: true }, { item: 'docs complete', done: true }];

    const go = await release.gaGate().evaluate({ version: GA_VERSION_TARGET, rcReport, checklist, executiveApprover: 'CEO Jane Doe' });
    expect(go.decision).toBe('go');
    expect(go.executiveApproval.approved).toBe(true);
    expect(go.releasedToRealWorld).toBe(false); // GA governed, not asserted in the real world
    expect(go.reusedReliability).toBe(true);

    const noApprover = await release.gaGate().evaluate({ version: GA_VERSION_TARGET, rcReport, checklist, executiveApprover: '  ' });
    expect(noApprover.decision).toBe('no-go'); // approval never fabricated

    const incompleteChecklist = await release.gaGate().evaluate({ version: GA_VERSION_TARGET, rcReport, checklist: [{ item: 'x', done: false }], executiveApprover: 'CEO' });
    expect(incompleteChecklist.decision).toBe('no-go');
  });
});
