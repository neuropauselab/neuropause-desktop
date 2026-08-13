/**
 * The Local Application Registry — the on-disk source of truth for everything
 * installed through NeuroPause. It records install metadata, integrity hashes,
 * granted permissions, runtime/health status, usage analytics, and user flags
 * (pinned/favorite). The Package Service writes it; the Runtime reads it; the
 * UI renders it.
 *
 * Durability: writes are atomic (temp file + rename). Integrity: the file
 * carries a SHA-256 over its canonical contents, verified on load. The whole
 * file is versioned so its schema can migrate forward safely.
 */
import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { app } from 'electron';
import type {
  AppType,
  HealthStatus,
  PermissionGrant,
  RegistryEntryDto,
  RegistryStats,
  RuntimePermissionKey,
  RuntimeStatus,
} from '@neuropause/shared';
import { createLogger } from '../logger';
import { declareStoreScope } from '../tenancy/storeScope';

/**
 * P13C ROUND 9 — F18/F20. The structural scope declaration.
 *
 * It could not be written before this round, and the reason is recorded here
 * rather than deleted with the problem: `launchCount`, `lastLaunchedAt` and
 * `usage.{launches,totalActiveMs,lastSessionAt}` were accumulated on the SHARED
 * catalogue row from every tenant's launches, which made an install-wide
 * `registry:list` a live meter of another organization's activity — the
 * `worker-registry` shape exactly. CUSTOMER_DERIVED + INSTALL_GLOBAL is refused
 * by construction, so the declaration was impossible while that was true.
 * `TenantUsage` below moves those five fields off the shared row.
 */
