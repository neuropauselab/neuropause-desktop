/**
 * P19 — Autonomous Operations Center presentation-mapping tests (pure, Node).
 */
import { describe, expect, it } from 'vitest';
import { autoExecLabel, autoExecTone, bandLabel, bandTone, categoryIcon, dimensionIcon, moduleIcon, recoveryIcon, riskTone } from './autoOpsCenterModel';

describe('autoOpsCenterModel', () => {
  it('maps band to tone + label', () => {
    expect(bandTone('healthy')).toBe('green');
    expect(bandTone('watch')).toBe('blue');
    expect(bandTone('at-risk')).toBe('orange');
    expect(bandTone('critical')).toBe('red');
    expect(bandLabel('at-risk')).toBe('At risk');
  });

  it('maps risk / module / category / recovery / dimension icons + the auto-exec badge', () => {
    expect(riskTone('critical')).toBe('red');
    expect(riskTone('low')).toBe('green');
    expect(moduleIcon('recovery-manager')).toBe('refresh');
    expect(moduleIcon('unknown')).toBe('grid'); // safe fallback
    expect(categoryIcon('optimization')).toBe('lightbulb');
    expect(recoveryIcon('escalation')).toBe('shield');
    expect(dimensionIcon('security')).toBe('shield');
    // the cardinal posture badge — policy-permitted vs approval-required.
    expect(autoExecTone(true)).toBe('green');
    expect(autoExecTone(false)).toBe('orange');
    expect(autoExecLabel(false)).toBe('Approval required');
  });
});
