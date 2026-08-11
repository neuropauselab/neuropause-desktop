/**
 * EVERY PERSISTENT STATEFUL SUBSYSTEM MUST DECLARE ITS SCOPE.
 *
 * WHY THIS EXISTS, AND WHY THE EXISTING REGISTRY WAS NOT ENOUGH
 *
 * `registerTenantStore` inverted the audit problem: instead of searching for
 * stores somebody forgot to bind, a store registers itself and the app refuses to
 * start if it is unbound. That is the right shape, and it has one hole big enough
 * to have hidden four HIGH findings:
 *
 *     A STORE THAT NEVER REGISTERS IS INVISIBLE TO THE REGISTRY.
 *
 * Round 7's red team found seven such stores. `discoveryState` held cloud account
 * ids for every tenant. `memoryAuditLog` held assistant-written record titles on a
 * PUBLIC channel. `traceStore` deleted another tenant's regulated recall evidence.
 * None of them appeared in the coverage report, because the report enumerates
 * stores that OPTED IN. Round 6 widened the scan from `bindScope` to
 * `bindWorkspace`, which helped and was still detection by naming convention — a
 * subsystem with no seam at all matches no convention.
 *
 * THE INVARIANT THIS FILE ENFORCES
 *
 * Every file that holds persistent state must declare exactly one scope from the
 * closed set below. Omission is a TEST FAILURE (`storeScopeGate.test.ts` runs in
 * `npm test`), so a developer who writes a new store and forgets cannot get a
 * green build. `UNKNOWN` is not a value — the type has no room for it.
 *
 * WHY A DECLARATION AND NOT INFERENCE
 *
 * A scanner could guess from field names, and this program has repeatedly shown
 * what guessing is worth: `objectCount` and `syncOps` are tenant-derived and named
 * for neither; `platformId:accountId` looks specific and authorizes nothing. The
 * scanner's job is therefore to detect PERSISTENCE — which is mechanical and hard
 * to hide — and demand a human answer for scope. It is a forcing function, not an
 * oracle.
 *
 * WHAT A DECLARATION COSTS THE DECLARER
 *
 * Deliberately more than one word. `INSTALL_GLOBAL` and `PLATFORM_GLOBAL` require
 * an authority model and a reason, because those two are the ones that get chosen
 * by accident — "it's just a config file" is how the AI provider endpoint came to
 * be install-wide behind a tenant role, letting one organization's administrator
 * redirect another organization's records off the device.
 */

/**
 * The closed set. Adding a seventh is a deliberate architectural act; there is no
 * escape hatch, and that is the point.
 */
export type StoreScope =
  /** Rows belong to one ORGANIZATION. The default answer for customer data. */
  | 'TENANT'
  /** Rows belong to one WORKSPACE inside an organization. Narrower than TENANT. */
  | 'WORKSPACE'
  /** Rows belong to one SIGNED-IN PERSON, across organizations. */
  | 'USER'
  /**
   * One shared thing on one machine, holding NO customer-derived state.
   * Mutation is an organization-level decision that affects the install.
   */
  | 'INSTALL_GLOBAL'
  /**
   * One shared thing on one machine whose MUTATION requires install-level
   * authority (`cloud:operate`), because changing it affects every tenant.
   */
  | 'PLATFORM_GLOBAL'
  /** In-memory only. Nothing survives a restart. */
  | 'EPHEMERAL';

/** Where the state lives. `EPHEMERAL` scope and `none` persistence go together. */
export type StorePersistence = 'file' | 'keychain' | 'memory';

/**
 * Who may MUTATE. Distinct from scope on purpose.
 *
 * Round 7's central lesson: an install-level resource behind an organization-level
 * role is the bug. Three findings had that exact shape — the AI destination,
 * plugin capability grants, rate-limit policies. Scope answers "whose data is
 * this"; authority answers "who may change it", and they must be on the same axis.
 */
export type StoreAuthority =
  /** An organization role decides. */
  | 'ORG_ROLE'
  /** An install-level platform operator decides (`cloud:operate`). */
  | 'PLATFORM_OPERATOR'
  /** The signed-in person decides, for their own state. */
  | 'USER'
  /** Nothing mutates it through a user-facing surface. */
  | 'SYSTEM';

/** What kind of information the rows hold. Drives whether a global scope is legal. */
export type DataClassification =
  /** Derived from, names, counts, or describes a customer's records or activity. */
  | 'CUSTOMER_DERIVED'
  /** About the machine, the software, or a publisher. Never about a customer. */
  | 'INSTALL_METADATA'
  /** About the signed-in person's own preferences or device. */
  | 'USER_PREFERENCE'
  /** Credentials or secrets. */
  | 'SECRET';