declareStoreScope({
  name: 'local-app-registry',
  scope: 'INSTALL_GLOBAL',
  persistence: 'file',
  // P13C ROUND 9 — F20. `registry:import` and `registry:backup` were classified
  // `operations:manage`, an ORGANIZATION role over one install-wide file, and
  // `import({merge:false})` REPLACES every entry. Both now require
  // `cloud:operate`, which no organization role can hold — see ipc/runtimeAuthz.
  authority: 'PLATFORM_OPERATOR',
  classification: 'INSTALL_METADATA',
  /**
   * P13C ROUND 10. INSTALL is structurally correct — `RegistryEntry` has no
   * tenant field, so there are no per-owner rows and `declareStoreScope` refuses
   * `OWNER` here. PLATFORM_OPERATOR is the authority this store REQUIRES and the
   * one two of its three removal-reaching channels carry.
   *
   * IT IS NOT THE AUTHORITY THE THIRD ONE CARRIES. See the OPEN FINDING in the
   * retention string below: `nps:uninstall` reaches `remove(slug)` on
   * `requireAuth` alone. This declaration names the authority an install-wide
   * deletion must have, and records where the code does not yet meet it, rather
   * than describing the gap as if it were the policy.
   */
  retentionScope: 'INSTALL',
  retentionAuthority: 'PLATFORM_OPERATOR',
  retention:
    'No cap and no eviction: nothing is ever removed to make room, so no write can destroy another ' +
    "reader's row. `remove(slug)` deletes one entry for the whole install (an uninstall), and " +
    '`import({merge:false})` REPLACES the entire map — both install-wide acts. `import` and ' +
    '`backup` sit behind cloud:operate as of Round 9. Per-tenant usage counters are keyed by tenant ' +
    "and a tenant only ever writes its own bucket, so no tenant's launch history can evict " +
    "another's; `import` explicitly DISCARDS the payload's usageByTenant and leaves the live " +
    'counters alone, so a bulk import cannot destroy another tenant\'s launch history either. ' +
    'OPEN FINDING, RECORDED HERE RATHER THAN DECLARED AWAY — R10-B3A-F1: the authority above is ' +
    'true of `registry:import` and `registry:backup` and NOT of the third path into the same ' +
    'deletion. `remove()` is also reached from `nps:uninstall` → `packageService.uninstall()`, and ' +
    'that channel carries `requireAuth: true` and NO permission at all (it is absent from ' +
    'RUNTIME_CHANNEL_PERMISSIONS and from PUBLIC_CHANNELS; see the REQUIRE_AUTH_ONLY list in ' +
    'ipc/runtimeAuthz.test.ts). So any authenticated user in any organization can delete the ' +
    "install-wide catalogue row — install location, package hash, signature key id, granted " +
    'permissions, per-app config — for an application every other organization on the machine ' +
    'uses. That is strictly WEAKER than the F19/NEW-H7 class, which was an organization role over ' +
    'an install-wide resource; this is no role. Round 9 moved the two `registry:*` bulk channels ' +
    'and did not follow the same store through its `nps:*` door. The fix is one row — ' +
    "`[IpcChannel.NpsUninstall]: 'cloud:operate'` — plus the same question asked of `nps:install` " +
    'and `nps:update`, which upsert the same rows on the same `requireAuth`-only footing, and of ' +
    "`nps:rollback`, which patches them on `operations:manage`, an organization role. The " +
    'generic gate that would have caught all four already exists and is not applied to this store: ' +
    '`assertPlatformStoreChannelAuthority` in plugins/pluginAuthzGate.ts takes a store name, a ' +
    'family and its mutating channels, and `local-app-registry` should call it the way ' +
    '`plugin-install-registry` does. Calling it before the permission rows move would stop the ' +
    'application starting, so the rows move first.',
  reason:
    'WHY INSTALL_GLOBAL: there is one `registry.json` per machine, `RegistryEntry` has no tenant ' +
    'field, and the Package Service, the Runtime Supervisor and the UI all read and write the same ' +
    'map — two organizations cannot hold different versions of the same slug. WHAT DATA: install ' +
    'metadata authored by the publisher and the installer — version, channel, install location, ' +
    'package hash, signature key id, granted permissions — plus two per-user display flags ' +
    '(pinned/favorite). ROUND 9 FINDING F20: `launchCount`, `lastLaunchedAt` and `usage.*` were NOT ' +
    'install metadata. They were incremented by `supervisor.launch` on behalf of whichever ' +
    'organization was active and served install-wide through `list()` and `stats()`, so one tenant ' +
    'could read how often another had run an app and when it last did. They now live in a per-tenant ' +
    'side table and are projected onto the caller\'s own view; see `TenantUsage` and `recordLaunch`. ' +
    'CROSS-TENANT COST: an uninstall or a bulk import removes an app every organization on the ' +
    'machine uses, which is why the mutation authority is install-level rather than an org role.',
});

const log = createLogger('registry');
const SCHEMA_VERSION = 1;

export interface RegistryEntry {
  slug: string;
  name: string;
  appType: AppType;
  installedVersion: string | null;
  channel: string;
  installLocation: string | null;
  packageHash: string | null;
  signatureKeyId: string | null;
  hasSignature: boolean;
  /** Retained across an update so a rollback has a target. */
  previousVersion: string | null;
  previousPackageHash: string | null;
  grantedPermissions: RuntimePermissionKey[];
  permissionGrants: PermissionGrant[];
  launchCount: number;
  lastLaunchedAt: string | null;
  installedAt: string;
  lastUpdatedAt: string | null;
  runtimeStatus: RuntimeStatus;
  healthStatus: HealthStatus;
  diskUsageBytes: number | null;
  pinned: boolean;
  favorite: boolean;
  config: Record<string, unknown>;
  usage: { launches: number; totalActiveMs: number; lastSessionAt: string | null };
}

/**
 * ONE TENANT'S launch history for ONE installed app. P13C ROUND 9 — F20.
 *
 * The same shape `worker-registry` uses for `WorkerOutcomeCounters`, and for the
 * same reason: the package row is shared and install-level, the ACTIVITY against
 * it is not. Durable, because `launchCount` was durable before this change and
 * losing it on restart would be a regression dressed as a security fix.
 */
export interface TenantUsage {
  launchCount: number;
  lastLaunchedAt: string | null;
  totalActiveMs: number;
  lastSessionAt: string | null;
}

