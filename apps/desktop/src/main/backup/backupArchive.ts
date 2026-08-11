/**
 * THE MULTI-TENANT ARCHIVE — a declared object kind, and the containment rules
 * that make the declaration true. P13C ROUND 10 — F22 / NEW-M6.
 *
 * WHY A NEW CONCEPT AND NOT A STORE SCOPE
 *
 * `tenancy/storeScope.ts` has six scopes and refuses the only two that could
 * describe a whole-install backup:
 *
 *   TENANT           would be a FALSE CLAIM. `<backupsDir>/<id>/data/` is a
 *                    verbatim copy of `memory.json`, `graph.json`,
 *                    `unified-store.json`, `enterprise-module-*` and
 *                    `assistant-conversations.json` — every organization's
 *                    records in one directory, with no tenant partition.
 *   PLATFORM_GLOBAL  is REFUSED AT CONSTRUCTION for CUSTOMER_DERIVED payloads,
 *                    and rightly: declaring it would say "this holds nothing
 *                    derived from a customer", which is the opposite of true.
 *
 * So the archive was left undeclared and recorded as an open finding (F22) in
 * `storeScopeGate.test.ts`'s NOT_A_STORE entry. An undeclared thing is one
 * nobody has to justify, and this program's history is undeclared things.
 *
 * WHAT THIS FILE DOES INSTEAD
 *
 * It names the archive as its own kind — MULTI_TENANT_INSTALL — and forces the
 * declaration to state the four facts the store vocabulary would have forced:
 * WHAT it contains, WHO may create or restore it, HOW LONG it is kept, and —
 * the one a store never has to answer — WHAT A RESTORE PUTS BACK. Missing or
 * dishonest values throw at construction, exactly as `declareStoreScope` does.
 *
 * WHAT IS ENFORCED, AND WHAT IS ONLY DECLARED — STATED PLAINLY
 *
 * ENFORCED (code refuses, tests prove):
 *   1. Every archive carries its scope declaration INSIDE `manifest.json`, and
 *      `restore` REFUSES an archive that carries none — a hand-planted or
 *      legacy directory cannot be restored at all.
 *   2. `restore` REFUSES unless the caller passes the archive's declared
 *      restoration boundary explicitly. A whole-install rollback cannot happen
 *      through a call that did not say it was one.
 *   3. Every path is contained: the archive id resolves inside the backups
 *      directory (charset + real-path, so a symlinked directory cannot escape),
 *      every manifest entry resolves inside the archive on read and inside the
 *      data directory on write, and a write target must be a path the
 *      store-path registry actually covers for that entry's domain.
 *   4. Authority: create / list / validate / restore / delete all require
 *      `cloud:operate` (see ipc/runtimeAuthz.ts), a platform-only permission no
 *      organization role can hold.
 *
 * NOT ENFORCED — DECLARED, AND THE DECLARATION SAYS SO:
 *   • The archive is NOT partitioned. One tenant's bytes sit beside another's
 *     in the same directory. Partitioning would mean re-serialising every
 *     store's rows through that store's own tenant filter — every domain in
 *     `storePaths.ts`, not a contained change, and NOT attempted here.
 *   • A restore is therefore still all-or-nothing across tenants: the boundary
 *     is NAMED, AUDITED and GATED on platform authority, not NARROWED. One
 *     operator's chosen point in time still lands on every organization.
 *   • Anyone who can read `userData` at the OS level can read an archive
 *     exactly as they can read the live files. Nothing here changes that.
 */
import { promises as fs } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { MaintenanceDomain } from '@neuropause/shared';
import { DOMAIN_FILES, isPrefixEntry } from '../storage/storePaths';

/* ══════════════════════════ the declaration ══════════════════════════ */

/** The only archive scope that exists. Adding a second is a deliberate act. */
export type ArchiveScope = 'MULTI_TENANT_INSTALL';

/**
 * What a restore of this archive puts back.
 *
 * `ALL_TENANTS_AT_ONCE` is not a euphemism — it is the honest name for copying
 * whole-install record files back over the live ones. A caller must pass this
 * value to restore, so no code path can perform an install-wide rollback while
 * appearing to ask for something smaller.
 */
export type ArchiveRestorationBoundary = 'ALL_TENANTS_AT_ONCE';

/** Who may create or restore. Only the platform axis is legal for this kind. */
export type ArchiveAuthority = 'PLATFORM_OPERATOR';

export interface ArchiveRestorationModel {
  boundary: ArchiveRestorationBoundary;
  authority: ArchiveAuthority;
  /** What a restore overwrites, whose data it reaches, and what it cannot do. */
  detail: string;
}

