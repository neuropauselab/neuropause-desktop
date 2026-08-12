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
  return holdsRetainedState(src);
}

/**
 * Does this file RETAIN state, at ANY scope? P13C ROUND 9 — F18.
 *
 * THE BLIND SPOT ROUND 8 SHIPPED
 *
 * The previous predicate required the word `private`. It therefore saw class
 * fields and nothing else, and the red team found roughly fourteen persisting
 * files it could not see — `cloud/livesync/store.ts`, holding every
 * organization's pending record mutations in a module-level structure and
 * declaring nothing, being the one that mattered. A detector that only sees one
 * syntax is a detector that reports full coverage while the interesting stores
 * hide in the other syntaxes.
 *
 * WHAT IS NOW COVERED, EACH BECAUSE A REAL STORE IN THIS REPO USES IT
 *
 *   class field            `private rows: Row[] = []`
 *   module-level Map/Set   `const byId = new Map<string, Row>()`
 *   module-level array     `const queue: Job[] = []`
 *   closure-retained       `function make() { const seen = new Set(); … }`
 *     — the pattern below is scope-agnostic, so a binding inside a factory
 *       matches exactly as a top-level one does. That is the point: `let` and
 *       `const` inside a closure were completely invisible before.
 *   singleton / factory    both reduce to one of the above at the binding site
 *   typed single object    `private state: Snapshot = { … }` — a store holding
 *                          ONE record is still a store; `registry.json` and
 *                          `windowState` are exactly this shape.
 *   declared collections   `private rows: Map<string, Row>` assigned later
 *
 * WHAT IS STILL NOT COVERED, STATED PLAINLY RATHER THAN CLAIMED AWAY
 *
 * This is a REGEX OVER SOURCE. It cannot follow a collection that is only ever
 * reached through an imported helper, one built by a generic factory in another
 * file, or one held in a data structure the pattern does not name. So this gate
 * is a forcing function, NOT a proof of completeness, and the round that
 * declares otherwise is the round that gets the next F18. The startup assertion
 * in `assertAllStoreScopesBound()` is the second mechanism, and the two overlap
 * deliberately: static scanning catches what is never constructed in a test,
 * runtime assertion catches what the regex cannot parse.
 *
 * The asymmetry is unchanged and deliberate: a false positive costs one honest
 * declaration; a false negative is an unclassified store holding customer data.
 */
function holdsRetainedState(src: string): boolean {
  const BINDING = '(?:private|protected|public|const|let|var)\\s+(?:readonly\\s+)?\\w+\\s*';
  return (
    // = new Map() / new Set() / new WeakMap(), at any scope
    new RegExp(`${BINDING}(?::[^=;\\n]+)?=\\s*new\\s+(?:Map|Set|WeakMap|WeakSet)\\b`).test(src) ||
    // = []
    new RegExp(`${BINDING}(?::[^=;\\n]+)?=\\s*\\[\\s*\\]`).test(src) ||
    // : SomeType = { … }  — a store of exactly one record
    new RegExp(`${BINDING}:\\s*[\\w<>,\\s|\\[\\]]+\\s*=\\s*\\{`).test(src) ||
    // declared-but-assigned-later collections
    /(?:private|protected|public)\s+(?:readonly\s+)?\w+\s*!?\s*:\s*(?:Map|Set|Record)</.test(src) ||
    /(?:private|protected|public)\s+(?:readonly\s+)?\w+\s*:\s*\w+\[\]/.test(src)
  );
}

/**
 * Files that persist but are not stores. Each entry is a claim with a reason.
 *
 * The detector requires BOTH a write and a retained collection, which is why the
 * obvious candidates (`storeEnvelope`, `auditChain`, `logger`) never reach here:
 * they write what they are handed and keep no rows. The four below reach it
 * because they hold a collection of something OTHER than rows — probe functions,
 * live process handles, a local accumulator — while writing bytes they were
 * handed. Each reason names the specific file that is written and what it holds.
 *
 * ONE OF THEM IS NOT AN EXONERATION. `backup/backupManager.ts` is listed because
 * it retains nothing, and its entry records the finding rather than closing it.
 * An entry here is a statement about the FILE, never about the risk.
 */
