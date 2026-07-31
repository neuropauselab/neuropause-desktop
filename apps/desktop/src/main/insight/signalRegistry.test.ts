/**
 * Phase 6 Stage 6 — the Signal Registry (D-2 + enhancement #1): structural
 * integrity of the 22-signal map, the freshness/completeness/trust metadata,
 * the runtime-status derivation, and the registry ↔ SIGNAL-MAP.md doc lock.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PROJECTED_SIGNAL_IDS,
  SIGNAL_BY_ID,
  SIGNAL_REGISTRY,
  freshnessStateFor,
  registryIntegrityIssues,
  signalStatus,
} from './signalRegistry';

const NOW = Date.parse('2026-07-31T12:00:00.000Z');

describe('SIGNAL_REGISTRY integrity', () => {
  it('has 22 signals, unique ids, contiguous map indexes, and no issues', () => {
    expect(SIGNAL_REGISTRY).toHaveLength(22);
    expect(registryIntegrityIssues()).toEqual([]);
  });

  it('every signal declares freshness, completeness, and trust (enhancement #1)', () => {
    for (const s of SIGNAL_REGISTRY) {
      expect(['realtime', 'per-sync', 'scheduled', 'daily', 'on-demand', 'on-view']).toContain(s.freshness.cadence);
      expect(['full', 'bounded', 'partial']).toContain(s.completeness.coverage);
      if (s.completeness.coverage !== 'full') expect(s.completeness.note).toBeTruthy();
      expect(['provider-authoritative', 'runtime-recorded', 'derived', 'heuristic']).toContain(s.trust.tier);
      expect(s.trust.score).toBeGreaterThan(0);
      expect(s.trust.score).toBeLessThanOrEqual(1);
    }
  });

  it('declared dependencies resolve inside the registry', () => {
    for (const s of SIGNAL_REGISTRY) {
      for (const dep of s.dependsOn) expect(SIGNAL_BY_ID.has(dep)).toBe(true);
    }
  });

  it('the projected signal set is a registry subset', () => {
    for (const id of PROJECTED_SIGNAL_IDS) expect(SIGNAL_BY_ID.has(id)).toBe(true);
  });
});

describe('registry ↔ doc lock (D-2)', () => {
  it('every registry id and name appears in docs/desktop/insight/SIGNAL-MAP.md', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const doc = readFileSync(join(here, '../../../../../docs/desktop/insight/SIGNAL-MAP.md'), 'utf8');
    for (const s of SIGNAL_REGISTRY) {
      expect(doc, `doc missing id ${s.id}`).toContain(`\`${s.id}\``);
      expect(doc, `doc missing owner for ${s.id}`).toContain(s.owner.split(' ')[0]);
    }
    // The doc's numbered rows match the registry size.
    expect(doc).toContain(`| ${SIGNAL_REGISTRY.length} | \`hub-feeds\``);
  });
});

describe('freshnessStateFor', () => {
  it('signals without a staleness window are fresh whenever read', () => {
    const def = SIGNAL_BY_ID.get('timeline-events')!;
    expect(freshnessStateFor(def, null, NOW)).toBe('fresh');
    expect(freshnessStateFor(def, NOW - 90 * 86_400_000, NOW)).toBe('fresh');
  });

  it('windowed signals age honestly: fresh → aging → stale; missing timestamp → unknown', () => {
    const def = SIGNAL_BY_ID.get('connector-health')!; // stale after 120 min
    expect(freshnessStateFor(def, NOW - 60 * 60_000, NOW)).toBe('fresh');
    expect(freshnessStateFor(def, NOW - 180 * 60_000, NOW)).toBe('aging');
    expect(freshnessStateFor(def, NOW - 400 * 60_000, NOW)).toBe('stale');
    expect(freshnessStateFor(def, null, NOW)).toBe('unknown');
  });
});

describe('signalStatus', () => {
  it('an unavailable read is an explicit hole with zero completeness', () => {
    const s = signalStatus('workforce-jobs', { available: false, itemCount: null, latestAt: null, note: 'boom' }, NOW);
    expect(s).toMatchObject({ available: false, completeness: 0, freshness: 'unknown', note: 'boom' });
  });

  it('bounded coverage caps completeness below full; staleness degrades it further', () => {
    const fresh = signalStatus(
      'automation-runs',
      { available: true, itemCount: 12, latestAt: new Date(NOW - 60_000).toISOString(), note: null },
      NOW,
    );
    expect(fresh.freshness).toBe('fresh');
    expect(fresh.completeness).toBeLessThan(1); // bounded ring
    expect(fresh.completeness).toBeGreaterThan(0.8);

    const stale = signalStatus(
      'connector-health',
      { available: true, itemCount: 3, latestAt: new Date(NOW - 500 * 60_000).toISOString(), note: null },
      NOW,
    );
    expect(stale.freshness).toBe('stale');
    expect(stale.completeness).toBeLessThan(fresh.completeness);
  });

  it('an unknown signal id never fabricates a status', () => {
    const s = signalStatus('nope', { available: true, itemCount: 1, latestAt: null, note: null }, NOW);
    expect(s.available).toBe(false);
    expect(s.note).toContain('unknown');
  });
});