export interface MultiTenantArchiveDeclaration {
  /** Stable, human-readable, unique. Stamped into every manifest this produces. */
  name: string;
  scope: ArchiveScope;
  /** WHAT IS INSIDE — named concretely, not "application data". */
  contents: string;
  /** Who may create one. */
  authority: ArchiveAuthority;
  /** How many are kept, who prunes, and whose rows a prune can remove. */
  retention: string;
  /** What a restore puts back. The question a store scope never has to answer. */
  restoration: ArchiveRestorationModel;
  /** WHY this exists as its own kind, and what it does NOT isolate. */
  reason: string;
}

const archives = new Map<string, MultiTenantArchiveDeclaration>();

/**
 * Declare a multi-tenant archive. Call once, at construction.
 *
 * Throws on an incomplete or dishonest declaration, for the same reason
 * `declareStoreScope` does: a warning in a startup log is a thing nobody reads
 * until after the incident.
 */
export function declareMultiTenantArchive(
  decl: MultiTenantArchiveDeclaration,
): MultiTenantArchiveDeclaration {
  const need = (value: string, what: string): void => {
    if (value.trim() === '') {
      throw new Error(`Multi-tenant archive "${decl.name || '(unnamed)'}" must state ${what}.`);
    }
  };
  if (decl.name.trim() === '') throw new Error('A multi-tenant archive declaration needs a name.');
  need(decl.contents, 'WHAT it contains');
  need(decl.retention, 'its retention policy and whose rows a prune can remove');
  need(decl.reason, 'WHY it is a multi-tenant archive rather than a tenant-scoped object');
  need(decl.restoration.detail, 'WHAT A RESTORE PUTS BACK');
  /**
   * The archive holds every organization's records. An organization role over it
   * would be the Round 7 finding class — anyone may create an organization and
   * own it, so that would be a self-service grant to read or roll back every
   * other tenant. Only the platform axis is legal, and the type says so; this
   * check is the runtime half for callers that arrive through `any`.
   */
  if (decl.authority !== 'PLATFORM_OPERATOR' || decl.restoration.authority !== 'PLATFORM_OPERATOR') {
    throw new Error(
      `Multi-tenant archive "${decl.name}" must be PLATFORM_OPERATOR authority for both creation ` +
        'and restoration. It contains every organization\'s records; an organization role over it ' +
        'is a self-service grant over every other tenant.',
    );
  }
  archives.set(decl.name, decl);
  return decl;
}

