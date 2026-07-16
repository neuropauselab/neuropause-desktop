/**
 * P17 — Global Orchestration Center presentation-mapping tests (pure, Node).
 */
import { describe, expect, it } from 'vitest';
import { bandLabel, bandTone, flowIcon, orchestratorIcon, pct } from './orchestrationCenterModel';

describe('orchestrationCenterModel', () => {
  it('maps orchestration band to tone + label', () => {
    expect(bandTone('healthy')).toBe('green');
    expect(bandTone('watch')).toBe('blue');
    expect(bandTone('at-risk')).toBe('orange');
    expect(bandTone('critical')).toBe('red');
    expect(bandLabel('at-risk')).toBe('At risk');
  });

  it('maps orchestrator + flow icons and pct', () => {
    expect(orchestratorIcon('global')).toBe('command');
    expect(orchestratorIcon('workforce')).toBe('cpu');
    expect(orchestratorIcon('unknown')).toBe('grid'); // safe fallback
    expect(flowIcon('knowledge')).toBe('sparkles');
    expect(flowIcon('federation')).toBe('globe');
    expect(pct(0.723)).toBe('72%');
  });
});