function emptyUsage(): TenantUsage {
  return { launchCount: 0, lastLaunchedAt: null, totalActiveMs: 0, lastSessionAt: null };
}

interface RegistryFile {
  schemaVersion: number;
  checksum: string;
  meta: { createdAt: string; updatedAt: string };
  entries: Record<string, RegistryEntry>;
  /**
   * Per-tenant launch counters. P13C ROUND 9 — F20.
   *
   * `{ [tenantId]: { [slug]: TenantUsage } }`, with `''` for an unresolved
   * writer — a partition that reaches nobody, not a shared one. Deliberately
   * OUTSIDE the checksummed `entries` map: the integrity hash exists to detect
   * out-of-band edits to what is installed and what it may do, and folding a
   * counter that changes on every app launch into it would make the hash churn
   * constantly and stop being evidence of anything.
   */
  usageByTenant?: Record<string, Record<string, TenantUsage>>;
  /**
   * PER-TENANT DISPLAY FLAGS. P13C ROUND 13 — M-13.
   *
   * `pinned` and `favorite` lived on the shared `RegistryEntry`, so tenant A
   * un-pinning an app un-pinned it for tenant B — on a channel with no auth at
   * all. The file contradicted itself about this: one comment called them
   * "shared by everyone who uses the install", another called them "per-user".
   * The storage settled it, and the storage was wrong.
   *
   * Same shape as `usageByTenant`, and deliberately so: `{ [tenantId]: { [slug]:
   * flags } }`, outside the checksummed `entries` map, with `''` for an
   * unresolved caller — a partition that reaches nobody rather than a shared one.
   *
   * LEGACY IS PRESERVED, NOT REWRITTEN. A row's own `pinned`/`favorite` stays on
   * disk and acts as the DEFAULT any tenant sees until that tenant sets its own.
   * The historical value was never attributable to an organization, so promoting
   * it to one would be inventing provenance; dropping it would silently unpin
   * every app on every existing install.
   */
  flagsByTenant?: Record<string, Record<string, { pinned?: boolean; favorite?: boolean }>>;
}

function registryPath(): string {
  return join(app.getPath('userData'), 'registry.json');
}

/** Stable stringification so the checksum is order-independent. */
function canonical(entries: Record<string, RegistryEntry>): string {
  const sorted = Object.keys(entries)
    .sort()
    .reduce<Record<string, RegistryEntry>>((acc, k) => {
      acc[k] = entries[k];
      return acc;
    }, {});
  return JSON.stringify(sorted);
}

function checksumOf(entries: Record<string, RegistryEntry>): string {
  return createHash('sha256').update(canonical(entries)).digest('hex');
}

function emptyFile(): RegistryFile {
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    checksum: checksumOf({}),
    meta: { createdAt: now, updatedAt: now },
    entries: {},
    usageByTenant: {},
    flagsByTenant: {},
  };
}

/** Forward migration hook. Each step upgrades the file in place. */
function migrate(file: RegistryFile): RegistryFile {
  const f = file;
  // if (f.schemaVersion < 2) { ...transform...; f.schemaVersion = 2; }
  f.schemaVersion = SCHEMA_VERSION;
  return f;
}

