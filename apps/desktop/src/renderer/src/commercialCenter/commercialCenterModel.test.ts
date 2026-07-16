/**
 * P20 — Commercial Center presentation-mapping tests (pure, Node).
 */
import { describe, expect, it } from 'vitest';
import { bandLabel, bandTone, modeIcon, moduleIcon, priceModelLabel, segmentLabel, segmentTone } from './commercialCenterModel';

describe('commercialCenterModel', () => {
  it('maps band to tone + label', () => {
    expect(bandTone('healthy')).toBe('green');
    expect(bandTone('watch')).toBe('blue');
    expect(bandTone('at-risk')).toBe('orange');
    expect(bandTone('critical')).toBe('red');
    expect(bandLabel('at-risk')).toBe('At risk');
  });

  it('maps segment / price-model / module / deployment-mode presentation', () => {
    expect(segmentTone('self_serve')).toBe('green');
    expect(segmentTone('special')).toBe('purple');
    expect(segmentLabel('sales_assisted')).toBe('Sales-assisted');
    expect(priceModelLabel('annual_contract')).toBe('Annual contract');
    expect(moduleIcon('billing-center')).toBe('store');
    expect(moduleIcon('unknown')).toBe('grid'); // safe fallback
    expect(modeIcon('air_gapped')).toBe('lock');
    expect(modeIcon('cloud_saas')).toBe('globe');
  });
});
