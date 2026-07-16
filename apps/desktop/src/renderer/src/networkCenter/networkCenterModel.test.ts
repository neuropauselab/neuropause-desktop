/**
 * P18 — Intelligence Network Center presentation-mapping tests (pure, Node).
 */
import { describe, expect, it } from 'vitest';
import { bandLabel, bandTone, moduleIcon, positionIcon, positionLabel, positionTone, sourceIcon } from './networkCenterModel';

describe('networkCenterModel', () => {
  it('maps network band to tone + label', () => {
    expect(bandTone('healthy')).toBe('green');
    expect(bandTone('watch')).toBe('blue');
    expect(bandTone('at-risk')).toBe('orange');
    expect(bandTone('critical')).toBe('red');
    expect(bandLabel('at-risk')).toBe('At risk');
  });

  it('maps module / position / source icons + labels', () => {
    expect(moduleIcon('trust-exchange')).toBe('shield');
    expect(moduleIcon('unknown')).toBe('grid'); // safe fallback
    expect(positionTone('above')).toBe('green');
    expect(positionTone('below')).toBe('orange');
    expect(positionIcon('above')).toBe('arrow-up');
    expect(positionLabel('below')).toBe('Below industry');
    expect(positionLabel('unbenchmarked')).toBe('Unbenchmarked');
    expect(sourceIcon('marketplace')).toBe('store');
  });
});
