/**
 * P16 — Knowledge Fabric Center presentation-mapping tests (pure, Node).
 */
import { describe, expect, it } from 'vitest';
import { bandLabel, bandTone, explanationIcon, lineageIcon, refIcon, sourceIcon } from './knowledgeCenterModel';

describe('knowledgeCenterModel', () => {
  it('maps fabric band to tone + label', () => {
    expect(bandTone('healthy')).toBe('green');
    expect(bandTone('watch')).toBe('blue');
    expect(bandTone('at-risk')).toBe('orange');
    expect(bandTone('critical')).toBe('red');
    expect(bandLabel('at-risk')).toBe('At risk');
    expect(bandLabel('healthy')).toBe('Healthy');
  });

  it('maps source / explanation / ref / lineage icons', () => {
    expect(sourceIcon('graph')).toBe('grid');
    expect(sourceIcon('corpus')).toBe('memory');
    expect(explanationIcon('decision')).toBe('checklist');
    expect(explanationIcon('simulation')).toBe('beaker');
    expect(refIcon('entity')).toBe('database');
    expect(refIcon('incident')).toBe('shield');
    expect(refIcon('unknown-kind')).toBe('dot'); // safe fallback
    expect(lineageIcon('origin')).toBe('plus');
    expect(lineageIcon('consumers')).toBe('arrow-right');
  });
});
