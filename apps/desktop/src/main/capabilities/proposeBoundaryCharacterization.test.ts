/**
 * PIN C and PIN D — CHARACTERIZATION of the propose boundary.
 *
 * ── PIN C ────────────────────────────────────────────────────────────────────────
 * `artifact === null` is **not an independent path**: it is exactly `!response.ok`.
 * The boundary therefore has no separate null-artifact case, and `capabilityProposeCore`
 * emits nothing at all.
 *
 * LABEL: the boundary's silence, characterized in the PRESENT TENSE.
 * EVIDENCE RUNG: SOURCE-PROVEN + TESTED (the real exported core is driven).
 *
 * DOCSTRING REQUIREMENTS (operator ruling, 20 Aug 2026):
 *   - This pin **characterizes a boundary's silence**.
 *   - It does **NOT** fix the ceremony.
 *   - It does **NOT** explain why the Brain produced nothing.
 *   - The originally-specified state — `response.ok === true` AND `artifact === null` —
 *     is **UNREACHABLE in current source**, which is why the pin was re-specified. Pinning
 *     it would have produced a test that can never fail: vacuous-green, the defect class
 *     the programme already names at RULE-008.
 *
 * WHEN THE P1 REPAIR LANDS this pin is UPDATED IN-BRACKET and the flip is the acceptance
 * test (the executionGate precedent).
 *
 * ── PIN D ────────────────────────────────────────────────────────────────────────
 * The EMITTER MAP of the propose path, pinned as data.
 *
 * LABEL: **epistemic pin.** EVERY negative conclusion in the P1 investigation depends on
 * this map. INSTRUMENTED SILENCE IS EVIDENCE; UNINSTRUMENTED SILENCE IS NOT — so if an
 * emitter is ADDED OR REMOVED, every argument that rests on silence must be RE-DERIVED,
 * and this pin failing is the signal to do it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runProposeM365ActionWithArtifact } from './capabilityProposeCore';

const read = (...p: string[]): string => readFileSync(join(__dirname, '..', ...p), 'utf8');
const CORE = read('capabilities', 'capabilityProposeCore.ts');

const EMITTER_RE = /log\.(info|warn|error|debug)\(/g;
const count = (src: string): number => (src.match(EMITTER_RE) ?? []).length;

describe('PIN C · artifact-null is not an independent path — it is exactly !response.ok', () => {
  it('a refusal returns BOTH together: response.ok false AND artifact null', () => {
    const { response, artifact } = runProposeM365ActionWithArtifact(
      {
        resolveSelection: () => ({ kind: 'GOVERNANCE_NOT_PROVEN' }) as never,
        subjectId: () => null, // NOT_AUTHENTICATED → PRINCIPAL_UNRESOLVED
        scope: () => ({ tenantId: 't', workspaceId: 'w' }),
      },
      { capabilityId: 'mail.send', accountId: 'acct', purpose: 'characterization', params: {} } as never,
    );
    expect(response.ok).toBe(false);
    expect(artifact).toBeNull();
  });

  it('SOURCE: there is exactly ONE artifact:null return and it sits on the !built.ok line', () => {
    const nulls = CORE.split('\n').filter((l) => /artifact:\s*null/.test(l));
    expect(nulls).toHaveLength(1);
    expect(nulls[0]).toMatch(/!built\.ok/);
  });

  it('SOURCE: the ok branch always carries the artifact — so ok-and-null is unreachable', () => {
    expect(CORE).toMatch(/artifact:\s*built\.proposal/);
    // No third return shape can introduce an ok-and-null combination.
    expect((CORE.match(/artifact:/g) ?? []).length).toBe(3); // type sig + null branch + ok branch
  });

  it('the core emits NOTHING — a refusal here reaches no log sink', () => {
    expect(count(CORE)).toBe(0);
  });
});

describe('PIN D · the propose path emitter map — every silence argument depends on this', () => {
  const EXPECTED: ReadonlyArray<{ file: readonly string[]; emitters: number }> = [
    { file: ['capabilities', 'capabilityProposeIpc.ts'], emitters: 1 }, // the catch at :79 only
    { file: ['liveBrain', 'brainProposeLane.ts'], emitters: 4 }, // :92 :109 :162 :166
    { file: ['capabilities', 'capabilityProposeCore.ts'], emitters: 0 },
    { file: ['liveBrain', 'proposal.ts'], emitters: 0 },
    { file: ['liveBrain', 'liveBrainState.ts'], emitters: 0 },
    // NOTE: `capabilityGraph` lives at src/main/capabilityGraph/, NOT under liveBrain/.
    // The first draft of this pin used the wrong path and the pin FAILED LOUDLY on ENOENT —
    // whereas the `grep -c` that produced the original emitter map returned "0" for the same
    // wrong path, silently. That is the difference between reading a file and searching for
    // one, and it is why this pin reads.
    { file: ['capabilityGraph', 'capabilityGraph.ts'], emitters: 0 },
  ];

  for (const e of EXPECTED) {
    it(`${e.file.join('/')} has exactly ${e.emitters} emitter(s)`, () => {
      expect(count(read(...e.file))).toBe(e.emitters);
    });
  }

  it('the WHOLE propose path has exactly FIVE emitters — the number the P1 negatives rest on', () => {
    const total = EXPECTED.reduce((n, e) => n + count(read(...e.file)), 0);
    expect(total).toBe(5);
  });
});
