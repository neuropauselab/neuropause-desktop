/**
 * P13C ROUND 10 — PHASE 10. THE SEAM WAS BOUND TO THE WRONG THING.
 *
 * WHY THIS FILE EXISTS
 *
 * Round 9's most instructive finding was not a missing boundary. It was
 * `enterprise/index.ts:950`:
 *
 *     modules.registry.bindScope(() => tenantContext.scope());
 *
 * covering all 106 ERP, CRM, HR and finance module stores — the largest data
 * surface in the product — while every other store in the same file bound
 * `activeTenantScope`. The two differ in exactly one respect: `activeTenantScope`
 * routes through `resolveTenantScope`, which PREFERS a background principal;
 * `tenantContext.scope` reads the active workspace and knows nothing about
 * principals.
 *
 * The consequence was a cross-tenant WRITE, reachable two ways. The companion
 * gateway listens on the LAN and wraps every operation in `runAsPrincipal` for
 * the tenant the phone was PAIRED to, with a comment stating that this exists
 * precisely so a phone paired to A cannot act in B. The sandbox executor does
 * the same for scenarios. Neither principal reached these stores.
 *
 * THE POINT, WHICH IS BIGGER THAN THE BUG
 *
 * Every invariant this program had built asked *IS A BOUNDARY BOUND?* — and the
 * answer was yes. `assertEveryModuleScoped` passed. `assertAllTenantStoresBound`
 * passed. `storeScopeGate` passed. `scopeOrDeny()` fails closed on the ABSENCE
 * of a scope and never on the WRONG one, and a store handed a session resolver
 * answers it faithfully.
 *
 * None of them could ask WHAT THE SEAM IS ATTACHED TO. This file does.
 *
 * WHY A SOURCE SCAN
 *
 * The alternative is a runtime assertion, and a runtime assertion can only fire
 * for a binding that executes on the path somebody happened to exercise —
 * `initEnterprise` needs Electron and most of the app. The binding site is a
 * literal in the composition root, which is mechanical to read. Its limits are
 * stated at the bottom of this file rather than claimed away.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAIN = join(fileURLToPath(new URL('.', import.meta.url)), '..');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === 'node_modules' || name === 'e2e') continue;
      out.push(...sourceFiles(p));
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.bench.ts')) {
      out.push(p);
    }
  }
  return out;
}

/**
 * The resolvers that are NOT principal-aware, by name.
 *
 * `tenantContext.scope` / `tenantContext.resolve` read the active workspace
 * only. They are the correct answer for the tenant CONTEXT of a UI request and
 * the wrong answer for the tenant a STORE should serve, because a store is also
 * reached from background jobs.
 *
 * `activeTenantScope` is the principal-aware wrapper: `resolveTenantScope(() =>
 * tenantContext.scope())`. Binding it is always at least as correct as binding
 * the inner one, which is why the rule is one-directional and has no exceptions
 * list.
 */
const SESSION_ONLY = /tenantContext\s*\.\s*(?:scope|resolve)\b/;

/** Every `X.bindScope(<arg>)` call, with the argument text. */
function bindScopeArguments(src: string): string[] {
  return [...src.matchAll(/\.bindScope\(([\s\S]{0,160}?)\)\s*[;,)\n.]/g)].map((m) => m[1]!.trim());
}

describe('a declared tenant seam is bound to the PRINCIPAL-AWARE resolver', () => {
  /**
   * THE REGRESSION. This is the exact line, and it must never come back.
   */
  it('no bindScope anywhere in the main process receives a session-only resolver', () => {
    const offenders: string[] = [];
    for (const path of sourceFiles(MAIN)) {
      const src = readFileSync(path, 'utf8');
      if (!src.includes('.bindScope(')) continue;
      // P13C ROUND 17k — `/` on every platform. See storeScopeGate.test.ts.
      const rel = path.slice(MAIN.length + 1).replace(/\\/g, '/');
      for (const arg of bindScopeArguments(src)) {
        if (SESSION_ONLY.test(arg)) offenders.push(`${rel}  →  bindScope(${arg})`);
      }
    }

    expect(
      offenders.sort(),
      'These stores are bound to a resolver that IGNORES THE BACKGROUND PRINCIPAL. ' +
        'The seam exists, so every "is it bound?" invariant passes — and a companion device ' +
        'or sandbox scenario acting for tenant A will read and WRITE whichever tenant the ' +
        'desktop happens to be showing. Bind `activeTenantScope` instead: it is ' +
        '`resolveTenantScope(() => tenantContext.scope())`, so it is the same answer on the ' +
        'UI path and the correct one inside a job.',
    ).toEqual([]);
  });

  /**
   * The enterprise composition root is where the finding lived. Pin it by name
   * as well as by pattern: a rule that only matches a shape can be evaded by a
   * different shape, and this specific line is worth naming.
   */
  it('the 106 enterprise module stores bind activeTenantScope', () => {
    const src = readFileSync(join(MAIN, 'enterprise/index.ts'), 'utf8');
    expect(src).toContain('modules.registry.bindScope(activeTenantScope)');
    expect(
      /modules\.registry\.bindScope\(\s*\(\)\s*=>\s*tenantContext\.scope\(\)\s*\)/.test(src),
    ).toBe(false);
  });

  /**
   * The organization directory is the store that decides WHO EVERYONE IS, so a
   * wrong resolver there is the takeover surface. Pinned by name for the same
   * reason.
   */
  it('the organization directory binds activeTenantScope, before load', () => {
    const src = readFileSync(join(MAIN, 'enterprise/index.ts'), 'utf8');
    const bindAt = src.indexOf('orgStore.bindScope(activeTenantScope)');
    const loadAt = src.indexOf('await orgStore.load()');
    expect(bindAt, 'orgStore must bind the principal-aware resolver').toBeGreaterThan(-1);
    expect(loadAt).toBeGreaterThan(-1);
    expect(bindAt, 'bind before load — an unbound store must never be briefly reachable').
      toBeLessThan(loadAt);
  });

  /**
   * `activeTenantScope` must actually BE principal-aware. If someone
   * "simplified" it to return `tenantContext.scope()` directly, every assertion
   * above would still pass while the property they protect quietly disappeared.
   */
  it('activeTenantScope routes through resolveTenantScope', () => {
    const src = readFileSync(join(MAIN, 'enterprise/index.ts'), 'utf8');
    const fn = src.slice(src.indexOf('export function activeTenantScope'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toContain('resolveTenantScope');
  });
});

/**
 * WHAT THIS GATE CANNOT SEE, stated rather than claimed away.
 *
 * It reads the ARGUMENT TEXT at the binding site. It cannot follow a resolver
 * passed through a variable assigned elsewhere, one returned by a helper in
 * another file, or a store bound by a generic factory that takes the resolver as
 * a parameter. A determined refactor can move the mistake out of its view.
 *
 * That is why it is one of three overlapping mechanisms and not the only one:
 * `assertAllTenantStoresBound` catches a seam that was never bound,
 * `assertAllStoreScopesBound` catches a declared scope with no live boundary,
 * and this catches a boundary attached to the wrong authority. Each is blind to
 * what the others see. The round that declares any of them complete is the round
 * that gets the next finding.
 */
