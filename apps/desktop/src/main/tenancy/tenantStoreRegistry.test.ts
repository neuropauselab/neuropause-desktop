/**
 * PROGRAM 13C ROUND 3 — PHASE 4. THE REGISTRY, AND THE TEST THAT KEEPS IT HONEST.
 *
 * `assertAllTenantStoresBound()` converts "an unscoped store" from something an
 * audit finds into something that cannot boot. It only does that for stores it
 * KNOWS ABOUT, and until this round it knew about five while eighteen classes
 * implemented a tenant seam. The gate's own doc-comment implied it covered the
 * class of defect; it covered a fifth of it.
 *
 * So there are two different tests here and they fail for different reasons:
 *
 *   RUNTIME  — construct the real stores, assert the gate accepts a bound set
 *              and REFUSES an unbound one. Proves the mechanism works.
 *
 *   SOURCE   — read the source tree, find every class that defines `bindScope`,
 *              and assert each one's file also registers. Proves the mechanism
 *              is APPLIED. This is the half that catches the store somebody adds
 *              next year, because it does not depend on that store ever being
 *              constructed in a test.
 *
 * The source scan is the more valuable of the two and also the more fragile: it
 * greps. That is a deliberate trade. A grep that occasionally needs its
 * allow-list updated is a conversation; a registry that silently covers a fifth
 * of the surface is five more sweeps.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertAllTenantStoresBound,
  declareSystemGlobalStore,
  registerTenantStore,
  resetTenantStoreRegistryForTests,
  tenantStoreCoverage,
  tenantStoreRegistrations,
} from './tenantOwnedStore';

/* ── The mechanism ──────────────────────────────────────────────────────── */

describe('the registration mechanism', () => {
  beforeEach(() => resetTenantStoreRegistryForTests());
  afterEach(() => resetTenantStoreRegistryForTests());

  it('a registered store with no boundary FAILS the gate, by name', () => {
    let bound = false;
    registerTenantStore('example-store', () => bound);
    expect(() => assertAllTenantStoresBound()).toThrow(/example-store/);
    bound = true;
    expect(() => assertAllTenantStoresBound()).not.toThrow();
  });

  /**
   * The predicate is a function precisely so this works: binding happens at a
   * composition root long after construction, and capturing a boolean at
   * registration time would record every store as permanently unbound.
   */
  it('binding is observed LATE — the predicate is re-evaluated, not captured', () => {
    const store = { scope: null as unknown };
    registerTenantStore('late-bound', () => store.scope !== null);
    expect(() => assertAllTenantStoresBound()).toThrow();
    store.scope = () => null;
    expect(() => assertAllTenantStoresBound()).not.toThrow();
  });

  it('a system-global store is exempt, and its REASON is recorded', () => {
    declareSystemGlobalStore('app-config', 'Holds the AI provider URL. No customer records.');
    expect(() => assertAllTenantStoresBound()).not.toThrow();
    const entry = tenantStoreRegistrations().find((r) => r.name === 'app-config');
    expect(entry?.classification).toBe('system-global');
    expect(entry?.reason).toMatch(/No customer records/);
  });

  it('a system-global store cannot be declared without a reason', () => {
    expect(() => declareSystemGlobalStore('sneaky', '   ')).toThrow(/must state its reason/);
  });

  it('coverage counts are reported, not asserted by hand', () => {
    registerTenantStore('a', () => true);
    registerTenantStore('b', () => false);
    declareSystemGlobalStore('c', 'reason');
    expect(tenantStoreCoverage()).toEqual({
      registered: 3,
      tenantScoped: 2,
      bound: 1,
      unbound: 1,
      systemGlobal: 1,
    });
  });
});

/* ── The coverage scan ──────────────────────────────────────────────────── */

const MAIN = join(__dirname, '..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== 'node_modules') sourceFiles(p, out);
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) {
      out.push(p);
    }
  }
  return out;
}

/**
 * Files that DEFINE a tenant seam. A definition is `bindScope(source...)` with a
 * body — as opposed to `x.bindScope(y)`, which is a call.
 *
 * P13C ROUND 6 — `bindWorkspace` COUNTS TOO.
 *
 * The scan matched only the name `bindScope`, so the ENTIRE CONNECTOR SUBSYSTEM
 * was invisible to it: `connectorStore`, `connectorService` and
 * `connectorControlStore` all name their seam `bindWorkspace`, hold no
 * `TenantOwnership`, and were therefore neither registered nor listed. Meanwhile
 * `tenantOwnedStore.ts` told readers that a store which is never bound "cannot
 * reach a user: the application refuses to start" — a claim that was false for
 * three stores holding credential-adjacent state.
 *
 * A gate that recognises boundaries by NAMING CONVENTION only sees the ones that
 * followed the convention. Matching both names is the smallest change that makes
 * the gate's own claim true; the deeper fix is that a seam is declared, not
 * detected, and the registry is what does that.
 */
