import { describe, it, expect } from 'vitest';
import { healthTone, riskTone, count, pctText, EMPTY_LENS } from './aiOperationsModel';

describe('aiOperationsModel shared contract', () => {
  it('healthTone bands higher-is-better', () => {
    expect(healthTone(0.95)).toBe('green');
    expect(healthTone(0.8)).toBe('green');
    expect(healthTone(0.6)).toBe('orange');
    expect(healthTone(0.5)).toBe('orange');
    expect(healthTone(0.2)).toBe('red');
    expect(healthTone(0)).toBe('red');
  });

  it('riskTone bands higher-is-worse', () => {
    expect(riskTone(0.9)).toBe('red');
    expect(riskTone(0.66)).toBe('red');
    expect(riskTone(0.4)).toBe('orange');
    expect(riskTone(0.33)).toBe('orange');
    expect(riskTone(0.1)).toBe('green');
    expect(riskTone(0)).toBe('green');
  });

  it('tones are gray for non-finite input (never a misleading color)', () => {
    expect(healthTone(Number.NaN)).toBe('gray');
    expect(healthTone(Number.POSITIVE_INFINITY)).toBe('gray');
    expect(riskTone(Number.NaN)).toBe('gray');
  });

  it('count truncates and guards non-finite', () => {
    expect(count(3.9)).toBe('3');
    expect(count(0)).toBe('0');
    expect(count(undefined)).toBe('0');
    expect(count(null)).toBe('0');
    expect(count(Number.NaN)).toBe('0');
  });

  it('pctText rounds and guards non-finite', () => {
    expect(pctText(0.5)).toBe('50%');
    expect(pctText(0.336)).toBe('34%');
    expect(pctText(undefined)).toBe('—');
    expect(pctText(Number.NaN)).toBe('—');
  });

  it('EMPTY_LENS is genuinely empty', () => {
    expect(EMPTY_LENS.stats).toEqual([]);
    expect(EMPTY_LENS.groups).toEqual([]);
    expect(EMPTY_LENS.gaps).toEqual([]);
  });
});
