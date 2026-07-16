/**
 * P11 — Cloud Control Plane presentation-mapping tests.
 */
import { describe, expect, it } from 'vitest';
import {
  gateLabel,
  gateTone,
  healthLabel,
  healthTone,
  replicationTone,
  residencyLabel,
  statusTone,
  subsystemIcon,
  tierLabel,
  utilizationTone,
} from './controlPlaneModel';

describe('controlPlaneModel', () => {
  it('maps health to tones and labels', () => {
    expect(healthTone('healthy')).toBe('green');
    expect(healthTone('degraded')).toBe('orange');
    expect(healthTone('down')).toBe('red');
    expect(healthLabel('down')).toBe('Down');
  });

  it('maps deployment gates, tenant tiers/status, replication', () => {
    expect(gateTone('ok')).toBe('green');
    expect(gateLabel('blocked')).toBe('Blocked');
    expect(tierLabel('enterprise')).toBe('Enterprise');
    expect(statusTone('suspended')).toBe('red');
    expect(replicationTone('lagging')).toBe('orange');
    expect(replicationTone('none')).toBe('gray');
  });

  it('maps subsystem icons, residency, and utilization tone', () => {
    expect(subsystemIcon('api')).toBe('server');
    expect(subsystemIcon('recovery')).toBe('shield');
    expect(residencyLabel('eu')).toBe('EU');
    expect(utilizationTone(95)).toBe('red');
    expect(utilizationTone(50)).toBe('green');
  });
});