/** Every declared archive kind, sorted. For inventory and the gate test. */
export function multiTenantArchiveDeclarations(): MultiTenantArchiveDeclaration[] {
  return [...archives.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * THE ONE ARCHIVE THIS PRODUCT PRODUCES — declared at module load, exactly as
 * every store declares its scope at construction.
 *
 * Read `restoration.detail` before changing anything here. It is the sentence the
 * store vocabulary never made anybody write, and it is the whole reason this
 * concept exists rather than a sixth store scope.
 */
export const INSTALL_ARCHIVE: MultiTenantArchiveDeclaration = declareMultiTenantArchive({
  name: 'local-backup-archive',
  scope: 'MULTI_TENANT_INSTALL',
  contents:
    "Every organization's records on this machine, byte-for-byte and unpartitioned: memory.json, " +
    'graph.json, unified-store.json, every enterprise-module-* store (the general ledger, ERP ' +
    'records, HR), executive-decisions.json, enterprise-governance.json, automations.json, ' +
    'health-history.json, assistant-conversations.json, feedback.json, the timeline directory, ' +
    'workforce-*.json, registry.json, plugins.json + the plugin roots, and the configuration and ' +
    'workspace files — i.e. the whole of storage/storePaths.ts DOMAIN_FILES. manifest.json adds a ' +
    '{domain, relativePath, sizeBytes, sha256} row per file, so the manifest alone discloses how ' +
    'much data the install holds.',
  authority: 'PLATFORM_OPERATOR',
  retention:
    'Scheduled backups: newest 10 kept, pruned by the scheduler in releaseOps/index.ts. Manual ' +
    'backups: newest MANUAL_BACKUP_KEEP kept, pruned inside BackupManager.create so every caller ' +
    'is capped (P13C Round 10 NEW-M7 — manual backups were uncapped, so a loop was a disk-fill). ' +
    'Pre-migration snapshots are NEVER pruned: they are the rollback anchor for a failed ' +
    "migration. A prune deletes a whole archive, so it removes every organization's copy at once " +
    '— never one tenant\'s. The archive currently being restored is protected from its own ' +
    "restore's safety snapshot.",
  restoration: {
    boundary: 'ALL_TENANTS_AT_ONCE',
    authority: 'PLATFORM_OPERATOR',
    detail:
      'A restore copies the archived files back OVER the live data directory. It is install-wide ' +
      'and all-or-nothing across tenants: one operator picking one archive rolls EVERY ' +
      'organization on the machine back to that point, and any record any other tenant wrote ' +
      'since is gone (it survives only in the safety snapshot taken first). It cannot be narrowed ' +
      'to one tenant — the archive is not partitioned — and the `domains` argument narrows only ' +
      'WHICH STORES are put back, never WHOSE. What restore CANNOT do: write outside the data ' +
      'directory, write a path the store-path registry does not cover for the entry\'s own ' +
      'domain, or run at all for an archive that carries no declaration or whose declared ' +
      'boundary the caller did not acknowledge.',
  },
  reason:
    'WHY ITS OWN KIND: no StoreScope can describe it honestly. TENANT is a false claim (it holds ' +
    'every organization\'s records in one directory); PLATFORM_GLOBAL is refused at construction ' +
    'for CUSTOMER_DERIVED payloads, and rightly — declaring it would assert the archive holds ' +
    'nothing derived from a customer. WHAT IT DOES NOT ISOLATE: nothing. There is no tenant ' +
    'boundary inside the archive and this declaration does not invent one; it makes the absence ' +
    'explicit, puts the operation on platform authority, and forces every restore to name the ' +
    'boundary it crosses.',
});

/**
 * The declaration block written into `manifest.json`.
 *
 * It is on the ARCHIVE, not only in the source, because the enforcement point is
 * a restore of a directory that may have been produced by another build — or by
 * an attacker. `restore` refuses an archive whose manifest carries no valid
 * block, so "undeclared" fails closed instead of defaulting to install-wide.
 */
export interface ArchiveManifestScope {
  scope: ArchiveScope;
  /** Which tenants' records are inside. `ALL` is the only honest value today. */
  tenants: 'ALL';
  authority: ArchiveAuthority;
  restoration: ArchiveRestorationBoundary;
  /** The name of the declaration this archive was produced under. */
  declaration: string;
}

export function archiveManifestScope(
  decl: MultiTenantArchiveDeclaration,
): ArchiveManifestScope {
  return {
    scope: decl.scope,
    tenants: 'ALL',
    authority: decl.authority,
    restoration: decl.restoration.boundary,
    declaration: decl.name,
  };
}

/** True when a manifest's `archive` block is a well-formed scope declaration. */
export function isArchiveManifestScope(value: unknown): value is ArchiveManifestScope {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.scope === 'MULTI_TENANT_INSTALL' &&
    v.tenants === 'ALL' &&
    v.authority === 'PLATFORM_OPERATOR' &&
    v.restoration === 'ALL_TENANTS_AT_ONCE' &&
    typeof v.declaration === 'string' &&
    v.declaration.trim() !== ''
  );
}

/**
 * The acknowledgement a restore is performed under. A restore cannot happen
 * without one, and it must match the boundary the archive itself declares.
 *
 * TWO LEVELS, AND WHY BOTH.
 *
 * `BackupManagerDeps.restoreBoundary` is REQUIRED, so a composition root cannot
 * build a manager that restores without first writing down, in source, that its
 * restores put every tenant back at once. That is the forcing function — a new
 * wiring of this class has to state the boundary before it compiles.
 *
 * `restore(..., ack)` overrides it per call, and the surfaces that take a
 * caller-chosen archive id use it to name themselves: the `backup:restore` IPC
 * handler, the migration engine's rollback, and the Recovery Center through the
 * composition's declaration (see releaseOps/index.ts). `declaredBy` is required
 * and non-empty so a refusal or an audit line says WHICH surface asked.
 *
 * WHAT THIS DOES NOT DO — the honest limit. It does not narrow the blast radius:
 * `ALL_TENANTS_AT_ONCE` is the only boundary that exists, because the archive is
 * not partitioned. It makes the crossing EXPLICIT and refusable, not smaller.
 */
export interface RestoreBoundaryAcknowledgement {
  boundary: ArchiveRestorationBoundary;
  declaredBy: string;
}

/**
 * Refuse an acknowledgement that is missing, malformed, or disagrees with the
 * archive's own declared boundary. Returns a refusal string, or `null` to allow.
 *
 * The archive's block is the authority, not the caller: a caller that asks for a
 * boundary the archive does not declare is refused rather than accommodated.
 */
export function restoreBoundaryRefusal(
  archive: ArchiveManifestScope,
  ack: RestoreBoundaryAcknowledgement | undefined,
): string | null {
  if (!ack || typeof ack.declaredBy !== 'string' || ack.declaredBy.trim() === '') {
    return (
      'refused: a restore must acknowledge the restoration boundary it crosses and name the ' +
      'surface asking for it'
    );
  }
  if (ack.boundary !== archive.restoration) {
    return (
      `refused: ${ack.declaredBy} acknowledged boundary "${ack.boundary}", but this archive ` +
      `declares "${archive.restoration}" — a restore may not cross a boundary its caller did ` +
      'not name'
    );
  }
  return null;
}

/* ══════════════════════ containment (NEW-M6) ══════════════════════════ */

/**
 * A backup id is ONE directory name, with no way out of it.
 *
 * `BackupIdSchema` in the shared contracts is `z.string().trim().min(1).max(128)`
 * — no charset — so `{id:'../../../../tmp/victim'}` reached `join()` and then
 * `fs.rm(dir,{recursive:true,force:true})`. This is the same rule
 * `sandbox/desktop/sessionManager.ts`'s `safeSegment` applies to a tenant
 * segment, written as a REFUSAL rather than a rewrite: silently sanitising an
 * id would delete or restore the WRONG backup, which is its own incident.
 *
 * The first character must be alphanumeric, so `..`, `.` and dotfiles are out;
 * the rest is `[A-Za-z0-9._-]`, so `/`, `\`, `:`, `%`, NUL and every encoded
 * traversal form are out (nothing decodes `%2e%2e` on this path, but the
 * character is refused anyway rather than reasoned about).
 */
const ARCHIVE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function isSafeArchiveId(id: string): boolean {
  return ARCHIVE_ID.test(id);
}

/** The deepest ancestor that exists, real-pathed, with the missing tail re-joined. */
async function realpathDeepest(path: string): Promise<string> {
  const tail: string[] = [];
  let cursor = path;
  for (;;) {
    try {
      const real = await fs.realpath(cursor);
      return tail.length === 0 ? real : join(real, ...tail.reverse());
    } catch {
      const parent = dirname(cursor);
      if (parent === cursor) return path;
      tail.push(basename(cursor));
      cursor = parent;
    }
  }
}

/** True when `candidate` is `root` itself or lives underneath it. */
function within(root: string, candidate: string): boolean {
  if (candidate === root) return true;
  const rel = relative(root, candidate);
  return rel !== '' && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel);
}