/**
 * SCOPE ANALYSIS. P13C ROUND 9 — F4/F18/F20. The declaration is at the top of
 * this file; what follows is why it says what it says.
 *
 * WHAT IT IS: one `registry.json` per machine. `RegistryEntry` has no tenant
 * field, and the Package Service, the Runtime Supervisor and the UI all read and
 * write the same map — so the scope is INSTALL_GLOBAL and the authority that
 * matches an install-wide resource is PLATFORM_OPERATOR (`cloud:operate`), the
 * same answer Round 8/9 reached for the plugin registry and the workforce
 * install lifecycle, which are the same resource class.
 *
 * ROUND 9 CLOSED THE TWO THINGS THAT MADE THAT DECLARATION FALSE:
 *
 *   - `launchCount` / `lastLaunchedAt` / `usage.*` counted WHO USED WHAT AND
 *     WHEN, install-wide. That is CUSTOMER_DERIVED, and `declareStoreScope`
 *     refuses CUSTOMER_DERIVED + INSTALL_GLOBAL — correctly. They now live in a
 *     per-tenant side table (`usageByTenant`) and are projected onto the caller's
 *     own rows, exactly as Round 8 did for `worker-registry`'s trust and health.
 *   - the bulk writes (`registry:import`, `registry:backup`) were classified
 *     `operations:manage`, an organization role over an install-wide file — the
 *     F19 class. They now require `cloud:operate`.
 *
 * WHAT REMAINS SHARED, AND IS MEANT TO: version, channel, install location,
 * package hash, signature, granted permissions and per-app `config` describe the
 * one copy of the app that exists on this machine. `pinned`/`favorite` are
 * display flags shared by everyone who uses the install; `setFlags` is a PUBLIC
 * write and the whitelist below is what keeps it reaching nothing else.
 */
class Registry {
  private file: RegistryFile = emptyFile();
  private loaded = false;
  private integrityOk = true;

  /**
   * The tenant boundary for LAUNCH COUNTERS. The catalogue stays global.
   *
   * A function, not a value: binding happens at the composition root long after
   * this module-level singleton is constructed. Unresolved answers `null`, which
   * keys the `''` bucket — a partition that reaches nobody rather than a shared
   * one, and the bucket a single-user install with no organization consistently
   * reads and writes.
   */
  private tenantIdFor: () => string | null = () => null;

  /** Bind the tenant boundary for USAGE COUNTERS. See `recordLaunch`. */
  bindUsageScope(source: () => string | null): this {
    this.tenantIdFor = source;
    return this;
  }

  private usageKey(): string {
    return this.tenantIdFor() ?? '';
  }

  /**
   * This caller's display flags for one app. P13C ROUND 13 — M-13.
   *
   * Falls back to the row's legacy value, which is the pre-M-13 shared flag and
   * is the honest default: it belonged to no organization, so it belongs to
   * every organization until one overrides it.
   */
  private flagsFor(slug: string): { pinned: boolean; favorite: boolean } {
    const own = this.file.flagsByTenant?.[this.usageKey()]?.[slug];
    const row = this.file.entries[slug];
    return {
      pinned: own?.pinned ?? row?.pinned ?? false,
      favorite: own?.favorite ?? row?.favorite ?? false,
    };
  }

  /** This caller's counters for one app. Never another caller's. */
  private usageFor(slug: string): TenantUsage {
    return this.file.usageByTenant?.[this.usageKey()]?.[slug] ?? emptyUsage();
  }

