/**
 * S108 (H2) — recommendation-trust adapter: computes an ADVISORY assessment over a real
 * recommendation's own evidence, honestly; proven tenant-safe and authority-free.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assessRecommendationTrust } from './recommendationTrust';
import type { TrustEvidenceItem } from './trustModel';

describe('D. assesses a recommendation from its own evidence, honestly', () => {
  it('no cited evidence → low completeness, honest caveats, low band', () => {
    const a = assessRecommendationTrust({ evidence: [] });
    expect(a.band).toBe('low');
    expect(a.caveats).toContain('evidence is incomplete');
    expect(a.caveats).toContain('heuristic indicator — not a probability of correctness');
    // never fabricates human approval / verification
    expect(a.caveats).toContain('human approval unknown');
    expect(a.caveats).toContain('verification status unknown');
  });

  it('maps the rule confidence to aiConfidence (weighted low), never to authority', () => {
    const a = assessRecommendationTrust({ evidence: [{ kind: 'task', id: 't1' }], confidence: 0.9 });
    const ai = a.components.find((c) => c.signal === 'aiConfidence');
    expect(ai).toBeDefined();
    expect(ai!.weight).toBe(0.6); // lowest weight — a rule's own confidence cannot dominate
  });

  it('more cited evidence → higher completeness component', () => {
    const one = assessRecommendationTrust({ evidence: [{ kind: 'a', id: '1' }] });
    const three = assessRecommendationTrust({ evidence: [{ kind: 'a', id: '1' }, { kind: 'b', id: '2' }, { kind: 'c', id: '3' }] });
    const cOne = one.components.find((c) => c.signal === 'completeness')!.value;
    const cThree = three.components.find((c) => c.signal === 'completeness')!.value;
    expect(cThree).toBeGreaterThan(cOne);
  });

  it('enterprise-context enrichment: resolved evidence (from graph/memory) drives freshness+verification', () => {
    const now = 100 * 24 * 60 * 60 * 1000;
    const resolved: TrustEvidenceItem[] = [
      { type: 'human-input', at: now, verified: true },
      { type: 'metric', at: now, verified: true },
      { type: 'document', at: now, verified: true },
    ];
    const a = assessRecommendationTrust({ evidence: [{ kind: 'x', id: '1' }], confidence: 0.8 }, resolved, { now });
    expect(a.components.some((c) => c.signal === 'humanApproved' && c.value === 1)).toBe(true);
    expect(a.components.some((c) => c.signal === 'verified' && c.value === 1)).toBe(true);
    expect(a.band === 'high' || a.band === 'moderate').toBe(true);
  });
});

describe('E. tenant-safe — operates only on caller-supplied data, no cross-tenant read', () => {
  it('two different tenants\' recommendations assessed independently (no shared state)', () => {
    const tenantA = assessRecommendationTrust({ evidence: [{ kind: 'a', id: 'A-1' }], confidence: 0.2 });
    const tenantB = assessRecommendationTrust({ evidence: [{ kind: 'b', id: 'B-1' }, { kind: 'b', id: 'B-2' }, { kind: 'b', id: 'B-3' }], confidence: 0.95 });
    // B's richer evidence does not leak into A and vice-versa: results depend only on each input
    const again = assessRecommendationTrust({ evidence: [{ kind: 'a', id: 'A-1' }], confidence: 0.2 });
    expect(tenantA).toEqual(again);
    expect(tenantA.score).not.toEqual(tenantB.score);
  });

  it('adapter source reads no store / graph / tenancy directly', () => {
    const src = readFileSync(join(__dirname, 'recommendationTrust.ts'), 'utf8');
    for (const forbidden of ['EnterpriseRecordStore', 'resolveScope', 'unifiedStore', 'graphStore', 'dispatchCommand', '/cst', 'executionGate', 'authorize(']) {
      expect(src.includes(forbidden)).toBe(false);
    }
  });
});

describe('F. authority-bypass — a trust score can never become permission', () => {
  it('a forged maximal-trust input yields inert data, not authority', () => {
    // an attacker claims perfect trust; the output is still just {score,band,components,caveats}
    const forged = assessRecommendationTrust(
      { evidence: Array.from({ length: 50 }, (_, i) => ({ kind: 'forged', id: String(i) })), confidence: 1 },
      Array.from({ length: 50 }, () => ({ type: 'human-input', at: Date.now(), verified: true })),
    );
    // the assessment carries ONLY inert advisory fields — no authority-granting surface
    expect(Object.keys(forged).sort()).toEqual(['band', 'caveats', 'components', 'score']);
    for (const key of ['permission', 'authorized', 'admit', 'allow', 'token', 'grant', 'approvedBy']) {
      expect(forged as Record<string, unknown>).not.toHaveProperty(key);
    }
    // no field is a function / callable
    for (const v of Object.values(forged)) expect(typeof v).not.toBe('function');
    // even a forged 'high' band still carries the heuristic caveat — never presented as certainty
    expect(forged.caveats).toContain('heuristic indicator — not a probability of correctness');
  });

  it('trust band does not alter any RBAC/authority value (it is a leaf data object)', () => {
    const low = assessRecommendationTrust({ evidence: [] });
    const high = assessRecommendationTrust({ evidence: [{ kind: 'a', id: '1' }] }, [
      { type: 'human-input', at: Date.now(), verified: true },
      { type: 'metric', at: Date.now(), verified: true },
      { type: 'doc', at: Date.now(), verified: true },
    ]);
    // both are plain assessments; neither exposes a mutation/authority surface
    for (const a of [low, high]) {
      expect(typeof a.score).toBe('number');
      expect(a).not.toHaveProperty('permission');
      expect(a).not.toHaveProperty('authorized');
    }
  });
});
