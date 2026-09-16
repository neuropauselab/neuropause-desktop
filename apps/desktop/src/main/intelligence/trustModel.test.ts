/**
 * S108 (H2) — harvested TrustModel: reproduces ckdl/trust.ts behavior + edge/purity +
 * structural authority-bypass proof. ADVISORY only.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assessTrust,
  assessEvidenceTrust,
  trustBandLabel,
  TRUST_WEIGHTS,
  type TrustEvidenceItem,
} from './trustModel';

const DAY = 24 * 60 * 60 * 1000;

// A — source reproduction: the ckdl evidenceTrust.test.ts assertions, reproduced verbatim.
describe('A. reproduces ckdl/trust.ts behavior', () => {
  it('returns a weighted breakdown and always caveats that it is a heuristic', () => {
    const a = assessTrust({ sourceReliability: 0.9, verified: true, humanApproved: true, auditIntact: true, completeness: 0.8 });
    expect(a.band).toBe('high');
    expect(a.components.length).toBeGreaterThan(0);
    expect(a.caveats).toContain('heuristic indicator — not a probability of correctness');
    const hw = a.components.find((c) => c.signal === 'humanApproved')!.weight;
    const b = assessTrust({ aiConfidence: 1 });
    const aw = b.components.find((c) => c.signal === 'aiConfidence')!.weight;
    expect(hw).toBeGreaterThan(aw); // human approval weighted above AI confidence
  });

  it('decays freshness with age and flags stale data', () => {
    const thirtyDays = 30 * DAY;
    const fresh = assessTrust({ freshnessAt: thirtyDays }, { now: thirtyDays });
    const stale = assessTrust({ freshnessAt: 0 }, { now: thirtyDays }); // 30 days old
    const freshVal = fresh.components.find((c) => c.signal === 'freshness')!.value;
    const staleVal = stale.components.find((c) => c.signal === 'freshness')!.value;
    expect(freshVal).toBeGreaterThan(0.99);
    expect(staleVal).toBeCloseTo(0.5, 1);
    expect(stale.caveats).toContain('underlying data is stale');
  });

  it('lists a caveat for every absent signal', () => {
    const a = assessTrust({});
    for (const missing of ['source reliability not provided', 'freshness unknown', 'human approval unknown', 'verification status unknown', 'audit integrity unknown', 'completeness unknown']) {
      expect(a.caveats).toContain(missing);
    }
  });

  it('derives trust from an evidence set (human-input recognized)', () => {
    const now = 10 * DAY;
    const ev: TrustEvidenceItem[] = [
      { type: 'human-input', at: now, verified: true },
      { type: 'metric', at: now, verified: false },
    ];
    const a = assessEvidenceTrust(ev, {}, { now });
    expect(a.components.some((c) => c.signal === 'humanApproved' && c.value === 1)).toBe(true);
    expect(a.score).toBeGreaterThan(0);
  });

  it('weights are harvested verbatim (human 1.5 > verified/audit 1.2 > source/completeness 1.0 > freshness 0.8 > ai 0.6)', () => {
    expect(TRUST_WEIGHTS).toEqual({ sourceReliability: 1.0, freshness: 0.8, verified: 1.2, humanApproved: 1.5, aiConfidence: 0.6, auditIntact: 1.2, completeness: 1.0 });
  });
});

// B — bands (harvested verbatim; no invented band)
describe('B. bands are the source bands only', () => {
  it('low <0.4, moderate <0.7, high otherwise', () => {
    expect(assessTrust({ completeness: 0 }).band).toBe('low');
    expect(assessTrust({ completeness: 0.5 }).band).toBe('moderate'); // single 0.5 component → score 0.5
    expect(assessTrust({ humanApproved: true, verified: true, auditIntact: true, completeness: 1, sourceReliability: 1 }).band).toBe('high');
    expect(trustBandLabel('low')).toBe('LOW');
    expect(trustBandLabel('moderate')).toBe('MODERATE');
    expect(trustBandLabel('high')).toBe('HIGH');
  });

  it('empty evidence set → completeness 0 → low band, incomplete caveat', () => {
    const a = assessEvidenceTrust([]);
    expect(a.band).toBe('low');
    expect(a.caveats).toContain('evidence is incomplete');
  });
});

// C — edge/purity/totality
describe('C. pure & total', () => {
  it('NaN / out-of-range clamp, never throws', () => {
    expect(() => assessTrust({ sourceReliability: Number.NaN, completeness: 5, aiConfidence: -3 })).not.toThrow();
    const a = assessTrust({ sourceReliability: Number.NaN, completeness: 5, aiConfidence: -3 });
    expect(a.components.find((c) => c.signal === 'sourceReliability')!.value).toBe(0);
    expect(a.components.find((c) => c.signal === 'completeness')!.value).toBe(1);
    expect(a.components.find((c) => c.signal === 'aiConfidence')!.value).toBe(0);
  });

  it('deterministic for a fixed now', () => {
    const s = { freshnessAt: 0, verified: true, completeness: 0.7 };
    expect(assessTrust(s, { now: 5 * DAY })).toEqual(assessTrust(s, { now: 5 * DAY }));
  });

  it('score in [0,1]', () => {
    const a = assessTrust({ humanApproved: true, aiConfidence: 1, verified: true, auditIntact: true, sourceReliability: 1, completeness: 1, freshnessAt: 0 }, { now: 0 });
    expect(a.score).toBeGreaterThanOrEqual(0);
    expect(a.score).toBeLessThanOrEqual(1);
  });
});

// F — structural authority-bypass proof: the module imports nothing that could grant authority.
describe('F. trust module has NO authority coupling (structural)', () => {
  it('imports nothing from cst / authz / command bus / executor / store', () => {
    const src = readFileSync(join(__dirname, 'trustModel.ts'), 'utf8');
    for (const forbidden of ['/cst', 'executionGate', 'dispatchCommand', 'commandBus', 'runtimeAuthz', 'authorize(', 'EnterpriseRecordStore', 'postStockMovement', 'applyGlDerivedEntries', '@neuropause/ckdl']) {
      expect(src.includes(forbidden)).toBe(false);
    }
  });

  it('assess() returns only inert data (no functions, no callables)', () => {
    const a = assessTrust({ humanApproved: true });
    expect(typeof a.score).toBe('number');
    expect(Array.isArray(a.components)).toBe(true);
    expect(Array.isArray(a.caveats)).toBe(true);
    // no field is a function / executable
    for (const v of Object.values(a)) expect(typeof v).not.toBe('function');
  });
});