function filesDefiningBindScope(): string[] {
  return sourceFiles(MAIN).filter((p) => {
    const src = readFileSync(p, 'utf8');
    return /^\s{2}(?:protected |private |public )?bind(?:Scope|Workspace)\(/m.test(src);
  });
}

/**
 * Seams that are reached ONLY through a base class or a wrapper, so the file
 * defining them legitimately holds no registration of its own.
 *
 * Each entry names where the registration actually lives. That is the whole
 * point of writing them down: "this one is fine" becomes a claim with an
 * address rather than an omission.
 */
const REGISTERED_ELSEWHERE: Record<string, string> = {
  // P13C Round 6 — the connector subsystem. Its seam is `bindWorkspace`, bound at
  // `connectors/index.ts:129-132`, and its boundary is the WORKSPACE (a connected
  // account belongs to one workspace) rather than the organization. Registered
  // here with the address rather than converted, because giving these three a
  // `TenantOwnership` would give them a second, organization-shaped notion of
  // ownership alongside the workspace one they already enforce — two boundaries
  // in one store is how the seams this program removed came to disagree.
  'connectors/connectorStore.ts': 'bindWorkspace, bound at connectors/index.ts:130. Workspace-scoped; `get`/`all` filter on it.',
  'connectors/connectorService.ts': 'bindWorkspace, bound at connectors/index.ts:129. Delegates every read to connectorStore.',
  'connectors/connectorControlStore.ts': 'bindWorkspace, bound at connectors/index.ts:132. `disabled` is per workspace as of Round 6.',

  'tenancy/tenantOwnedStore.ts': 'TenantOwnership registers itself in its constructor.',
  'tenancy/tenantMemo.ts': 'Holds a TenantOwnership, which registers.',
  'enterprise/automationStore.ts': 'Holds a TenantOwnership.',
  'enterprise/decisionStore.ts': 'Holds a TenantOwnership.',
  'dataPlane/relationshipStore.ts': 'Holds a TenantOwnership.',
  'workforce/runtime/jobStore.ts': 'Holds a TenantOwnership.',
  'workforce/governance/auditLog.ts': 'Holds a TenantOwnership.',
  'enterprise/framework/enterpriseRecordStore.ts':
    'All 106 instances are covered by the single `enterprise-module-stores` entry in moduleRegistry.ts.',
  'enterprise/framework/moduleRegistry.ts': 'Registers the module-stores entry itself.',
  // The twelve concrete PersistentStore / AppendOnlyJsonStore subclasses do not
  // appear here: they INHERIT bindScope rather than defining it, so the scan does
  // not see them, and their two abstract bases both register. That is the point of
  // putting the registration on the base — twelve stores covered by two lines, and
  // a thirteenth covered before it is written.
  'ecosystem/developer/developerStore.ts': 'Holds a TenantOwnership.',
  'ecosystem/billing/billingStore.ts': 'Holds a TenantOwnership.',
  'ecosystem/gateway/gatewayStore.ts': 'Holds a TenantOwnership.',
  // Federation uses a RELATIONSHIP boundary rather than single-owner
  // `TenantOwnership`, because its records name two organizations. The wrapper
  // holds a TenantOwnership internally, so both stores register through it.
  'federation/runtime/fedStore.ts': 'Holds a FederationBoundary, which holds a TenantOwnership.',
  'federation/exchange/exchangeStore.ts': 'Holds a FederationBoundary.',
  'federation/governance/globalGovStore.ts': 'Holds a FederationBoundary.',
};

describe('every tenant seam in the source tree is declared to the gate', () => {
  /**
   * THE TEST THAT CATCHES THE NEXT STORE.
   *
   * A new class with a `bindScope` and no registration fails here — before it
   * ships, without anybody running a sweep, and with a message that says what
   * to add. That is the difference between this program's findings being found
   * by audit and being impossible to introduce.
   */
  it('a file defining bindScope either registers, or says where its registration lives', () => {
    const undeclared: string[] = [];
    for (const file of filesDefiningBindScope()) {
      const rel = file.slice(MAIN.length + 1).replace(/\\/g, '/');
      const src = readFileSync(file, 'utf8');
      const registersHere =
        src.includes('registerTenantStore(') || src.includes('new TenantOwnership(');
      if (!registersHere && !(rel in REGISTERED_ELSEWHERE)) undeclared.push(rel);
    }
    expect(
      undeclared,
      `These files define a tenant boundary the startup gate cannot see. Add ` +
        `registerTenantStore('<name>', () => this.hasScope()) to the class, or add the ` +
        `file to REGISTERED_ELSEWHERE with the address of its real registration.`,
    ).toEqual([]);
  });

  /** The allow-list must not outlive the files it excuses. */
  it('every REGISTERED_ELSEWHERE entry still names a real seam file', () => {
    const defining = new Set(
      filesDefiningBindScope().map((f) => f.slice(MAIN.length + 1).replace(/\\/g, '/')),
    );
    const stale = Object.keys(REGISTERED_ELSEWHERE).filter((k) => !defining.has(k));
    expect(stale, 'Stale exemptions — delete them.').toEqual([]);
  });

  /**
   * The count is REPORTED, not asserted against a hand-written number.
   *
   * An expected-count assertion would have to be edited by the same person who
   * added the store, at which point it proves nothing. What is asserted is the
   * invariant: there are seams, and every one of them is declared.
   */
  it('reports how many seams exist, and finds a non-trivial number of them', () => {
    const count = filesDefiningBindScope().length;
    // eslint-disable-next-line no-console
    console.log(`TENANT SEAMS defining bindScope: ${count}`);
    expect(count).toBeGreaterThan(15);
  });
});
