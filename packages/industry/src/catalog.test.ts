/**
 * IP-03 — the runtime-free catalog subpath exposes the real canonical data.
 */
import { describe, expect, it } from 'vitest';
import {
  INDUSTRY_MATRIX,
  INDUSTRY_VERSION,
  allIndustrySolutions,
  industryReadiness,
} from './catalog';

describe('industry catalog (runtime-free subpath)', () => {
  it('exposes the built-in vertical solution packs', () => {
    const list = allIndustrySolutions();
    expect(list.length).toBeGreaterThanOrEqual(20);
    expect(list.every((s) => s.key.length > 0 && s.name.length > 0)).toBe(true);
    // keys are unique
    expect(new Set(list.map((s) => s.key)).size).toBe(list.length);
  });

  it('exposes a non-empty capability matrix and a consistent readiness rollup', () => {
    expect(INDUSTRY_MATRIX.length).toBeGreaterThan(0);
    const r = industryReadiness();
    expect(r.total).toBe(INDUSTRY_MATRIX.length);
    expect(r.liveVerified + r.adapterVerified + r.businessDataPending + r.regulatedExternal).toBe(
      r.total,
    );
    expect(r.liveVerified).toBeGreaterThan(0);
  });

  it('reports a catalog version', () => {
    expect(typeof INDUSTRY_VERSION).toBe('string');
    expect(INDUSTRY_VERSION.length).toBeGreaterThan(0);
  });
});