const NOT_A_STORE: Record<string, string> = {
  /**
   * P13C ROUND 9 — F18.
   */
  'platform/index.ts':
    'Composition root. It writes ONE line per platform event to `logs/audit.log` with ' +
    '`fs.appendFile` — `{at, kind, type, actor, resource, correlationId}` — and retains none of ' +
    'them: `appendAuditLine` formats its argument and returns, so the file is a sink with no ' +
    'in-memory collection behind it and no read path in this module. The two collections the ' +
    'detector matched hold no rows: `pendingProbes` is an array of DIAGNOSTIC PROBE FUNCTIONS ' +
    'drained into the live probe list at init, and `seenDownloads` is a per-wiring `Set<string>` of ' +
    'download ids used to de-duplicate producer events in memory and never persisted. The two real ' +
    'stores it composes declare their own scopes in their own files — `platform/timelineService.ts` ' +
    '(platform-timeline, TENANT) and the event bus, both bound by the composition root through ' +
    '`bindTenant`.',

  'sandbox/enterprise/desktopChannel.ts':
    'Adapter over the live Playwright desktop driver. The only bytes it writes are the PNG returned ' +
    'by `session.window.screenshot()`, written straight through to ' +
    '`<artifactsBaseDir>/tenants/<tenantId>/<workspaceId>/<name>-<ts>-<n>.png` and handed back to ' +
    'the caller as a `storageRef`: it never lists, reads, indexes or deletes those files, so there ' +
    'is no collection of them to own. The retained state the detector matched is a ' +
    '`DesktopSessionRegistry` of LIVE ELECTRON PROCESS HANDLES (`ManagedSession`, `DesktopWindow`), ' +
    'which cannot survive a restart by construction — the process it refers to is gone. Ownership ' +
    'is already enforced on that registry (F15/F16, Round 9): every operation resolves the owner ' +
    'before executing and every path segment is sanitized so a tenant id containing `..` cannot ' +
    'climb into another tenant\'s captures.',

  'support/supportBundle.ts':
    'Artifact sink. `generate()` writes the `SupportBundlePayload` its `collect()` dependency hands ' +
    'it — versions, diagnostics, modules, connector name+status, plugins, crashes — plus ' +
    'redaction-scrubbed copies of `logs/` and a manifest, into a fresh `support-<ts>` directory. It ' +
    'retains nothing between calls (`contents` is a local array) and has no list, read, validate or ' +
    'delete path, so no bundle is ever reachable through this class again. NOT A CLEAN BILL: the ' +
    'bundle it produces spans every tenant on the install, which is why `support:generateBundle` was ' +
    'moved from `org:manage` to `cloud:operate` this round (F21) — see ipc/runtimeAuthz.ts.',

  /**
   * P13C ROUND 9 — F22. AN ENTRY THAT RECORDS AN OPEN FINDING.
   *
   * The FILE is not a store: `BackupManager` retains no collection between calls
   * (`entries` is a local in `create`), and every byte it writes it was handed —
   * `fs.copyFile` of paths the store-path registry named, plus a `manifest.json`
   * of `{domain, relativePath, sizeBytes, sha256}` per copied file. The rows in
   * those copied files belong to stores that each declare their own scope.
   *
   * The ARCHIVE it produces is a different matter and is reported as F22, not
   * closed here: `storage/storePaths.ts` includes `memory.json`, `graph.json`,
   * `unified-store.json`, `enterprise-module-*` ("the user's business records"),
   * `assistant-conversations.json` and `executive-decisions.json`, so one
   * backup directory is a verbatim copy of EVERY organization's records with no
   * tenant partition. There is no honest declaration for that in this
   * vocabulary — CUSTOMER_DERIVED is refused for both global scopes, and the
   * archive is not one tenant's — and inventing a TENANT scope it does not have
   * would be the false claim this registry exists to prevent. Partitioning the
   * archive per tenant means re-serializing every store's rows through that
   * store's own filter, which is not a contained change. What WAS contained and
   * is done: `backup:restore` and `backup:delete` moved from `org:manage` to
   * `cloud:operate` (F21), so one organization's administrator can no longer
   * roll back or destroy every other organization's data.
   */
  'backup/backupManager.ts':
    'Copy engine, not a store: it retains no collection between calls and writes only files it was ' +
    'handed by `storage/storePaths.ts` plus a manifest of {domain, relativePath, sizeBytes, sha256}. ' +
    'OPEN FINDING F22, recorded here rather than declared away: the ARCHIVE it produces is an ' +
    "install-wide verbatim copy of every organization's records with no tenant partition, so it has " +
    'no honest scope in this vocabulary. Restore and delete moved to cloud:operate this round; ' +
    'per-tenant partitioning of the archive is open.',
};

