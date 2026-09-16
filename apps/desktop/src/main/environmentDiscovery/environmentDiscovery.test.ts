import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { composeEnvironmentModel, type RequiredElement } from '../environmentModel/environmentModel';
import {
  runDiscovery,
  discoveryRequestFor,
  type DiscoverySources,
  type DiscoveryRequest,
  type DiscoveryAuthority,
} from './environmentDiscovery';

const el = (id: string): RequiredElement => ({ id, kind: 'capability', label: id });

const req = (ids: string[]): DiscoveryRequest => ({ purpose: 'send-email', minimumRequired: ids.map(el) });

const sources = (
  authority: (id: string) => DiscoveryAuthority,
  collect: (id: string) => { elementId: string; present: boolean } | null = (id) => ({ elementId: id, present: true }),
): DiscoverySources => ({
  authorize: (e) => authority(e.id),
  collect: (e) => collect(e.id),
});

describe('L3 · Environment Discovery — NEVER A SILENT SCAN (the load-bearing invariant)', () => {
  it('collect is invoked ONLY for elements with granted authority — denied/unknown are never collected', () => {
    const collect = vi.fn((e: RequiredElement) => ({ elementId: e.id, present: true }));
    const authorize = vi.fn(
      (e: RequiredElement): DiscoveryAuthority =>
        e.id === 'ok' ? 'granted' : e.id === 'no' ? 'denied' : 'unknown',
    );
    runDiscovery(req(['ok', 'no', 'maybe']), { authorize, collect });

    // Authority was checked for ALL three; collection happened for ONLY the granted one.
    expect(authorize).toHaveBeenCalledTimes(3);
    const collectedIds = collect.mock.calls.map((c) => c[0].id);
    expect(collectedIds).toEqual(['ok']);
    expect(collectedIds).not.toContain('no');
    expect(collectedIds).not.toContain('maybe');
  });

  it('deny-by-default outcomes stay UNKNOWN (never fabricated as HAVE/NEED)', () => {
    const run = runDiscovery(req(['no', 'maybe']), sources((id) => (id === 'no' ? 'denied' : 'unknown')));
    expect(run.results.map((r) => [r.outcome, r.state])).toEqual([
      ['DENIED', 'UNKNOWN'],
      ['AUTHORITY_UNKNOWN', 'UNKNOWN'],
    ]);
  });
});

describe('L3 · Environment Discovery — the pipeline outcomes', () => {
  it('granted + collected present → HAVE; absent → NEED; collector null → UNAVAILABLE', () => {
    const run = runDiscovery(req(['a', 'b', 'c']), {
      authorize: () => 'granted',
      collect: (e) => (e.id === 'c' ? null : { elementId: e.id, present: e.id === 'a' }),
    });
    expect(run.results.map((r) => [r.element.id, r.outcome, r.state])).toEqual([
      ['a', 'COLLECTED', 'HAVE'],
      ['b', 'COLLECTED', 'NEED'],
      ['c', 'COLLECTION_FAILED', 'UNAVAILABLE'],
    ]);
  });
});

describe('L3 · Environment Discovery — MINIMUM REQUIRED DATA (from a real L2 model)', () => {
  it('discoveryRequestFor requests ONLY the L2 gaps (NEED + UNKNOWN), never HAVE or UNAVAILABLE', () => {
    const model = composeEnvironmentModel('send-email', [el('have'), el('need'), el('unk'), el('unavail')], {
      probe: (e) =>
        ({ have: 'present', need: 'absent', unk: 'unknown', unavail: null } as const)[e.id] ?? null,
    });
    const request = discoveryRequestFor(model);
    expect(request.purpose).toBe('send-email');
    const ids = request.minimumRequired.map((e) => e.id).sort();
    expect(ids).toEqual(['need', 'unk']); // HAVE already satisfied; UNAVAILABLE out of reach
  });
});

describe('L3 · Environment Discovery — the five acceptance fields', () => {
  it('OBSERVABLE OBJECT — a DiscoveryRun (purpose + per-element results)', () => {
    const run = runDiscovery(req(['a']), sources(() => 'granted'));
    expect(run).toMatchObject({ purpose: 'send-email' });
    expect(run.results[0]).toMatchObject({ element: el('a'), outcome: 'COLLECTED', state: 'HAVE' });
  });

  it('CAPABILITY CONTRACT (DISCOVER ≠ RECOMMEND ≠ BUILD) — the run emits no recommendation and no built artifact', () => {
    const run = runDiscovery(req(['a']), sources(() => 'granted'));
    // DISCOVER ≠ RECOMMEND ≠ BUILD — no recommendation/build output. ("granted" is authority, not a build verb.)
    expect(JSON.stringify(run)).not.toMatch(/recommend|suggest|\bbuild\b|install|provision/i);
  });

  it('VERIFICATION — every result traces the full pipeline PURPOSE→REQUEST→AUTHORITY→[COLLECTION→CLASSIFICATION→EVIDENCE]', () => {
    const run = runDiscovery(req(['a']), sources(() => 'granted'));
    const ev = run.results[0].evidence.join(' | ');
    expect(ev).toMatch(/PURPOSE send-email/);
    expect(ev).toMatch(/REQUEST minimum-required: a/);
    expect(ev).toMatch(/AUTHORITY granted/);
    expect(ev).toMatch(/COLLECTION invoked/);
    expect(ev).toMatch(/CLASSIFICATION HAVE/);
    expect(ev).toMatch(/EVIDENCE recorded/);
  });

  it('COLLECTION BOUNDARY — a denied element\'s trace records NO COLLECTION', () => {
    const run = runDiscovery(req(['no']), sources(() => 'denied'));
    expect(run.results[0].evidence.join(' | ')).toMatch(/NO COLLECTION \(deny-by-default\)/);
    expect(run.results[0].evidence.join(' | ')).not.toMatch(/COLLECTION invoked/);
  });

  it('FAILURE/UNKNOWN — an empty request yields an empty run (never fabricates results)', () => {
    const run = runDiscovery(req([]), sources(() => 'granted'));
    expect(run.results).toEqual([]);
  });
});

describe('L3 · Environment Discovery — invariant', () => {
  it('ZERO-RUNTIME-IMPORT — the module imports only TYPES (no value import into collection/execution)', () => {
    const src = readFileSync(join(__dirname, 'environmentDiscovery.ts'), 'utf8');
    const valueImports = src.match(/^import\s+(?!type\b)[^;]*from\s+'[^']*'/gm) ?? [];
    expect(valueImports).toEqual([]);
  });
});
