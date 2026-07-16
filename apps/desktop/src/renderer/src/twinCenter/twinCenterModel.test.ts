/**
 * P15 — Digital Twin Center presentation-mapping tests (pure, Node).
 */
import { describe, expect, it } from 'vitest';
import { bandLabel, bandTone, domainIcon, execTwinIcon, pct, priorityTone, replayIcon } from './twinCenterModel';

describe('twinCenterModel', () => {
  it('maps twin band to tone + label (including unknown)', () => {
    expect(bandTone('healthy')).toBe('green');
    expect(bandTone('watch')).toBe('blue');
    expect(bandTone('at-risk')).toBe('orange');
    expect(bandTone('critical')).toBe('red');
    expect(bandTone('unknown')).toBe('gray');
    expect(bandLabel('at-risk')).toBe('At risk');
    expect(bandLabel('unknown')).toBe('Unknown');
  });

  it('maps event priority to tone', () => {
    expect(priorityTone('critical')).toBe('red');
    expect(priorityTone('high')).toBe('orange');
    expect(priorityTone('normal')).toBe('gray');
  });

  it('maps domain / replay / exec-twin icons and pct', () => {
    expect(domainIcon('infrastructure')).toBe('server');
    expect(domainIcon('federation')).toBe('globe');
    expect(replayIcon('incident')).toBe('shield');
    expect(replayIcon('worker')).toBe('cpu');
    expect(execTwinIcon('risk')).toBe('shield');
    expect(execTwinIcon('strategy')).toBe('sparkles');
    expect(pct(0.723)).toBe('72%');
  });
});