  private setUsage(slug: string, next: TenantUsage): void {
    const key = this.usageKey();
    const byTenant = (this.file.usageByTenant ??= {});
    const bucket = (byTenant[key] ??= {});
    bucket[slug] = next;
  }

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(registryPath(), 'utf8');
      const parsed = JSON.parse(raw) as RegistryFile;
      const expected = checksumOf(parsed.entries ?? {});
      this.integrityOk = expected === parsed.checksum;
      if (!this.integrityOk) {
        log.warn('Registry checksum mismatch; file may have been edited out of band');
      }
      this.file = migrate({
        schemaVersion: parsed.schemaVersion ?? 1,
        checksum: parsed.checksum,
        meta: parsed.meta ?? { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        entries: parsed.entries ?? {},
        /**
         * MIGRATION. P13C ROUND 9 — F20.
         *
         * A pre-Round-9 file has no `usageByTenant`, and its entry rows carry
         * counters that are the SUM of every tenant's launches. Those are
         * adopted by NOBODY — attributing an aggregate to whoever loads it first
         * is the "first caller claims it" fallback this program has removed
         * repeatedly. The numbers stay on the row so a backup or a downgrade is
         * not lossy, and `toDto` no longer reads them, so they are visible to no
         * organization; each tenant starts counting its own from zero.
         */
        usageByTenant: parsed.usageByTenant ?? {},
        // P13C ROUND 13 — M-13.
        flagsByTenant: parsed.flagsByTenant ?? {},
      });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.file = emptyFile();
        await this.persist();
      } else {
        log.error('Failed to read registry; starting empty', err);
        this.file = emptyFile();
      }
    }
    this.loaded = true;
    log.info('Registry loaded', { entries: Object.keys(this.file.entries).length, integrityOk: this.integrityOk });
  }

  private ensureLoaded(): void {
    if (!this.loaded) throw new Error('Registry used before load()');
  }

  private async persist(): Promise<void> {
    this.file.checksum = checksumOf(this.file.entries);
    this.file.meta.updatedAt = new Date().toISOString();
    const path = registryPath();
    await fs.mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.file, null, 2), { mode: 0o600 });
    await fs.rename(tmp, path);
  }

  /* ── reads ── */

  has(slug: string): boolean {
    return !!this.file.entries[slug];
  }
  getRaw(slug: string): RegistryEntry | null {
    return this.file.entries[slug] ?? null;
  }
  /**
   * One entry, carrying THE CALLER'S OWN launch history. P13C ROUND 9 — F20.
   *
   * The catalogue row is shared and install-level, as declared. Its
   * `launchCount`/`lastLaunchedAt`/`usage` fields were accumulating every
   * tenant's launches, so an install-wide read told one organization how often
   * another had run an app and when it last did.
   *
   * The fields are OVERLAID per caller rather than removed: removing them would
   * create a new vacuous zero for every renderer that reads them, which is the
   * same mistake in the other direction. Every existing call site keeps working
   * and now sees its own numbers, which is what each of them always meant.
   */
  get(slug: string): RegistryEntryDto | null {
    const e = this.file.entries[slug];
    return e ? toDto(e, this.usageFor(slug), this.flagsFor(slug)) : null;
  }
  list(): RegistryEntryDto[] {
    return Object.values(this.file.entries).map((e) => toDto(e, this.usageFor(e.slug), this.flagsFor(e.slug)));
  }
  isIntegrityOk(): boolean {
    return this.integrityOk;
  }

  stats(): RegistryStats {
    const entries = Object.values(this.file.entries);
    const byType: Record<string, number> = {};
    let totalDisk = 0;
    let totalLaunches = 0;
    let pinned = 0;
    let favorite = 0;
    for (const e of entries) {
      byType[e.appType] = (byType[e.appType] ?? 0) + 1;
      totalDisk += e.diskUsageBytes ?? 0;
      // P13C ROUND 9 — F20. THE CALLER'S launches, not the install's. This
      // summed every organization's, so a rising `totalLaunches` while you did
      // nothing was another organization working — the activity-volume
      // inference channel closed on `graphStore.counts` and `AiRoutingUsage`.
      totalLaunches += this.usageFor(e.slug).launchCount;
      if (e.pinned) pinned += 1;
      if (e.favorite) favorite += 1;
    }
    return {
      totalInstalled: entries.length,
      totalLaunches,
      totalDiskBytes: totalDisk,
      pinnedCount: pinned,
      favoriteCount: favorite,
      byType,
    };
  }

  /* ── writes ── */

  async upsert(entry: RegistryEntry): Promise<RegistryEntryDto> {
    this.ensureLoaded();
    this.file.entries[entry.slug] = entry;
    await this.persist();
    return toDto(entry, this.usageFor(entry.slug), this.flagsFor(entry.slug));
  }

  async patch(slug: string, fn: (e: RegistryEntry) => void): Promise<RegistryEntryDto | null> {
    this.ensureLoaded();
    const e = this.file.entries[slug];
    if (!e) return null;
    fn(e);
    await this.persist();
    return toDto(e, this.usageFor(slug), this.flagsFor(slug));
  }

  async remove(slug: string): Promise<boolean> {
    this.ensureLoaded();
    if (!this.file.entries[slug]) return false;
    delete this.file.entries[slug];
    await this.persist();
    return true;
  }

  /**
   * The two DISPLAY flags, and nothing else. P13C ROUND 9 — F4.
   *
   * THE FINDING: `registry:setFlags` is a PUBLIC write (no auth, no permission)
   * onto an install-wide file that also holds `grantedPermissions`,
   * `permissionGrants`, `packageHash`, `signatureKeyId`, `hasSignature`,
   * `installLocation` and per-app `config` — the machine's record of what is
   * installed and what it is allowed to do.
   *
   * THE VERIFICATION, on the four links between the renderer and the file:
   *
   *   1. `RegistrySetFlagsRequest` is `{ slug, pinned?, favorite? }`. Zod strips
   *      unknown keys, so no other field survives the bridge.
   *   2. `SlugSchema` constrains the slug, so the payload cannot address anything
   *      but an existing entry's key.
   *   3. `patch` returns null for an unknown slug: this call can neither create an
   *      entry nor resurrect a removed one.
   *   4. The mutation below — now an explicit whitelist rather than two
   *      incidental assignments — assigns ONLY `pinned` and `favorite`, and
   *      coerces to boolean so a truthy non-boolean cannot land in the file.
   *
   * So a public `setFlags` cannot reach a security-sensitive flag, and the
   * whitelist is what keeps that true when someone widens the caller. `persist`
   * recomputes the integrity checksum on every write, so this path also cannot be
   * used to leave the file looking tampered with.
   *
   * WHAT IS NOT CLOSED HERE, because it is not this method: the file is
   * install-wide, and its bulk writes (`registry:import`, `registry:backup`) are
   * classified `operations:manage` — an ORGANIZATION role over an install-wide
   * resource, which is the F19 class. Those channels are registered in
   * `runtimeCore.ts` and classified in `ipc/runtimeAuthz.ts`; see the round report.
   */
  private static readonly DISPLAY_FLAGS = ['pinned', 'favorite'] as const;

  /**
   * Set THIS CALLER'S display flags. P13C ROUND 13 — M-13.
   *
   * Was `patch(slug, e => e[key] = value)` — a write to the shared row, so one
   * organization's pin was every organization's pin. The payload whitelist
   * (`DISPLAY_FLAGS`) was verified in Round 9 and is preserved below; what was
   * never resolved is that the DESTINATION was install-global.
   *
   * The shared row is no longer written at all: the legacy value stays as the
   * default in `flagsFor`, and the caller's own bucket takes precedence.
   */
  async setFlags(slug: string, flags: { pinned?: boolean; favorite?: boolean }): Promise<RegistryEntryDto | null> {
    this.ensureLoaded();
    if (!this.file.entries[slug]) return null;
    const key = this.usageKey();
    const current = this.flagsFor(slug);
    const next: { pinned: boolean; favorite: boolean } = { ...current };
    for (const f of Registry.DISPLAY_FLAGS) {
      const value = flags[f];
      if (value !== undefined) next[f] = value === true;
    }
    const byTenant = { ...(this.file.flagsByTenant ?? {}) };
    byTenant[key] = { ...(byTenant[key] ?? {}), [slug]: next };
    this.file.flagsByTenant = byTenant;
    await this.persist();
    return this.get(slug);
  }

  async setRuntimeStatus(slug: string, status: RuntimeStatus): Promise<void> {
    await this.patch(slug, (e) => {
      e.runtimeStatus = status;
    });
  }
  async setHealth(slug: string, health: HealthStatus): Promise<void> {
    await this.patch(slug, (e) => {
      e.healthStatus = health;
    });
  }

  /**
   * Record a launch IN THE CALLER'S BUCKET. P13C ROUND 9 — F20.
   *
   * `e.launchCount += 1` on the shared row accumulated every organization's
   * launches onto one entry, which is why `list()` and `stats()` were a
   * cross-tenant activity meter. The catalogue row is left alone; the counters
   * advance under `usageByTenant[tenantId][slug]` and are projected back by
   * `toDto`, so every existing caller sees its own numbers.
   *
   * `supervisor.launch()` is the only production caller and it holds no tenant
   * argument — the seam is read here, from the resolver the composition root
   * bound, exactly as `worker-registry.recordOutcome` does.
   */
  async recordLaunch(slug: string): Promise<void> {
    this.ensureLoaded();
    if (!this.file.entries[slug]) return;
    const now = new Date().toISOString();
    const prev = this.usageFor(slug);
    this.setUsage(slug, {
      ...prev,
      launchCount: prev.launchCount + 1,
      lastLaunchedAt: now,
      lastSessionAt: now,
    });
    await this.persist();
  }

  async recordSessionDuration(slug: string, ms: number): Promise<void> {
    this.ensureLoaded();
    if (!this.file.entries[slug]) return;
    const prev = this.usageFor(slug);
    this.setUsage(slug, { ...prev, totalActiveMs: prev.totalActiveMs + Math.max(0, ms) });
    await this.persist();
  }

  /* ── import / export / backup / restore ── */

  /**
   * The registry as JSON, carrying ONLY THE CALLER'S usage bucket.
   *
   * P13C ROUND 9 — F20. `registry:export` is on the PUBLIC channel list, so
   * serializing the whole `usageByTenant` map would have handed every
   * organization's launch history to any renderer message — reintroducing the
   * exposure this round removed from `list()`, through a different door. The
   * export is a snapshot of what THIS caller can already see.
   */
  export(): string {
    const key = this.usageKey();
    /**
     * P13C ROUND 12 — M-10. THE ROWS ARE SCRUBBED, NOT JUST THE MAP.
     *
     * The Round 9 (F20) fix filtered `usageByTenant` to the caller's bucket and
     * spread `...this.file` for everything else — so the RAW `entries` rows went
     * out untouched, and `RegistryEntry` still carries `launchCount`,
     * `lastLaunchedAt` and `usage` as the install-wide accumulation. The exact
     * information this function deliberately withheld through one field, it
     * handed over through another.
     *
     * THE FUNCTION CONTRADICTED ITSELF, which is why this is a finding rather
     * than a judgement call about what a platform operator may see. The
     * migration note in this file states the row counters "are visible to no
     * organization" — true of `toDto`, false here. A false statement inside a
     * security declaration blinds the next reviewer exactly as a missing one
     * does.
     *
     * The rows are now projected through the SAME rule `toDto` applies: the
     * caller's own counters, never the row's accumulation. Install metadata
     * (`previousVersion`, `permissionGrants`, hashes) is deliberately KEPT — it
     * is not tenant-derived, a re-import needs it, and this channel is
     * `cloud:operate`. Stripping it would be hiding data rather than fixing a
     * boundary.
     */
    const entries: Record<string, RegistryEntry> = {};
    for (const [slug, e] of Object.entries(this.file.entries)) {
      const mine = this.file.usageByTenant?.[key]?.[slug] ?? emptyUsage();
      entries[slug] = {
        ...e,
        launchCount: mine.launchCount,
        lastLaunchedAt: mine.lastLaunchedAt,
        usage: {
          launches: mine.launchCount,
          totalActiveMs: mine.totalActiveMs,
          lastSessionAt: mine.lastSessionAt,
        },
      };
    }
    const authorized: RegistryFile = {
      ...this.file,
      entries,
      usageByTenant: { [key]: this.file.usageByTenant?.[key] ?? {} },
      /**
       * P13C ROUND 13 — M-13 ADDED A SECOND PER-TENANT MAP, SO IT GETS THE SAME
       * FILTER. `...this.file` is a spread: any new per-tenant field is exported
       * in full unless it is named here. That is exactly how M-10 happened — one
       * field filtered, another added later and forgotten — so the filter is
       * applied in the same commit that adds the field, not in the round that
       * finds it.
       */
      flagsByTenant: { [key]: this.file.flagsByTenant?.[key] ?? {} },
    };
    return JSON.stringify(authorized, null, 2);
  }

  /**
   * THE LOSSLESS SERIALIZATION. P13C ROUND 12 — M-10.
   *
   * `backup()` called `export()`, so a backup was silently SCRUBBED: it kept
   * only the taker's `usageByTenant` bucket and dropped every other
   * organization's launch history. `restore()` is `import(raw, {merge:false})`,
   * so restoring such a backup writes that loss back as fact. A backup that
   * quietly discards other tenants' data is a DATA-LOSS PATH, it existed before
   * M-10, and narrowing `export()` further would only have deepened it.
   *
   * The two callers are therefore split by intent rather than sharing one
   * function: a backup is lossless and platform-scoped; an export is what the
   * caller is authorized to receive. Private — `backup()` is the only caller.
   */
  private serializeAll(): string {
    return JSON.stringify(this.file, null, 2);
  }

  async import(data: string, opts: { merge?: boolean } = {}): Promise<number> {
    this.ensureLoaded();
    const incoming = JSON.parse(data) as RegistryFile;
    if (typeof incoming !== 'object' || !incoming.entries) {
      throw new Error('Invalid registry payload');
    }
    const next = opts.merge ? { ...this.file.entries, ...incoming.entries } : incoming.entries;
    this.file.entries = next;
    /**
     * `usageByTenant` from the payload is DISCARDED. P13C ROUND 9 — F20.
     *
     * An import replaces what is installed; it must not be a way to write into
     * another organization's counters, and a payload that named a foreign tenant
     * key would do exactly that. The live counters are left untouched — an
     * import is not a reason to destroy another tenant's launch history either.
     */
    await this.persist();
    return Object.keys(next).length;
  }

  async backup(): Promise<string> {
    const dir = join(app.getPath('userData'), 'backups');
    await fs.mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const path = join(dir, `registry-${stamp}.json`);
    // P13C ROUND 12 — M-10. LOSSLESS, not the authorized export view. A backup
    // that drops other tenants' counters restores that loss as fact.
    await fs.writeFile(path, this.serializeAll(), { mode: 0o600 });
    log.info('Registry backed up', { path });
    return path;
  }

  async restore(path: string): Promise<number> {
    const raw = await fs.readFile(path, 'utf8');
    return this.import(raw, { merge: false });
  }
}

