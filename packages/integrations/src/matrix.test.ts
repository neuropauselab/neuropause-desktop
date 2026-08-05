import { describe, it, expect } from 'vitest';
import { INTEGRATION_MATRIX, readinessSummary, LIVE_VERIFIED_IDS } from './matrix';

describe('Integration & Production Readiness matrices (anti-fabrication invariants)', () => {
  it('every entry carries a valid evidence + live level', () => {
    for (const e of INTEGRATION_MATRIX) {
      expect(['verified', 'adapter-verified', 'infra-pending']).toContain(e.evidence);
      expect(['verified', 'infra-pending']).toContain(e.live);
      expect(e.capabilities.length).toBeGreaterThan(0);
    }
  });

  it('NOTHING claims a live-verified integration it did not actually run', () => {
    // The core "never fabricate successful integrations" invariant.
    for (const e of INTEGRATION_MATRIX) {
      if (e.live === 'verified') expect(LIVE_VERIFIED_IDS.has(e.id)).toBe(true);
    }
    // and the only live-verified integration is the one executed against a real engine
    expect([...LIVE_VERIFIED_IDS]).toEqual(['postgresql']);
  });

  it('every AI provider is adapter-verified with live invocation pending', () => {
    const providers = INTEGRATION_MATRIX.filter((e) => e.category === 'ai-provider');
    expect(providers.map((p) => p.id).sort()).toEqual(['anthropic', 'azure-openai', 'google-gemini', 'ollama', 'openai', 'openrouter']);
    expect(providers.every((p) => p.evidence === 'adapter-verified' && p.live === 'infra-pending')).toBe(true);
  });

  it('Postgres is the verified database connector; the rest are adapter-verified', () => {
    const pg = INTEGRATION_MATRIX.find((e) => e.id === 'postgresql')!;
    expect(pg.evidence).toBe('verified');
    expect(pg.live).toBe('verified');
    expect(INTEGRATION_MATRIX.filter((e) => e.category === 'database' && e.id !== 'postgresql').every((e) => e.live === 'infra-pending')).toBe(true);
  });

  it('summarizes readiness honestly', () => {
    const s = readinessSummary();
    expect(s.total).toBe(INTEGRATION_MATRIX.length);
    expect(s.liveVerified).toBe(1); // only Postgres
    expect(s.verified + s.adapterVerified).toBe(s.total); // no entry is un-leveled
  });
});
