/**
 * Experience Program v1.0 — Decision Center presentation-mapping tests (pure, Node).
 */
import { describe, expect, it } from 'vitest';
import { bandLabel, bandTone, disclosureIcon, kindIcon, moduleIcon, roleIcon } from './decisionCenterModel';

describe('decisionCenterModel', () => {
  it('maps band to tone + label', () => {
    expect(bandTone('healthy')).toBe('green');
    expect(bandTone('watch')).toBe('blue');
    expect(bandTone('at-risk')).toBe('orange');
    expect(bandTone('critical')).toBe('red');
    expect(bandLabel('at-risk')).toBe('At risk');
  });

  it('maps role / kind / disclosure / module icons with safe fallbacks', () => {
    expect(roleIcon('founder')).toBe('sparkles');
    expect(roleIcon('cfo')).toBe('store');
    expect(kindIcon('approval')).toBe('lock');
    expect(disclosureIcon('executive')).toBe('sparkles');
    expect(moduleIcon('operations')).toBe('pulse');
    expect(moduleIcon('unknown')).toBe('grid'); // safe fallback
  });
});