/**
 * A DTO carrying one caller's launch history over a shared catalogue row.
 *
 * P13C ROUND 9 — F20. `usage` defaults to ZERO rather than to the row's own
 * fields, so a future caller that forgets to pass a bucket sees no activity
 * instead of the install-wide aggregate. Fail-closed on the axis that matters:
 * an under-reported count is a cosmetic bug, an over-reported one is another
 * organization's activity.
 */
export function toDto(
  e: RegistryEntry,
  usage: TenantUsage = emptyUsage(),
  /**
   * P13C ROUND 13 — M-13. The CALLER'S display flags. Defaults to the row's own
   * legacy values so an existing caller of this function is unchanged, and so a
   * future caller that forgets to pass a bucket shows the shared default rather
   * than someone else's choice.
   */
  flags: { pinned: boolean; favorite: boolean } = { pinned: e.pinned, favorite: e.favorite },
): RegistryEntryDto {
  return {
    slug: e.slug,
    name: e.name,
    appType: e.appType,
    installedVersion: e.installedVersion,
    channel: e.channel,
    installLocation: e.installLocation,
    packageHash: e.packageHash,
    signatureKeyId: e.signatureKeyId,
    hasSignature: e.hasSignature,
    grantedPermissions: e.grantedPermissions,
    // The CALLER'S counters, never the row's install-wide accumulation.
    launchCount: usage.launchCount,
    lastLaunchedAt: usage.lastLaunchedAt,
    installedAt: e.installedAt,
    lastUpdatedAt: e.lastUpdatedAt,
    runtimeStatus: e.runtimeStatus,
    healthStatus: e.healthStatus,
    diskUsageBytes: e.diskUsageBytes,
    pinned: flags.pinned,
    favorite: flags.favorite,
    config: e.config,
    usage: {
      launches: usage.launchCount,
      totalActiveMs: usage.totalActiveMs,
      lastSessionAt: usage.lastSessionAt,
    },
  };
}

export const registry = new Registry();
