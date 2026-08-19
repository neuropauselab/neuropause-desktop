/**
 * Product Operations v1.0 — model tests. Lock the pure lens: honest status→tone maps, the verified
 * deployment-target map, the operational-gap catalog (never empty / always reasoned), and the pure
 * release-readiness derivation over the real Release Diagnostics shape.
 */
import { describe, expect, it } from 'vitest';
import type { FeatureFlagState, ReleaseDiagnostics } from '@neuropause/shared';
import {
  DEPLOYMENT_TARGETS,
  OPERATIONAL_GAPS,
  describeLoadFailures,
  deriveReleaseReadiness,
  diagnosticTone,
  gapKindMeta,
  healthLevelTone,
  signingMeta,
  targetStatusMeta,
  updatePhaseMeta,
} from './productOpsModel';

const flags = (enabled: number, total: number): FeatureFlagState[] =>
  Array.from({ length: total }, (_, i) => ({
    key: (['cloud_sync', 'automation_builder', 'ai_memory_search', 'advanced_analytics', 'multi_workspace'] as const)[i % 5],
    enabled: i < enabled,
    source: 'default' as const,
    description: 'flag',
  }));

function diag(over: {
  packaged?: boolean;
  signed?: boolean;
  signState?: ReleaseDiagnostics['signing']['state'];
  phase?: ReleaseDiagnostics['update']['phase'];
  error?: string | null;
}): ReleaseDiagnostics {
  return {
    generatedAt: '2026-07-18T00:00:00.000Z',
    build: { version: '1.2.3', channel: 'stable', commit: 'abc1234', buildTime: '', platform: 'darwin', arch: 'arm64', packaged: over.packaged ?? true, runtime: { electron: '', node: '', chrome: '', v8: '' } },
    signing: { state: over.signState ?? (over.signed === false ? 'unsigned' : 'signed'), signed: over.signed ?? true, notarized: null, authority: null, detail: null },
    update: { phase: over.phase ?? 'not-available', channel: 'stable', currentVersion: '1.2.3', available: null, progress: null, error: over.error ?? null } as ReleaseDiagnostics['update'],
    health: { generatedAt: '', overall: 'ok', uptimeMs: 0, checks: [], metrics: {}, timeline: {}, subscribers: [] } as unknown as ReleaseDiagnostics['health'],
    modules: [],
    connectors: [],
  };
}

describe('status → tone maps', () => {
  it('diagnostic + health + update + signing tones are honest', () => {
    expect(diagnosticTone('ok')).toBe('green');
    expect(diagnosticTone('degraded')).toBe('orange');
    expect(diagnosticTone('down')).toBe('red');
    expect(healthLevelTone('healthy')).toBe('green');
    expect(healthLevelTone('critical')).toBe('red');
    expect(healthLevelTone('offline')).toBe('red');
    expect(updatePhaseMeta('error').tone).toBe('red');
    expect(updatePhaseMeta('not-available').label).toBe('Up to date');
    expect(signingMeta('signed-notarized').tone).toBe('green');
    expect(signingMeta('unsigned').tone).toBe('orange');
  });
});

describe('operational-gap catalog (honesty ledger)', () => {
  it('is non-empty and every gap carries an area, capability, valid kind and reason', () => {
    expect(OPERATIONAL_GAPS.length).toBeGreaterThan(0);
    for (const g of OPERATIONAL_GAPS) {
      expect(g.area.length).toBeGreaterThan(0);
      expect(g.capability.length).toBeGreaterThan(0);
      expect(g.reason.length).toBeGreaterThan(0);
      expect(['external', 'not-in-app', 'roadmap']).toContain(g.kind);
      expect(gapKindMeta(g.kind).label.length).toBeGreaterThan(0);
    }
  });

  it('records engineering CI as external and revenue as not-in-app (the two load-bearing honesty claims)', () => {
    const eng = OPERATIONAL_GAPS.find((g) => g.area === 'Engineering');
    expect(eng?.kind).toBe('external');
    const rev = OPERATIONAL_GAPS.find((g) => g.capability.toLowerCase().includes('revenue'));
    expect(rev?.kind).toBe('not-in-app');
  });
});

describe('deployment-target map (verified reality)', () => {
  it('ships mac + win + cloud + offline, marks linux unsupported and edge/mdm roadmap', () => {
    const by = (id: string) => DEPLOYMENT_TARGETS.find((t) => t.id === id);
    expect(by('desktop-mac')?.status).toBe('shipping');
    expect(by('desktop-win')?.status).toBe('shipping');
    expect(by('cloud')?.status).toBe('shipping');
    expect(by('offline')?.status).toBe('shipping');
    expect(by('desktop-linux')?.status).toBe('unsupported');
    expect(by('edge')?.status).toBe('roadmap');
    expect(by('mdm')?.status).toBe('roadmap');
    for (const t of DEPLOYMENT_TARGETS) expect(targetStatusMeta(t.status).label.length).toBeGreaterThan(0);
  });
});

describe('deriveReleaseReadiness (pure over real Release Diagnostics)', () => {
  it('a signed, packaged, up-to-date build is release-ready with no blockers', () => {
    const r = deriveReleaseReadiness(diag({ packaged: true, signed: true, phase: 'not-available' }), flags(3, 5));
    expect(r.releaseReady).toBe(true);
    expect(r.blockers).toEqual([]);
    expect(r.version).toBe('1.2.3');
    expect(r.flagsEnabled).toBe(3);
    expect(r.flagsTotal).toBe(5);
  });

  it('an unpackaged dev build is not release-ready and says so', () => {
    const r = deriveReleaseReadiness(diag({ packaged: false }), flags(0, 5));
    expect(r.releaseReady).toBe(false);
    expect(r.blockers.join(' ')).toMatch(/development build/i);
  });

  it('a packaged but unsigned build is blocked on signing', () => {
    const r = deriveReleaseReadiness(diag({ packaged: true, signed: false, signState: 'unsigned' }), flags(1, 5));
    expect(r.releaseReady).toBe(false);
    expect(r.blockers.join(' ')).toMatch(/code-signed/i);
  });

  it('an updater error surfaces as a blocker with the error text', () => {
    const r = deriveReleaseReadiness(diag({ phase: 'error', error: 'feed 404' }), flags(2, 5));
    expect(r.releaseReady).toBe(false);
    expect(r.blockers.join(' ')).toMatch(/feed 404/);
  });
});

// NP-008 census F-N8-3 — the derivation pin: refusals become a NAMED banner,
// never silent fallbacks; a clean load renders no banner at all.
describe('describeLoadFailures', () => {
  it('renders nothing when every source loaded', () => {
    expect(describeLoadFailures([])).toBeNull();
  });

  it('names the failed sources and labels the panels as fallback, not verified state', () => {
    const text = describeLoadFailures(['Backups', 'Commercial overview']);
    expect(text).toContain('2 of the operations panels could not load');
    expect(text).toContain('Backups');
    expect(text).toContain('Commercial overview');
    expect(text).toContain('a fallback, not verified state');
  });
});
