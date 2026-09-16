/**
 * NP-018 — STALE as a first-class state assessment, EXTENDING the single
 * `Certainty` authority (operator ruling, 20 Aug 2026: no fork, no second
 * certainty system, anti-re-entry pattern).
 *
 * THE BINDING DISTINCTION these pins exist to preserve:
 *
 *   UNKNOWN — the system CANNOT ESTABLISH the current fact.
 *   STALE   — evidence EXISTS but is no longer sufficiently current for the
 *             required freshness condition.
 *
 * And the §2 #18 operational test, answered here with evidence: adding STALE
 * changes NO governance decision, because the Certainty vocabulary is
 * structurally outside the authority boundary and proposal expiry is enforced
 * by a SEPARATE mechanism that never reads it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assessFreshness } from './liveBrainState';

const read = (...p: string[]): string => readFileSync(join(__dirname, '..', ...p), 'utf8');
const NOW = Date.parse('2026-08-20T12:00:00.000Z');
const MINUTE = 60_000;

describe('NP-018 · the binding distinction — UNKNOWN is blindness, STALE is aged sight', () => {
  it('NO observation time is UNKNOWN, never STALE — we cannot say a fact aged if we cannot say when it was seen', () => {
    for (const observedAtMs of [null, undefined, Number.NaN]) {
      expect(assessFreshness({ observedAtMs, nowMs: NOW, maxAgeMs: MINUTE })).toBe('UNKNOWN');
    }
  });

  it('an observation OLDER than the requirement is STALE — evidence exists, it has simply aged past the condition', () => {
    expect(assessFreshness({ observedAtMs: NOW - 6 * MINUTE, nowMs: NOW, maxAgeMs: 5 * MINUTE })).toBe('STALE');
  });

  it('the two are never interchangeable for the same input', () => {
    const aged = assessFreshness({ observedAtMs: NOW - 99 * MINUTE, nowMs: NOW, maxAgeMs: MINUTE });
    const blind = assessFreshness({ observedAtMs: null, nowMs: NOW, maxAgeMs: MINUTE });
    expect(aged).toBe('STALE');
    expect(blind).toBe('UNKNOWN');
    expect(aged).not.toBe(blind);
  });
});

describe('NP-018 · window semantics — a requirement, never a default', () => {
  it('NO declared requirement ⇒ NEVER stale, however old the observation', () => {
    const ancient = { observedAtMs: Date.parse('2001-01-01T00:00:00.000Z'), nowMs: NOW };
    expect(assessFreshness({ ...ancient })).toBe('KNOWN');
    expect(assessFreshness({ ...ancient, maxAgeMs: null })).toBe('KNOWN');
    expect(assessFreshness({ ...ancient, maxAgeMs: undefined })).toBe('KNOWN');
  });

  it('no default window is invented anywhere in the assessor', () => {
    const src = read('liveBrain', 'liveBrainState.ts');
    const fn = src.slice(src.indexOf('export function assessFreshness'), src.indexOf('export function assessFreshness') + 900);
    // No magic number stands in for a caller's requirement.
    expect(fn).not.toMatch(/maxAgeMs\s*(\?\?|\|\|)\s*\d/);
    expect(fn).not.toMatch(/DEFAULT_MAX_AGE|60_000|300_000/);
  });

  it('the boundary is inclusive: at exactly the limit the requirement is still met', () => {
    expect(assessFreshness({ observedAtMs: NOW - 5 * MINUTE, nowMs: NOW, maxAgeMs: 5 * MINUTE })).toBe('KNOWN');
    expect(assessFreshness({ observedAtMs: NOW - 5 * MINUTE - 1, nowMs: NOW, maxAgeMs: 5 * MINUTE })).toBe('STALE');
  });

  it('the caller says what a FRESH fact would be — corroborated evidence stays VERIFIED when it is current', () => {
    expect(assessFreshness({ observedAtMs: NOW, nowMs: NOW, maxAgeMs: MINUTE, fresh: 'VERIFIED' })).toBe('VERIFIED');
    // …and ages to STALE like any other, rather than silently keeping its proof.
    expect(assessFreshness({ observedAtMs: NOW - 2 * MINUTE, nowMs: NOW, maxAgeMs: MINUTE, fresh: 'VERIFIED' })).toBe('STALE');
  });

  it('the assessor has no clock of its own — the same inputs always give the same answer', () => {
    const args = { observedAtMs: NOW - MINUTE, nowMs: NOW, maxAgeMs: 30_000 } as const;
    expect(assessFreshness(args)).toBe(assessFreshness(args));
    const src = read('liveBrain', 'liveBrainState.ts');
    const fn = src.slice(src.indexOf('export function assessFreshness'), src.indexOf('export function assessFreshness') + 900);
    expect(fn).not.toMatch(/Date\.now\(\)|new Date\(\)/);
  });
});

describe('NP-018 · ONE authority, extended — no fork, no second certainty system', () => {
  it('STALE lives on the single Certainty union; no parallel vocabulary was created', () => {
    const src = read('liveBrain', 'liveBrainState.ts');
    expect(src).toMatch(/export type Certainty =[^\n]*'STALE'/);
    // No second type, no enum, no shadow union anywhere in the brain substrate.
    for (const f of ['liveBrain/liveBrainState.ts', 'liveBrain/brainContext.ts', 'liveBrain/brainReasoning.ts']) {
      const s = read(...f.split('/'));
      expect(s, f).not.toMatch(/type\s+Freshness\s*=|type\s+Staleness\s*=|enum\s+Certainty/);
    }
  });

  it('ANTI-RE-ENTRY: the assessor is the ONLY producer of the string STALE in the substrate', () => {
    const src = read('liveBrain', 'liveBrainState.ts');
    const occurrences = (src.match(/'STALE'/g) ?? []).length;
    // The type declaration, the assessor's return, the rollup precedence check,
    // and the census key — and nowhere else inventing one.
    expect(occurrences).toBeLessThanOrEqual(4);
  });

  it('the uncertainty census counts all SIX values — the compiler enforces it', () => {
    const src = read('liveBrain', 'liveBrainState.ts');
    const census = src.slice(src.indexOf('const uncertainty: Record<Certainty, number>'), src.indexOf('const uncertainty: Record<Certainty, number>') + 220);
    for (const v of ['KNOWN', 'UNKNOWN', 'UNAVAILABLE', 'CONFLICTING', 'VERIFIED', 'STALE']) {
      expect(census, v).toContain(`${v}: 0`);
    }
  });

  it('rollup precedence places STALE below UNKNOWN and above KNOWN — worst-wins, and staleness is not blindness', () => {
    const src = read('liveBrain', 'liveBrainState.ts');
    const fn = src.slice(src.indexOf('function rollupCertainty'), src.indexOf('function rollupCertainty') + 600);
    const idx = (c: string): number => fn.indexOf(`has('${c}')`);
    expect(idx('CONFLICTING')).toBeLessThan(idx('UNAVAILABLE'));
    expect(idx('UNAVAILABLE')).toBeLessThan(idx('UNKNOWN'));
    expect(idx('UNKNOWN')).toBeLessThan(idx('STALE'));   // blindness dominates staleness
    expect(idx('STALE')).toBeLessThan(idx('VERIFIED'));  // staleness dominates a clean read
  });
});

describe('NP-018 · §2 #18 OPERATIONAL TEST — does the new value change any decision?', () => {
  it('ANSWER: NO — proposal expiry is enforced by a SEPARATE mechanism that never reads Certainty', () => {
    const proposal = read('liveBrain', 'proposal.ts');
    expect(proposal).toMatch(/freshnessWindowMs/);      // expiry is enforced HERE…
    expect(proposal).toMatch(/asOfMs/);                 // …from evidence timestamps…
    expect(proposal).not.toMatch(/\bCertainty\b/);      // …and never from the state vocabulary.
    expect(proposal).not.toMatch(/'STALE'/);
  });

  it('the execution boundary never reads a certainty value of any kind', () => {
    const boundary = read('liveBrain', 'proposalExecutionBoundary.ts');
    expect(boundary).not.toMatch(/\bCertainty\b|certainty/);
    expect(boundary).not.toMatch(/'STALE'|'UNKNOWN'/);
  });

  it('the Brain substrate keeps its zero-runtime-import property — STALE gained no path to governance', () => {
    const src = read('liveBrain', 'liveBrainState.ts');
    for (const line of src.match(/^import\s+(?!type\b)[^;]*from\s+'[^']*'/gm) ?? []) {
      expect(line).not.toMatch(/cst\/|governedSend|governedAction|executor|connectors\//);
    }
  });
});
