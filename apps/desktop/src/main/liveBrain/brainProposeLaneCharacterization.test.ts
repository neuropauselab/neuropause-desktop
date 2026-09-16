/**
 * PIN B — CHARACTERIZATION. `brainProposeLane.ts:81` returns `null` on an unresolved
 * TENANT SCOPE **without emitting anything**.
 *
 * LABEL: **structural silent path.**
 *
 * EVIDENCE RUNG: SOURCE-PROVEN + TESTED (the real exported lane is driven; the silence
 * is asserted against the real source text, not a mocked logger's call count).
 *
 * DOCSTRING REQUIREMENT (operator ruling, 20 Aug 2026):
 *
 *   **THIS PATH IS *EXCLUDED* AS THE CEREMONY PATH FOR THE 20 AUG WINDOW.**
 *
 * The exclusion rests on a preserved-log negative, and on the completeness check that
 * makes that negative admissible:
 *   - `logs/app.log` (r3, sha256 237c73e1…ce36d4, 470 lines) contains exactly TWO
 *     tenant lines, both at cold start 12:08:37Z (`not_loaded`, RECOVERED after 5ms).
 *     There is no tenant refusal in the 12:44–12:49Z window.
 *   - Suppression cannot hide one: `enterprise/index.ts:416` only suppresses when
 *     `!firstRefusalAfterSuccess`, and a refusal following the 12:44:16Z success
 *     carries `firstRefusalAfterSuccess: true`.
 *   - Exactly ONE `createTenantContextResolver` exists (`enterprise/index.ts:392`) with
 *     `onRefusal` wired — no second, uninstrumented resolver whose refusals go unlogged.
 *
 * So a `:81` null WOULD have been visible upstream, and was not. INSTRUMENTED SILENCE
 * IS EVIDENCE; UNINSTRUMENTED SILENCE IS NOT — and this one is instrumented, one layer up.
 *
 * CHARACTERIZATION ≠ LOCALIZATION ≠ CAUSAL EXPLANATION. This pin does not fix the
 * ceremony and does not explain why the Brain produced nothing.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runBrainProposeLane } from './brainProposeLane';

const SRC = readFileSync(join(__dirname, 'brainProposeLane.ts'), 'utf8');

const mandate = {
  capabilityId: 'mail.send',
  accountId: 'acct_pin_b',
  to: ['operator@example.com'],
  subject: 'Pin B',
  body: 'Pin B',
  purpose: 'characterization',
} as const;

describe('PIN B · the unresolved-TENANT-SCOPE path is silent by construction', () => {
  it('an unresolved TENANT SCOPE yields null — the lane never reaches the S4 engine', async () => {
    const review = await runBrainProposeLane(mandate, {
      scope: () => null, // the :81 condition, driven through the real exported lane
      moduleStore: () => null,
      actions: async () => [],
      nowMs: () => Date.parse('2026-08-20T12:44:16.163Z'),
    });
    expect(review).toBeNull();
  });

  it('the :81 branch carries NO emitter — the silence is structural, not incidental', () => {
    const marker = 'if (scope === null) return null;';
    expect(SRC, 'the :81 guard must still be a single-line early return').toContain(marker);
    const line = SRC.split('\n').find((l) => l.includes(marker)) ?? '';
    expect(line).not.toMatch(/log\.(info|warn|error|debug)/);
  });

  it('the lane’s OTHER null paths DO emit — which is what makes B’s exclusion admissible', () => {
    // Each of these logs, so their absence from the preserved window is evidence.
    expect(SRC).toMatch(/log\.warn\([^\n]*tenant not provably single/);
    expect(SRC).toMatch(/log\.warn\([^\n]*S4 engine/);
    expect(SRC).toMatch(/log\.info\([^\n]*Brain proposal stashed/);
  });

  it('EXACTLY ONE success emitter exists — so "no second stash line" is instrumented silence', () => {
    expect((SRC.match(/log\.info\(/g) ?? []).length).toBe(1);
  });
});
