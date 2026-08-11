/**
 * THE GATE THAT MAKES OMISSION FAIL.
 *
 * WHAT THIS REPLACES
 *
 * `tenantStoreRegistry.test.ts` scans for files that DEFINE a seam (`bindScope`,
 * `bindWorkspace`) and demands they register. That catches a store whose boundary
 * is wrong. It cannot catch a store that has no boundary at all — and Round 7's
 * red team found seven of those, holding cloud account ids, assistant-written
 * record titles, and regulated recall evidence. The registry reported full
 * coverage the whole time, because it enumerates stores that OPTED IN.
 *
 * THE INVERSION
 *
 * This test does not look for seams. It looks for PERSISTENCE — a file that writes
 * state to disk or to the keychain — which is mechanical, hard to hide, and the
 * precise property that makes a store worth classifying. Every such file must
 * declare a scope from the closed set in `storeScope.ts`.
 *
 * A developer who writes:
 *
 *     class SomeStore {
 *       private rows: Row[] = [];
 *       private async persist() { await fs.writeFile(this.path, JSON.stringify(this.rows)); }
 *     }
 *
 * and forgets to declare a scope does not get a green build. That is the whole
 * requirement, and it is why the check is a source scan rather than a runtime
 * assertion: a runtime assertion only fires for stores that were constructed on
 * the path somebody happened to exercise.
 *
 * WHY AN ALLOW-LIST STILL EXISTS
 *
 * Some files write to disk and are genuinely not stores — a log writer, a
 * migration report, an artifact sink. Each is listed BY NAME with the reason,
 * because "this one is fine" has to be a claim with an address rather than a
 * silence. That list is itself reviewed: an entry that stops being true is a
 * finding, and the list is short enough to read.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { storeScopeDeclarations } from './storeScope';

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
 * Does this file WRITE STATE THAT SURVIVES A RESTART?
 *
 * Deliberately broad on the write and narrow on the exclusions. A false positive
 * costs one line in the allow-list with a reason; a false negative is a store
 * nobody classified, which is what this exists to prevent. The asymmetry is the
 * design.
 */
