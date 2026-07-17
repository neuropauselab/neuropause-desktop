/**
 * Experience Program v1.0 — service tests: composition, snapshot + projection memoization, invalidation,
 * and the TTL freshness window.
 */
import { describe, expect, it } from 'vitest';
import { ExperienceService } from './experienceService';
import type { ExperienceState } from './experienceModel';

function baseState(over: Partial<ExperienceState> = {}): ExperienceState {
  return {
    greeting: 'Good morning', generatedAt: '2026-07-16T08:00:00.000Z',
    health: { score: 80, band: 'healthy' }, mission: { title: 'M', detail: 'd', why: 'w' },
    revenue: { display: '$1M', label: 'Revenue', band: 'healthy', detail: 'x' },
    workforce: { successPct: 90, activeWorkers: 5, needApproval: 1 },
    oneDecision: { id: 'dec:1', title: 'D', why: 'w', band: 'watch', source: 'Strategy', requiredApprovals: 1, evidenceCount: 2 },
    oneRisk: null, oneApproval: null,
    kpiPool: { health: { label: 'Business health', display: '80/100', band: 'healthy' }, revenue: { label: 'Revenue', display: '$1M', band: 'healthy' }, approvals: { label: 'Approvals pending', display: '1', band: 'watch' } },
    decisions: [{ id: 'dec:1', kind: 'decision', title: 'D', why: 'w', band: 'watch', urgency: 70, source: 'Strategy', requiredApprovals: 1, evidenceCount: 2 }],
    rawDecisionSignals: 50,
    moduleSummaries: [{ key: 'twin', label: 'Digital Twin', headline: 'Twin healthy.', band: 'healthy', compressedFrom: 100, detail: 'x', expandTo: 'twin-center' }],
    compressedSignals: 150,
    ...over,
  };
}

describe('ExperienceService', () => {
  it('composes every projection from the injected reader', () => {
    const svc = new ExperienceService({ readState: () => baseState() });
    expect(svc.home().roleViews).toHaveLength(8);
    expect(svc.decisions().items).toHaveLength(1);
    expect(svc.summaries().disclosure).toHaveLength(3);
    expect(svc.intents().intents.length).toBeGreaterThanOrEqual(8);
    expect(svc.governance().experienceScope).toBe('experience:read');
  });

  it('memoizes the snapshot + projections and recomposes only after invalidate()', () => {
    const box = { value: baseState() };
    let reads = 0;
    const svc = new ExperienceService({
      readState: () => {
        reads += 1;
        return box.value;
      },
    });
    const h1 = svc.home();
    expect(svc.home()).toBe(h1); // same reference → O(1) cache hit
    expect(svc.decisions()).toBe(svc.decisions());
    expect(reads).toBe(1);

    box.value = baseState({ compressedSignals: 999 });
    expect(svc.home()).toBe(h1); // still cached
    svc.invalidate();
    expect(svc.home()).not.toBe(h1); // recomposed
    expect(svc.home().compressedSignals).toBe(999);
    expect(reads).toBe(2);
  });

  it('refreshes after the TTL even without invalidate() — fixes injected platform staleness', () => {
    let clock = 1_000;
    let reads = 0;
    const svc = new ExperienceService({
      readState: () => {
        reads += 1;
        return baseState();
      },
      ttlMs: 3000,
      now: () => clock,
    });
    svc.home();
    svc.home();
    expect(reads).toBe(1); // within TTL → cached
    clock += 3000;
    svc.home();
    expect(reads).toBe(2); // recomposed on its own
  });
});
