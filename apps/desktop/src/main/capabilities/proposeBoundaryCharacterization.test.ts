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
 *
 * ── THE BUILD BOUNDARY (recorded 20 Aug 2026, when P4-MIN flipped this pin) ──────────────
 *
 * **The preserved 20 Aug ceremony log was produced by a FIVE-emitter build.** P4-MIN added
 * the sixth (`capabilityProposeIpc`'s refusal warn), so the map below describes builds from
 * that change FORWARD.
 *
 *   - **HISTORICAL negatives — every silence argument about the 12:44–12:49Z window — stand
 *     under the OLD five-emitter map** and are NOT re-derived by this flip. They were correct
 *     for the build that produced the log.
 *   - **FORWARD negatives use the map below.** A propose refusal now emits, so from this build
 *     on, silence at the propose boundary means "no refusal occurred" — which it did NOT mean
 *     on 20 August.
 *
 * Confusing the two would attribute a property of the new build to the old log.
 * RUN A ≠ RUN B UNLESS THE EVIDENCE CHAIN ESTABLISHES THEIR RELATIONSHIP.
 *
 * COMMENT-BLINDNESS RETRO-CHECK (run before the flip, operator-ordered): the map was
 * re-derived with block and line comments stripped. Raw 5, code-only 5 — **UNCHANGED**. No
 * count was ever inflated by a comment, so every negative that rested on the map holds.
 *
 * ── LEVEL RE-DERIVATION (F-P35, 21 Aug 2026) ─────────────────────────────────────────────
 *
 * **INSTRUMENTED SILENCE IS EVIDENCE ONLY IF THE INSTRUMENT CAN REACH THE SINK.**
 *
 * F-P35 exposed an assumption this pin rested on without ever asserting it: it counted
 * emitters WITHOUT DISTINGUISHING THEIR LEVEL, and `logger.ts` gates the FILE SINK at
 * `>= info` UNCONDITIONALLY (`:156`), with the console threshold additionally raised to
 * `info` under NODE_ENV=production (`:73`). **An emitter at `debug` is not an emitter in the
 * ceremony build** — `runtimeTelemetry`'s `log.debug('backend probe failed', …)` is exactly
 * that, and it is why six days of probe failures left no trace.
 *
 * RE-DERIVED, and the answer is the good one: **all six propose-path emitters are `warn` or
 * `info`. ZERO sit at `debug`.** So every negative that rests on this map HOLDS — including
 * the load-bearing one, that a lane success emits `:166` at `info` and no second stash line
 * exists anywhere in the preserved 470-line log.
 *
 * The pin now asserts LEVEL, not merely presence, so a future emitter added at `debug` fails
 * here rather than silently converting an argument-from-silence into an argument-from-nothing.
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
    { file: ['capabilities', 'capabilityProposeIpc.ts'], emitters: 2 }, // P4-MIN refusal warn + the lane catch
    { file: ['liveBrain', 'brainProposeLane.ts'], emitters: 4 }, // :92 :109 :162 warn · :166 info
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

  it('the WHOLE propose path has exactly SIX emitters — the FORWARD map (five before P4-MIN)', () => {
    const total = EXPECTED.reduce((n, e) => n + count(read(...e.file)), 0);
    expect(total).toBe(6);
  });

  it('EVERY emitter is at a level the FILE SINK accepts — none at debug (F-P35)', () => {
    // logger.ts gates the file sink at >= info UNCONDITIONALLY, and raises the console
    // threshold to info under NODE_ENV=production. An emitter at `debug` therefore leaves no
    // trace in a ceremony build, and any negative resting on its silence would be void.
    const levels: string[] = [];
    for (const e of EXPECTED) {
      const src = read(...e.file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const m of src.matchAll(/log\.(info|warn|error|debug)\(/g)) levels.push(m[1]);
    }
    expect(levels).toHaveLength(6);
    expect(levels.filter((l) => l === 'debug')).toEqual([]);
    // The load-bearing one specifically: the lane's SUCCESS emitter must be sink-reachable,
    // because "no second stash line exists in the preserved log" depends on it entirely.
    const lane = read('liveBrain', 'brainProposeLane.ts');
    expect(lane).toMatch(/log\.info\(`Brain proposal stashed/);
  });

  it('the FILE SINK gate itself is still >= info — the premise of the test above', () => {
    const lg = read('logger.ts');
    expect(lg).toMatch(/fileSink && LEVEL_ORDER\[level\] >= LEVEL_ORDER\.info/);
  });
});

/**
 * P4-MIN — the refusal emitter. Admitted because A REFUSAL MUST BE OBSERVABLE OR IT IS NOT
 * AUDITABLE (F-P24), not because it makes investigation cheaper.
 *
 * REFUSAL OBSERVED ≠ GOVERNANCE CORRECTNESS ≠ EXECUTION ≠ EXTERNAL EFFECT ≠ VERIFICATION.
 * This emitter can establish that a refusal OCCURRED. It cannot establish that the refusal was
 * CORRECT, and it certainly cannot establish that the external world changed.
 */
describe('P4-MIN · the propose refusal is observable, and carries REASON ONLY', () => {
  const IPC = read('capabilities', 'capabilityProposeIpc.ts');
  const IPC_CODE = IPC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('a refusal emits, and the emitter precedes the early return', () => {
    const emit = IPC_CODE.indexOf('log.warn(`propose refused');
    const ret = IPC_CODE.indexOf('if (!response.ok || artifact === null) return response;');
    expect(emit).toBeGreaterThan(-1);
    expect(emit).toBeLessThan(ret);
  });

  it('REASON ONLY — `detail` is never interpolated into the emitted line', () => {
    const line = IPC_CODE.split('\n').find((l) => l.includes('propose refused')) ?? '';
    expect(line).toMatch(/\$\{response\.reason\}/);
    expect(line).not.toMatch(/detail/);
  });

  it('WHY reason-only: INVALID_PARAMS detail can carry a RECIPIENT ADDRESS', () => {
    // The two interpolations that made `detail` unloggable without a redaction design.
    const PROP = read('capabilities', 'm365ActionProposal.ts');
    expect(PROP).toMatch(/recipient must not contain a comma: \$\{addr\.slice\(0, 60\)\}/);
    expect(PROP).toMatch(/invalid recipient: \$\{addr\.slice\(0, 60\)\}/);
    // And the NP-013 redactor deliberately does NOT protect an email shape (round-31 W-7).
    expect(read('logger.ts')).toMatch(/12@example\.com/);
  });

  it('DECISION-NEUTRAL — the early-return condition is byte-unchanged', () => {
    expect(IPC_CODE).toContain('if (!response.ok || artifact === null) return response;');
  });
});