function persistsState(src: string): boolean {
  const writes =
    /fs\.writeFile\(/.test(src) ||
    /writeFileSync\(/.test(src) ||
    /fs\.appendFile\(/.test(src) ||
    /\.setPassword\(/.test(src) || // keytar / keychain
    /safeStorage\.encryptString\(/.test(src);
  if (!writes) return false;
  // A file that only writes what it was handed, with no retained collection, is a
  // sink rather than a store. Require some retained state as well.
  const holdsState =
    /private\s+(?:readonly\s+)?\w+\s*[:=]\s*(?:new\s+Map|new\s+Set|\[\]|\{\})/.test(src) ||
    /private\s+\w+\s*:\s*\w+\[\]\s*=/.test(src) ||
    /private\s+\w+\s*=\s*new\s+(?:Map|Set)/.test(src);
  return holdsState;
}

/**
 * Files that persist but are not stores. Each entry is a claim with a reason.
 *
 * IT IS EMPTY, AND THAT IS THE STRONGEST AVAILABLE STATEMENT: every file in the
 * main process that writes state AND retains a collection is classified. The
 * mechanism exists for the day one genuinely is not a store — a log writer, an
 * artifact sink — and until then the honest value is nothing.
 *
 * The detector requires BOTH a write and a retained collection, which is why the
 * obvious candidates (`storeEnvelope`, `auditChain`, `logger`) never reach here:
 * they write what they are handed and keep no rows.
 */
const NOT_A_STORE: Record<string, string> = {};

/** A declaration lives in the file if it calls any of the declaring APIs. */
function declaresScope(src: string): boolean {
  return (
    /declareStoreScope\(/.test(src) ||
    /registerTenantStore\(/.test(src) ||
    /declareSystemGlobalStore\(/.test(src) ||
    /new TenantOwnership\(/.test(src)
  );
}

describe('every persistent store declares a scope', () => {
  /**
   * THE GATE. A persistent store with no declaration fails the build.
   *
   * The failure message names the files and states the six legal answers, because
   * a gate whose output is "something is wrong" gets suppressed and a gate whose
   * output is "here is the decision you owe" gets answered.
   */
  it('a file that persists state either declares a scope or is listed as not-a-store', () => {
    const undeclared: string[] = [];
    for (const path of sourceFiles(MAIN)) {
      const rel = path.slice(MAIN.length + 1);
      if (NOT_A_STORE[rel] !== undefined) continue;
      const src = readFileSync(path, 'utf8');
      if (!persistsState(src)) continue;
      if (!declaresScope(src)) undeclared.push(rel);
    }

    expect(
      undeclared.sort(),
      'These files persist state and declare no scope. Add declareStoreScope({...}) — ' +
        'TENANT / WORKSPACE / USER / INSTALL_GLOBAL / PLATFORM_GLOBAL / EPHEMERAL — ' +
        'or add the file to NOT_A_STORE with the reason it is not one. ' +
        'UNKNOWN is not an option.',
    ).toEqual([]);
  });

  /**
   * The allow-list must not rot into a bypass. Every entry has to name a file that
   * still exists and still persists — otherwise it is a stale exemption somebody
   * would eventually reuse for a real store.
   */
  it('every NOT_A_STORE entry still names a real, still-persisting file', () => {
    const stale: string[] = [];
    for (const rel of Object.keys(NOT_A_STORE)) {
      try {
        const src = readFileSync(join(MAIN, rel), 'utf8');
        if (!persistsState(src)) stale.push(`${rel} (no longer persists)`);
      } catch {
        stale.push(`${rel} (missing)`);
      }
    }
    expect(stale.sort()).toEqual([]);
  });

  it('the exemption list is short enough that a reviewer reads it', () => {
    // Not arbitrary: a list nobody reads is a list anybody can add to.
    expect(Object.keys(NOT_A_STORE).length).toBeLessThanOrEqual(12);
  });
});

describe('the declarations themselves', () => {
  /**
   * Importing the composition root would drag Electron in, so this suite asserts
   * the RULES rather than the live registry — the rules are enforced by
   * `declareStoreScope` at construction, and these prove the enforcement is real
   * rather than commented.
   */
  it('customer-derived data cannot be declared global', async () => {
    const { declareStoreScope, __resetStoreScopeRegistryForTests } = await import('./storeScope');
    __resetStoreScopeRegistryForTests();
    expect(() =>
      declareStoreScope({
        name: 'bad-1',
        scope: 'INSTALL_GLOBAL',
        persistence: 'file',
        authority: 'ORG_ROLE',
        classification: 'CUSTOMER_DERIVED',
        retention: 'none',
        reason: 'it seemed easier',
      }),
    ).toThrow(/cannot be INSTALL_GLOBAL/);
    expect(() =>
      declareStoreScope({
        name: 'bad-2',
        scope: 'PLATFORM_GLOBAL',
        persistence: 'file',
        authority: 'PLATFORM_OPERATOR',
        classification: 'CUSTOMER_DERIVED',
        retention: 'none',
        reason: 'still easier',
      }),
    ).toThrow(/cannot be PLATFORM_GLOBAL/);
  });

  it('a platform-global store cannot be gated on an organization role', async () => {
    const { declareStoreScope, __resetStoreScopeRegistryForTests } = await import('./storeScope');
    __resetStoreScopeRegistryForTests();
    // The Round 7 finding class, as a type error at construction: the AI
    // destination, plugin capability grants and rate policies were all
    // install-wide resources behind `org:manage`.
    expect(() =>
      declareStoreScope({
        name: 'bad-3',
        scope: 'PLATFORM_GLOBAL',
        persistence: 'file',
        authority: 'ORG_ROLE',
        classification: 'INSTALL_METADATA',
        retention: 'none',
        reason: 'an org admin can surely handle it',
      }),
    ).toThrow(/authority must be PLATFORM_OPERATOR/);
  });

  /**
   * P13C ROUND 9 — F19. The combination Round 8 left legal.
   *
   * `worker-registry` shipped as INSTALL_GLOBAL + ORG_ROLE and named the cost in
   * its own reason string: "a workforce:manage holder can uninstall a package
   * other tenants use." That is the Round 7 finding class, declared and
   * permitted. The rule below is generic — no store name appears in it — so a
   * future store cannot reintroduce the class by declaring it.
   */
  it('an install-global store cannot be gated on an organization role either', async () => {
    const { declareStoreScope, __resetStoreScopeRegistryForTests } = await import('./storeScope');
    __resetStoreScopeRegistryForTests();
    expect(() =>
      declareStoreScope({
        name: 'bad-4',
        scope: 'INSTALL_GLOBAL',
        persistence: 'file',
        authority: 'ORG_ROLE',
        classification: 'INSTALL_METADATA',
        retention: 'uninstall removes the package for every tenant',
        reason: 'an org admin can surely handle it',
      }),
    ).toThrow(/cannot be mutated on an organization role/);
    __resetStoreScopeRegistryForTests();
  });

  it('install-global remains legal under platform, system and user authority', async () => {
    const { declareStoreScope, __resetStoreScopeRegistryForTests } = await import('./storeScope');
    __resetStoreScopeRegistryForTests();
    // The rule must not be "install-global is banned" — that would push stores
    // into declaring a tenant scope they do not have, which is worse.
    for (const authority of ['PLATFORM_OPERATOR', 'SYSTEM', 'USER'] as const) {
      expect(() =>
        declareStoreScope({
          name: `ok-${authority}`,
          scope: 'INSTALL_GLOBAL',
          persistence: 'file',
          authority,
          classification: 'INSTALL_METADATA',
          retention: 'unbounded; rows describe the machine',
          reason: 'one shared runtime on one machine',
        }),
      ).not.toThrow();
    }
    __resetStoreScopeRegistryForTests();
  });

  it('a reason and a retention policy are both mandatory', async () => {
    const { declareStoreScope, __resetStoreScopeRegistryForTests } = await import('./storeScope');
    __resetStoreScopeRegistryForTests();
    const base = {
      name: 'bad-4',
      scope: 'TENANT' as const,
      persistence: 'file' as const,
      authority: 'ORG_ROLE' as const,
      classification: 'CUSTOMER_DERIVED' as const,
    };
    expect(() => declareStoreScope({ ...base, retention: 'capped per tenant', reason: '  ' })).toThrow(/must say WHY/);
    expect(() => declareStoreScope({ ...base, retention: '', reason: 'because' })).toThrow(/retention/);
  });

  it('EPHEMERAL cannot persist', async () => {
    const { declareStoreScope, __resetStoreScopeRegistryForTests } = await import('./storeScope');
    __resetStoreScopeRegistryForTests();
    expect(() =>
      declareStoreScope({
        name: 'bad-5',
        scope: 'EPHEMERAL',
        persistence: 'file',
        authority: 'SYSTEM',
        classification: 'INSTALL_METADATA',
        retention: 'process lifetime',
        reason: 'in memory only',
      }),
    ).toThrow(/EPHEMERAL but persists/);
  });

  it('the startup gate refuses a seamed store that is not bound', async () => {
    const { declareStoreScope, assertAllStoreScopesBound, __resetStoreScopeRegistryForTests } =
      await import('./storeScope');
    __resetStoreScopeRegistryForTests();
    let bound = false;
    declareStoreScope({
      name: 'seamed',
      scope: 'TENANT',
      persistence: 'file',
      authority: 'ORG_ROLE',
      classification: 'CUSTOMER_DERIVED',
      retention: 'per-tenant cap',
      reason: 'customer records',
      isBound: () => bound,
    });
    expect(() => assertAllStoreScopesBound()).toThrow(/have no boundary bound/);
    bound = true;
    expect(() => assertAllStoreScopesBound()).not.toThrow();
    __resetStoreScopeRegistryForTests();
  });

  it('a declaration is recorded and reportable', async () => {
    const { declareStoreScope, storeScopeDeclarations, storeScopeCoverage, __resetStoreScopeRegistryForTests } =
      await import('./storeScope');
    __resetStoreScopeRegistryForTests();
    declareStoreScope({
      name: 'good',
      scope: 'INSTALL_GLOBAL',
      persistence: 'file',
      // P13C ROUND 9 — was ORG_ROLE, which F19 made illegal. The fixture is
      // corrected rather than the rule relaxed: an install-wide resource is not
      // one organization's to mutate.
      authority: 'PLATFORM_OPERATOR',
      classification: 'INSTALL_METADATA',
      retention: 'unbounded; rows describe the machine',
      reason: 'one shared runtime',
    });
    expect(storeScopeDeclarations().map((d) => d.name)).toEqual(['good']);
    expect(storeScopeCoverage().INSTALL_GLOBAL).toBe(1);
    __resetStoreScopeRegistryForTests();
  });
});

/** Keeps the import used when the suite above is filtered down. */
void storeScopeDeclarations;
