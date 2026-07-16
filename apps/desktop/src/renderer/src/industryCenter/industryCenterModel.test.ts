/**
 * P13 — Industry Center presentation-mapping tests (pure, Node).
 */
import { describe, expect, it } from 'vitest';
import {
  activationTone,
  coverageTone,
  entityKindIcon,
  kpiBandTone,
  pct,
  refLabel,
  refTone,
  statusLabel,
  statusTone,
} from './industryCenterModel';

describe('industryCenterModel', () => {
  it('maps suite status to tone + label', () => {
    expect(statusTone('ready')).toBe('green');
    expect(statusTone('partial')).toBe('orange');
    expect(statusTone('planned')).toBe('gray');
    expect(statusLabel('ready')).toBe('Ready');
    expect(statusLabel('planned')).toBe('Planned');
  });

  it('maps activation + coverage fractions to tone by band', () => {
    expect(activationTone(1)).toBe('green');
    expect(activationTone(0.5)).toBe('orange');
    expect(activationTone(0.1)).toBe('red');
    expect(coverageTone(1)).toBe('green');
    expect(coverageTone(0.6)).toBe('blue');
    expect(coverageTone(0.2)).toBe('gray');
  });

  it('tones entity refs by present/active', () => {
    expect(refTone({ present: true, active: true })).toBe('green');
    expect(refTone({ present: true, active: false })).toBe('orange');
    expect(refTone({ present: false, active: false })).toBe('gray');
    expect(refLabel({ present: true, active: false })).toBe('available');
    expect(refLabel({ present: true, active: true })).toBe('active');
    expect(refLabel({ present: false, active: false })).toBe('absent');
  });

  it('maps kpi band, entity-kind icon, and pct', () => {
    expect(kpiBandTone('healthy')).toBe('green');
    expect(kpiBandTone('critical')).toBe('red');
    expect(kpiBandTone(undefined)).toBe('gray');
    expect(entityKindIcon('connector')).toBe('connectors');
    expect(entityKindIcon('compliance')).toBe('shield');
    expect(pct(0.723)).toBe('72%');
    expect(pct(1)).toBe('100%');
  });
});
