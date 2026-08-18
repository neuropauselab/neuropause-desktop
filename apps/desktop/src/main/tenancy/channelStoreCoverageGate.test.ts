/**
 * CHANNEL → STORE COVERAGE, MEASURED AND RATCHETED. P13C FINAL CERTIFICATION.
 *
 * THE NUMBER, STATED PLAINLY
 *
 * Five reports described channel→store coverage as "PARTIAL — 2 declarations",
 * which reads like a small remainder. Measured against its real denominator it
 * is **2 of 194 authority-gated channels: 1.0%**. The registry shipped in Round
 * 13 with zero production declarations and gained its first two in Round 17,
 * eleven months of channels later.
 *
 * WHY THIS IS A RATCHET AND NOT A COMPLETION
 *
 * The honest fix is 192 declarations, and each one must name the store its
 * handler ACTUALLY reaches. `channelResource.ts`'s own header explains why that
 * cannot be derived mechanically: handlers close over injected ports and reach
 * stores several frames deep, so "a regex would produce confident wrong answers,
 * which is worse than no answer." Generating 192 declarations from a scan would
 * manufacture exactly that — a registry that looks complete and asserts things
 * nobody checked. This programme's rule is that unverified evidence is not
 * evidence, and it applies to evidence produced in its own favour.
 *
 * So this gate does the part that CAN be done correctly:
 *
 *   1. It computes the denominator from the authority tables, so the number
 *      cannot drift away from the real surface.
 *   2. It fails when a NEW authority-gated channel is added while coverage is
 *      incomplete and the baseline is not updated — the forcing function the
 *      registry was always described as being, and never was.
 *   3. It fails when coverage goes DOWN, so a declaration cannot be quietly
 *      deleted.
 *
 * The baseline is a number a human must edit deliberately. That is the point:
 * moving it is a decision with a name on it, not a side effect.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAIN = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/**
 * THE DENOMINATOR, at the commit this gate was written.
 *
 * Every channel carrying an authority requirement in any gate table. Raise it
 * only alongside declarations; a bare increase means a sensitive channel was
 * added and nobody said what it reaches.
 */
const SENSITIVE_BASELINE = 196; // +1 FG-1 (Wave-2 Slice 10): capability:m365.propose gated (connectors:manage). Gated-but-UNDECLARED by design: an unhandled channel reaches no store, so a declaration would be fiction — declareChannelResource + DECLARED_BASELINE 3→4 land in Slice 11 with the handler.

/**
 * THE NUMERATOR. 2 as of P13C final certification — `ai:preference.get` and
 * `ai:preference.set`, added by D-5. This number may only go UP.
 */
const DECLARED_BASELINE = 4; // +1 FG-2 (Wave-2 Slice 11): capability:m365.propose declares its connector-accounts read (handler landed)

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === 'node_modules' || name === 'e2e') continue;
      sourceFiles(p, out);
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) {
      out.push(p);
    }
  }
  return out;
}

/** Channels carrying an authority requirement — the sensitive surface. */
function sensitiveChannels(): Set<string> {
  const found = new Set<string>();
  for (const path of sourceFiles(MAIN)) {
    if (!/AuthzGate\.ts$|runtimeAuthz\.ts$/.test(path)) continue;
    const src = readFileSync(path, 'utf8');
    for (const m of src.matchAll(/\[IpcChannel\.(\w+)\]\s*:/g)) found.add(m[1]!);
  }
  return found;
}

/** Channels that have told the registry which store they reach. */
function declaredChannels(): Set<string> {
  const found = new Set<string>();
  for (const path of sourceFiles(MAIN)) {
    const src = readFileSync(path, 'utf8');
    for (const m of src.matchAll(/declareChannelResource\(\{\s*channel:\s*IpcChannel\.(\w+)/g)) {
      found.add(m[1]!);
    }
  }
  return found;
}

describe('channel → store coverage', () => {
  it('reports the real coverage rather than a count of declarations', () => {
    const sensitive = sensitiveChannels();
    const declared = declaredChannels();
    const covered = [...declared].filter((c) => sensitive.has(c));
    const pct = (100 * covered.length) / sensitive.size;
    // eslint-disable-next-line no-console
    console.log(
      `[channel-store] ${covered.length}/${sensitive.size} authority-gated channels declared ` +
        `(${pct.toFixed(1)}%). ${sensitive.size - covered.length} UNDECLARED. ` +
        'A declaration names the store a handler reaches; without one, no rule in ' +
        'channelResource.ts can see that channel at all.',
    );
    expect(sensitive.size).toBeGreaterThan(0);
  });

  it('fails when a new authority-gated channel arrives without a declaration', () => {
    const sensitive = sensitiveChannels();
    expect(
      sensitive.size,
      `The authority-gated surface changed (${sensitive.size}, baseline ${SENSITIVE_BASELINE}). ` +
        'If channels were ADDED, declare what each one reaches with declareChannelResource() ' +
        'and raise DECLARED_BASELINE too. If they were removed, lower SENSITIVE_BASELINE. ' +
        'Coverage is 2/194 — a new undeclared channel makes a bad ratio worse silently, ' +
        'which is how it reached 1% in the first place.',
    ).toBe(SENSITIVE_BASELINE);
  });

  it('never goes backwards — a declaration cannot be quietly deleted', () => {
    const sensitive = sensitiveChannels();
    const covered = [...declaredChannels()].filter((c) => sensitive.has(c));
    expect(
      covered.length,
      'Channel→store coverage decreased. A declaration is the only thing that makes a ' +
        'channel visible to the correspondence rules; removing one removes the checking, ' +
        'not just the line.',
    ).toBeGreaterThanOrEqual(DECLARED_BASELINE);
  });

  it('every declaration names a channel that is actually authority-gated', () => {
    const sensitive = sensitiveChannels();
    const stray = [...declaredChannels()].filter((c) => !sensitive.has(c));
    expect(
      stray,
      'These channels declare a store but carry no authority requirement. Either they are ' +
        'public (and the declaration is describing an ungated reach — say so deliberately) ' +
        'or a gate entry was lost.',
    ).toEqual([]);
  });
});
