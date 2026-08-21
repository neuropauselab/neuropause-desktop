/**
 * F-P39 — THE CLOSURE PIN. This is the negative that had to flip.
 *
 * F-P39's statement was an IMPORT-GRAPH FACT: `verifyGovernedSend`'s only non-test importers were two
 * `__NP_E2E__`-gated modules that `verify-e2e-strip.sh` removes from `out/`. So the assertion that closes it is
 * an import-graph assertion, and it is written so that DELETING THE RECONCILER MAKES IT FAIL — the mutation
 * requirement. Before this slice these tests were red; a future change that orphans the reconciler turns them
 * red again, which is the point.
 *
 * WHY SOURCE-TEXT PINS ARE LEGITIMATE HERE, unlike the ones ruling D relabelled: these read PRODUCTION files
 * (`reconciliation/`, `services/serviceManager.ts`) which SHIP. The false-green defect was reading a
 * COMPILE-STRIPPED file while claiming a production property. Reading a shipped file to assert a property of the
 * shipped build is the honest form of the same technique — and the runtime pins in
 * `readBackReconciler.test.ts` carry the behavioural weight regardless.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MAIN = join(__dirname, '..');
const read = (rel: string): string => readFileSync(join(MAIN, rel), 'utf8');
/** Strip comments — a claim satisfied by prose is not satisfied. */
const code = (rel: string): string => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('F-P39 · the read-back has a PRODUCTION caller', () => {
  it('verifyGovernedSend is imported by a file that is neither a test nor compile-stripped', () => {
    const importers: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(join(MAIN, dir), { withFileTypes: true })) {
        const rel = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules') continue;
          walk(rel);
          continue;
        }
        if (!entry.name.endsWith('.ts')) continue;
        if (entry.name.includes('.test.')) continue;
        if (rel.startsWith('e2e/')) continue; // compile-stripped — never counted as production
        if (rel.startsWith('verification/')) continue; // the module itself
        if (code(rel).includes('verifyGovernedSend')) importers.push(rel);
      }
    };
    walk('.');

    // THE ASSERTION F-P39 EXISTS FOR.
    expect(importers.length).toBeGreaterThan(0);
    expect(importers).toContain(join('reconciliation', 'readBackReconciler.ts'));
  });

  it('the reconciler is REACHABLE — registered in the service list that runtimeCore already starts', () => {
    const sm = code(join('services', 'serviceManager.ts'));
    expect(sm).toContain('readBackReconciler');
    // Registered in the list, not merely imported. An import with no registration is an orphan (§4).
    const list = sm.slice(sm.indexOf('this.services = ['), sm.indexOf('];', sm.indexOf('this.services = [')));
    expect(list).toContain('readBackReconciler');
  });

  it('a DECLARED capability is not a REACHABLE one — the boot call it relies on genuinely exists', () => {
    // F-N17-4's principle applied to our own wiring: the chain is only real if the far end is called.
    expect(code('runtimeCore.ts')).toContain('serviceManager.startAll');
  });

  it('ZERO FROZEN SURFACES — the reconciler adds no line to any frozen file', () => {
    // runtimeCore.ts is frozen. It must name the SERVICE MANAGER (pre-existing) and NOT the reconciler.
    expect(code('runtimeCore.ts')).not.toContain('readBackReconciler');
    expect(code(join('connectors', 'index.ts'))).not.toContain('readBackReconciler');
    expect(code(join('enterprise', 'index.ts'))).not.toContain('readBackReconciler');
  });

  it('the reconciler cannot execute — no import path into the executor or the CST kernel', () => {
    const src = code(join('reconciliation', 'readBackReconciler.ts'));
    const valueImports = src.match(/^import\s+(?!type\b)[^;]*from\s+'[^']*'/gm) ?? [];
    for (const line of valueImports) {
      expect(line).not.toMatch(/cst\/|executor|governedSend'|governedAction|connectors\/index/);
    }
  });
});
