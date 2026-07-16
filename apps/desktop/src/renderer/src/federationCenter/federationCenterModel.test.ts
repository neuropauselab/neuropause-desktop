/**
 * P10 — Federation Center presentation-mapping tests.
 */
import { describe, expect, it } from 'vitest';
import {
  decisionLabel,
  decisionTone,
  healthTone,
  nodeIcon,
  scopeTone,
  searchLabel,
  statusTone,
  timelineIcon,
  trustLabel,
  trustTone,
} from './federationCenterModel';

describe('federationCenterModel', () => {
  it('maps trust levels to tones and labels', () => {
    expect(trustTone('full')).toBe('green');
    expect(trustTone('verified')).toBe('blue');
    expect(trustTone('none')).toBe('gray');
    expect(trustLabel('verified')).toBe('Verified');
  });

  it('maps health, status, and governance decisions', () => {
    expect(healthTone('healthy')).toBe('green');
    expect(healthTone('attention')).toBe('orange');
    expect(statusTone('suspended')).toBe('red');
    expect(decisionTone('deny')).toBe('red');
    expect(decisionTone('allow')).toBe('green');
    expect(decisionLabel('require_approval')).toBe('Approval');
  });

  it('maps timeline / node / search / scope presentation', () => {
    expect(timelineIcon('artifact_publish')).toBe('package');
    expect(nodeIcon('organization')).toBe('globe');
    expect(searchLabel('policy')).toBe('Policy');
    expect(scopeTone('public')).toBe('green');
    expect(scopeTone('private')).toBe('gray');
  });
});
