/**
 * P14 — Strategy Center presentation-mapping tests (pure, Node).
 */
import { describe, expect, it } from 'vitest';
import {
  approvalTone,
  areaLabel,
  bandTone,
  categoryIcon,
  categoryLabel,
  dimensionLabel,
  horizonLabel,
  pct,
  priorityLabel,
  priorityTone,
  statusLabel,
  statusTone,
} from './strategyCenterModel';

describe('strategyCenterModel', () => {
  it('maps goal status to tone + label', () => {
    expect(statusTone('on_track')).toBe('green');
    expect(statusTone('at_risk')).toBe('orange');
    expect(statusTone('off_track')).toBe('red');
    expect(statusLabel('on_track')).toBe('On track');
    expect(statusLabel('off_track')).toBe('Off track');
  });

  it('maps band + priority to tone', () => {
    expect(bandTone('healthy')).toBe('green');
    expect(bandTone('watch')).toBe('blue');
    expect(bandTone('at-risk')).toBe('orange');
    expect(bandTone('critical')).toBe('red');
    expect(priorityTone('critical')).toBe('red');
    expect(priorityTone('low')).toBe('gray');
    expect(priorityLabel('high')).toBe('High');
  });

  it('tones approval requirements by governance', () => {
    expect(approvalTone(true)).toBe('blue');
    expect(approvalTone(false)).toBe('orange'); // ungoverned → needs a chain configured
  });

  it('labels categories, dimensions, areas, horizons and pct', () => {
    expect(categoryLabel('financial')).toBe('Financial');
    expect(categoryIcon('security')).toBe('shield');
    expect(dimensionLabel('dependencies')).toBe('Dependencies');
    expect(areaLabel('cloud')).toBe('Cloud');
    expect(horizonLabel('multi_year')).toBe('Multi-year');
    expect(pct(0.723)).toBe('72%');
  });
});
