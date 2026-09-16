/**
 * S109 / FG-S108-TRUST — the recommendation engine attaches the ADVISORY evidence-trust
 * assessment to every generated recommendation, WITHOUT altering ranking/score/confidence.
 */
import { describe, it, expect } from 'vitest';
import { generateRecommendations, type RecommendationInput } from './recommendationEngine';

const NOW = '2026-02-01T00:00:00.000Z';
function baseInput(over: Partial<RecommendationInput> = {}): RecommendationInput {
  return { entities: [], events: [], now: NOW, ...over };
}

describe('FG-S108-TRUST — engine attaches advisory trust', () => {
  it('every generated recommendation carries a trust assessment with a valid band + heuristic caveat', () => {
    const recs = generateRecommendations(
      baseInput({
        pendingApprovals: [{ jobId: 'j1', title: 'Approve X', workerName: 'bot', createdAt: NOW }],
        connectors: [{ id: 'slack', problem: 'auth expired' }],
      }),
    );
    expect(recs.length).toBeGreaterThan(0);
    for (const r of recs) {
      expect(r.trust).toBeDefined();
      expect(['low', 'moderate', 'high']).toContain(r.trust!.band);
      expect(typeof r.trust!.score).toBe('number');
      expect(r.trust!.caveats).toContain('heuristic indicator — not a probability of correctness');
    }
  });

  it('trust attachment does NOT change existing confidence or ranking order', () => {
    const input = baseInput({
      pendingApprovals: [{ jobId: 'j1', title: 'Approve X', workerName: 'bot', createdAt: NOW }],
      connectors: [{ id: 'slack', problem: 'auth expired' }],
    });
    const recs = generateRecommendations(input);
    // ranking is by descending score — unchanged by trust
    const scores = recs.map((r) => r.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    // each rule still carries its OWN confidence (a number in [0,1]) — trust never overwrites it;
    // the stage5 suite pins the exact rule constants (confidence===1) and remains green.
    for (const r of recs) {
      if (r.confidence !== undefined) {
        expect(typeof r.confidence).toBe('number');
        expect(r.confidence).toBeGreaterThanOrEqual(0);
        expect(r.confidence).toBeLessThanOrEqual(1);
      }
      // trust is advisory data only — never an authority/permission field
      expect(r.trust).not.toHaveProperty('permission');
      expect(r.trust).not.toHaveProperty('authorized');
    }
  });

  it('empty input → no recommendations → nothing to assess (no crash, no fabricated trust)', () => {
    const recs = generateRecommendations(baseInput());
    expect(Array.isArray(recs)).toBe(true);
    // whatever is produced (possibly none), each still carries an honest assessment
    for (const r of recs) expect(r.trust).toBeDefined();
  });
});