/**
 * Resolve `segments` under `root` and return the absolute path ONLY if the
 * result is really contained — otherwise `null`.
 *
 * "Really" is the load-bearing word: the check is on the RESOLVED REAL PATH, not
 * on the string. A directory named `evil` inside the backups directory that is a
 * symlink to `/tmp/victim` passes every string test and is refused here, because
 * both root and target are resolved through `fs.realpath` first.
 */
export async function resolveContained(
  root: string,
  ...segments: string[]
): Promise<string | null> {
  for (const segment of segments) {
    if (segment === '' || segment.includes('\0') || isAbsolute(segment)) return null;
    // `..` as a whole segment, in either separator style, at any position.
    const parts = segment.split(/[\\/]+/);
    if (parts.some((p) => p === '..')) return null;
  }
  const realRoot = await realpathDeepest(root);
  const target = resolve(realRoot, ...segments);
  if (!within(realRoot, target)) return null;
  const realTarget = await realpathDeepest(target);
  return within(realRoot, realTarget) ? realTarget : null;
}

/**
 * Is this relative path one the store-path registry actually covers for this
 * domain? THE RESTORATION BOUNDARY, in the narrow sense that can be enforced.
 *
 * `restore` writes `join(dataDir, entry.relativePath)` for every entry in a
 * manifest it read off disk. Containment alone stops `../../.ssh/authorized_keys`;
 * it does not stop `settings.json`, `plugins/evil/index.js` or any other path
 * INSIDE the data directory that the backup had no business carrying. A planted
 * manifest is an arbitrary file write into `userData` — which, for a directory
 * that holds a plugin root, is arbitrary code execution on next launch.
 *
 * So a restore may only write paths the registry names for the entry's OWN
 * declared domain: an exact file, a file under a declared directory, or a match
 * for a declared `prefix*` pattern.
 */
export function isCoveredByDomain(domain: MaintenanceDomain, relativePath: string): boolean {
  const covered = DOMAIN_FILES[domain];
  if (!covered) return false;
  const normalised = relativePath.split(/[\\/]+/).filter((p) => p !== '');
  if (normalised.length === 0) return false;
  const posix = normalised.join('/');
  for (const rel of covered) {
    if (isPrefixEntry(rel)) {
      // `enterprise-module-*` — matches on the FIRST segment only, exactly as
      // `filesForPath` resolves it against the live data directory.
      if (normalised[0].startsWith(rel.slice(0, -1))) return true;
      continue;
    }
    if (posix === rel) return true;
    if (posix.startsWith(`${rel}/`)) return true;
  }
  return false;
}