export interface StoreScopeDeclaration {
  /** Stable, human-readable, unique. Appears in the coverage report. */
  name: string;
  scope: StoreScope;
  persistence: StorePersistence;
  authority: StoreAuthority;
  classification: DataClassification;
  /**
   * How rows are removed, and WHOSE rows a removal can reach.
   *
   * Mandatory because a retention cap is a WRITE. This program has found SIX
   * install-wide caps sitting behind correct read filters — `executionStore.save`,
   * then `replaceAll`, then governance audit, relationship links, assistant
   * conversations, the memory audit log — each one able to delete another tenant's
   * data while every read was perfectly scoped. A filter hides; a cap deletes.
   */
  retention: string;
  /**
   * WHY this scope, and for the two global scopes what the cross-tenant cost is.
   *
   * Required for every scope, not just the globals: a TENANT declaration whose
   * reason is empty is a store nobody thought about, and this program's entire
   * history is stores nobody thought about.
   */
  reason: string;
  /**
   * Whether the seam is currently bound. Omit for scopes that have no seam.
   * `assertAllStoreScopesBound()` calls it at startup.
   */
  isBound?: () => boolean;
}

const registry = new Map<string, StoreScopeDeclaration>();

/** Scopes that require a live tenant/workspace seam. */
const SEAMED: ReadonlySet<StoreScope> = new Set<StoreScope>(['TENANT', 'WORKSPACE', 'USER']);

/**
 * Declare a persistent store's scope. Call once, at construction.
 *
 * THE ILLEGAL COMBINATION IS ENFORCED HERE, not documented: customer-derived
 * state cannot be `INSTALL_GLOBAL` or `PLATFORM_GLOBAL`. That is the rule Round 8
 * exists to make unbreakable, and it throws rather than warns — a warning in a
 * startup log is a thing nobody reads until after the incident.
 */
export function declareStoreScope(decl: StoreScopeDeclaration): void {
  if (decl.name.trim() === '') throw new Error('A store scope declaration needs a name.');
  if (decl.reason.trim() === '') {
    throw new Error(`Store "${decl.name}" must say WHY it has scope ${decl.scope}.`);
  }
  if (decl.retention.trim() === '') {
    throw new Error(
      `Store "${decl.name}" must state its retention policy and whose rows a removal can reach. ` +
        'A retention cap is a write.',
    );
  }
  if (
    decl.classification === 'CUSTOMER_DERIVED' &&
    (decl.scope === 'INSTALL_GLOBAL' || decl.scope === 'PLATFORM_GLOBAL')
  ) {
    throw new Error(
      `Store "${decl.name}" holds CUSTOMER_DERIVED data and cannot be ${decl.scope}. ` +
        'Customer data belongs to a tenant, a workspace or a user.',
    );
  }
  if (decl.scope === 'PLATFORM_GLOBAL' && decl.authority !== 'PLATFORM_OPERATOR') {
    throw new Error(
      `Store "${decl.name}" is PLATFORM_GLOBAL, so its authority must be PLATFORM_OPERATOR. ` +
        'An install-wide resource behind an organization role is the Round 7 finding class.',
    );
  }
  if (decl.scope === 'EPHEMERAL' && decl.persistence !== 'memory') {
    throw new Error(`Store "${decl.name}" is EPHEMERAL but persists to ${decl.persistence}.`);
  }
  registry.set(decl.name, decl);
}

/** Every declaration, sorted. For the coverage report and the gate test. */
export function storeScopeDeclarations(): StoreScopeDeclaration[] {
  return [...registry.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Declarations by scope, for the inventory. */
export function storeScopeCoverage(): Record<StoreScope, number> {
  const out: Record<StoreScope, number> = {
    TENANT: 0,
    WORKSPACE: 0,
    USER: 0,
    INSTALL_GLOBAL: 0,
    PLATFORM_GLOBAL: 0,
    EPHEMERAL: 0,
  };
  for (const d of registry.values()) out[d.scope] += 1;
  return out;
}

/**
 * STARTUP GATE. Throws when a seamed store has no live boundary.
 *
 * Called from the composition root before any handler is registered, so an
 * unbound store cannot reach a user: the application refuses to start rather than
 * serving one tenant's rows to another.
 */
export function assertAllStoreScopesBound(): void {
  const unbound = [...registry.values()]
    .filter((d) => SEAMED.has(d.scope) && d.isBound !== undefined && !d.isBound())
    .map((d) => `${d.name} (${d.scope})`);
  if (unbound.length > 0) {
    throw new Error(
      `Stores declared with a tenant scope have no boundary bound: ${unbound.sort().join(', ')}. ` +
        'Bind at the composition root, or re-declare the scope with an honest reason.',
    );
  }
}

/** Test-only. The registry is module state and suites must not leak into each other. */
export function __resetStoreScopeRegistryForTests(): void {
  registry.clear();
}