/**
 * Does this file REMOVE retained rows? P13C ROUND 10.
 *
 * The three HIGH findings Round 9's red team proved — `inboxStore`,
 * `webhookStore`, `runStore` — were all one bug: a cap over a single shared
 * array that deleted another tenant's rows while every read above it was
 * correctly filtered. All three passed the scope gate, because
 * `registerTenantStore(name, hasScope)` satisfies it and **takes no retention
 * argument at all**. The question was never asked.
 *
 * So the gate now asks it. A file that persists, retains rows AND removes them
 * must carry a `declareStoreScope` naming `retentionScope` and
 * `retentionAuthority` — the enum form, which `declareStoreScope` can check
 * against the store's scope. Prose could not be checked; `TENANT` + `INSTALL`
 * now throws.
 *
 * Deliberately broad. `.delete(` and `.clear()` are included even though most
 * are ordinary single-row deletes, because a single-row delete reached by a
 * renderer-supplied id is the OTHER half of this program's history. The cost of
 * a false positive is one honest enum on a declaration that already exists.
 */
function removesRows(src: string): boolean {
  return (
    /\.slice\(\s*0\s*,/.test(src) ||
    /\.slice\(\s*-/.test(src) ||
    /\.splice\(\s*0\s*,/.test(src) ||
    /\.shift\(\)/.test(src) ||
    /\.pop\(\)/.test(src) ||
    /\.length\s*=\s*[A-Z_0-9]/.test(src) ||
    /\bevict/i.test(src) ||
    /\bprune/i.test(src) ||
    /\bexpire\b/i.test(src) ||
    /\bTTL\b/.test(src) ||
    /\bLRU\b/.test(src) ||
    /\btruncate\b/i.test(src) ||
    /\.delete\(/.test(src) ||
    /\.clear\(\)/.test(src)
  );
}

/** Does the file state its retention in the CHECKABLE enum form? */
function declaresRetentionScope(src: string): boolean {
  return /retentionScope\s*:/.test(src) && /retentionAuthority\s*:/.test(src);
}

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
      /**
       * FORWARD SLASHES ON EVERY PLATFORM. P13C ROUND 17k.
       *
       * `slice()` leaves the OS separator in place, so on Windows this produced
       * `backup\\backupManager.ts` while every key in NOT_A_STORE is written
       * `backup/backupManager.ts`. The allow-list stopped matching and this gate
       * reported four files as undeclared stores that have been declared for days.
       *
       * A path comparison IS the security control here: every exemption in this
       * file is keyed by one. A separator is not a cosmetic detail when the string
       * decides whether a store is exempt.
       *
       * `tenantStoreRegistry.test.ts` already carried exactly this `.replace`. One
       * file knew; the knowledge never spread, and no Windows run existed to force
       * the issue until the first founder build.
       */
      const rel = path.slice(MAIN.length + 1).replace(/\\/g, '/');
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
   * P13C ROUND 10 — THE RETENTION GATE. A store that DELETES must say whose rows.
   *
   * This is the invariant Round 9 ended without. Three proven HIGH findings —
   * one tenant's volume deleting another's notifications, dead-letter queue and
   * certification history — sat in stores that satisfied the scope gate through
   * `registerTenantStore`, which cannot express a retention policy. Nothing ever
   * asked them the question, so nothing ever caught the answer being wrong.
   *
   * The failure message names the decision owed, not just the problem, because a
   * gate whose output is "something is wrong" gets suppressed.
   */
  it('a file that persists AND removes rows declares retentionScope and retentionAuthority', () => {
    const missing: string[] = [];
    for (const path of sourceFiles(MAIN)) {
      // P13C ROUND 17k — `/` on every platform; see above.
      const rel = path.slice(MAIN.length + 1).replace(/\\/g, '/');
      if (NOT_A_STORE[rel] !== undefined) continue;
      const src = readFileSync(path, 'utf8');
      if (!persistsState(src)) continue;
      if (!removesRows(src)) continue;
      if (!declaresRetentionScope(src)) missing.push(rel);
    }

    expect(
      missing.sort(),
      'These files persist state AND remove rows, and do not say WHOSE rows a removal can ' +
        'reach. Add retentionScope (OWNER | INSTALL | NONE) and retentionAuthority ' +
        '(OWNER | PLATFORM_OPERATOR | SYSTEM | NONE) to declareStoreScope. ' +
        'A retention cap is a WRITE: this program has found eighteen that deleted across a ' +
        'tenant boundary while every read above them was correctly filtered. ' +
        'registerTenantStore cannot express this, which is exactly why three of them shipped.',
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
