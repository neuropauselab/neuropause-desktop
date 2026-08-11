/**
 * The multi-tenant runtime store. Organizations → tenants → regions, with
 * projects, teams, AI worker assignments, and per-tenant storage isolation.
 *
 * The local organization is the **home tenant**; a set of demo tenants in other
 * regions models the wider cloud (an honest seam — they are seeded fixtures, not
 * real remote tenants). Storage isolation is modeled as a per-tenant namespace +
 * encryption key id + region/residency descriptor. Electron-free.
 */
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type {
  CloudProject,
  CloudRegion,
  CloudRegionId,
  CloudTeam,
  CloudTenant,
  StorageIsolation,
  TenantStatus,
  TenantSummary,
  TenantTier,
  TenantWorker,
} from '@neuropause/shared';
import { createLogger } from '../../logger';
import { demoSeedsEnabled } from '../../demoSeed';
import type { TenantScope } from '@neuropause/shared';
import { TenantOwnership } from '../../tenancy/tenantOwnedStore';
import { declareStoreScope } from '../../tenancy/storeScope';

/**
 * P13C ROUND 9 — F17 SWEEP. The structural declaration this store never made.
 *
 * It held a `TenantOwnership`, so the tenant registry could see it and the
 * startup gate covered it; what it never stated was the richer declaration —
 * classification and, above all, RETENTION, which is the half that has hidden
 * six install-wide caps in this program. Stating it is cheap and the answer is
 * good: nothing here prunes.
 */
declareStoreScope({
  name: 'cloud-tenancy',
  scope: 'TENANT',
  persistence: 'file',
  authority: 'ORG_ROLE',
  classification: 'CUSTOMER_DERIVED',
  /** P13C ROUND 10 — the checkable form of the prose below. */
  retentionScope: 'OWNER',
  retentionAuthority: 'OWNER',
  retention:
    'No cap and no time-based eviction — nothing is ever evicted to make room, so no tenant\'s ' +
    'volume can reach another\'s rows. TWO removals, each named. `deleteProject(id)` resolves the ' +
    'project FIRST and then checks `ownsTenant(project.tenantId)`, so a bare renderer-supplied id ' +
    'that names another organization\'s project returns false and deletes nothing. ' +
    '`syncHomeWorkers` replaces AI-worker rows at boot and its sweep is filtered on ' +
    '`w.tenantId === this.homeTenantId`, so it touches exactly one tenant\'s workers and immediately ' +
    'rewrites them from that same tenant\'s live workforce — it is a replace, not a cap, and there ' +
    'is no id, count or payload that can widen it.',
  reason:
    "Organization names, projects, teams, AI worker assignments and per-tenant storage namespaces " +
    'and key ids. Reads resolve the caller through CloudTenant.organizationId rather than the ' +
    'seeded home tenant (F10), so every accessor answers about the asking organization. Binding is ' +
    'asserted by the TenantOwnership this class holds (`assertAllTenantStoresBound`), so no second ' +
    'predicate is declared here that could drift from it.',
});

const log = createLogger('cloud-tenancy');

export const CLOUD_REGIONS: CloudRegion[] = [
  { id: 'us-east', name: 'US East (Virginia)', residency: 'us', available: true },
  { id: 'us-west', name: 'US West (Oregon)', residency: 'us', available: true },
  { id: 'eu-west', name: 'EU West (Ireland)', residency: 'eu', available: true },
  { id: 'eu-central', name: 'EU Central (Frankfurt)', residency: 'eu', available: true },
  { id: 'ap-south', name: 'Asia Pacific (Mumbai)', residency: 'apac', available: true },
  { id: 'ap-southeast', name: 'Asia Pacific (Singapore)', residency: 'apac', available: true },
];

function residencyOf(regionId: CloudRegionId): CloudRegion['residency'] {
  return CLOUD_REGIONS.find((r) => r.id === regionId)?.residency ?? 'us';
}

interface TenancyFile {
  tenants: CloudTenant[];
  projects: CloudProject[];
  teams: CloudTeam[];
  workers: TenantWorker[];
  isolation: StorageIsolation[];
  seeded: boolean;
}

interface DemoTenant {
  name: string;
  slug: string;
  regionId: CloudRegionId;
  tier: TenantTier;
  projects: string[];
  teams: { name: string; members: number }[];
  workers: { name: string; role: string }[];
  objects: number;
  bytes: number;
}

const DEMO_TENANTS: DemoTenant[] = [
  {
    name: 'Helios Commerce',
    slug: 'helios',
    regionId: 'eu-west',
    tier: 'enterprise',
    projects: ['Storefront', 'Fulfillment'],
    teams: [{ name: 'Platform', members: 12 }, { name: 'Data', members: 6 }],
    workers: [{ name: 'Catalog Analyst', role: 'operations' }, { name: 'Order Watcher', role: 'support' }],
    objects: 184_320,
    bytes: 5_637_144_576,
  },
  {
    name: 'Aperture Capital',
    slug: 'aperture',
    regionId: 'us-west',
    tier: 'enterprise',
    projects: ['Close', 'Runway'],
    teams: [{ name: 'Finance Ops', members: 8 }],
    workers: [{ name: 'Close Analyst', role: 'finance' }, { name: 'Runway Forecaster', role: 'finance' }],
    objects: 96_010,
    bytes: 2_415_919_104,
  },
  {
    name: 'Northwind Labs',
    slug: 'northwind',
    regionId: 'ap-south',
    tier: 'business',
    projects: ['Onboarding'],
    teams: [{ name: 'People Ops', members: 4 }],
    workers: [{ name: 'Onboarding Assistant', role: 'operations' }],
    objects: 41_233,
    bytes: 901_775_360,
  },
];

export class TenancyStore extends EventEmitter {
  /**
   * P13C ROUND 5 — F10. THE TENANT BOUNDARY, AND THE IDENTITY MAPPING IT NEEDS.
   *
   * TWO ID SPACES, AND THE OLD CODE COMPARED THEM DIRECTLY.
   *
   *   ORGANIZATION id — `org_<uuid>` (or the seeded `org-default`). This is what
   *                     `TenantScope.tenantId` holds and what every other store
   *                     in this application means by "tenant".
   *   CLOUD TENANT id — `tnt_<uuid>`. An infrastructure record id, minted here.
   *
   * They never intersect. `callerTenantId()` in `cloud/index.ts` returns the
   * ORGANIZATION id and it was passed straight into `listProjects(tenantId)`,
   * which filters on the `tnt_` id — so those accessors always returned `[]` and
   * every write always failed. Fail-closed, which is why nothing broke visibly,
   * and dead code, which is worse than it sounds: **any isolation test of the
   * form "B cannot read A's project" passed vacuously.** The N4 remediation
   * documented directly below was real work that has never actually run.
   *
   * `CloudTenant.organizationId` is the mapping and it was already on the
   * record. Resolving through it makes the scoped half live for the first time.
   *
   * Meanwhile the accessors that DID return data — `listTenants`,
   * `listIsolation` — were install-wide on `cloud:read`: every organization's
   * name, region, storage namespace and encryption key id.
   */
  private readonly tenancy = new TenantOwnership('cloud-tenancy');

  /** Bind the tenant boundary. UNBOUND DENIES. Chainable. */
  bindScope(source: () => TenantScope | null): this {
    this.tenancy.bindScope(source);
    return this;
  }
  hasScope(): boolean {
    return this.tenancy.hasScope();
  }

  /**
   * THE MAPPING. The caller's ORGANIZATION id → the cloud tenant rows it owns.
   *
   * Returns a set rather than one id because nothing in the model forbids an
   * organization having more than one cloud tenant, and silently taking the
   * first would be the `organizations[0]` mistake in a new place.
   */
  private callerTenantIds(): Set<string> {
    const orgId = this.tenancy.scopeOrDeny()?.tenantId ?? null;
    const out = new Set<string>();
    if (orgId === null || orgId === '') return out;
    for (const t of this.tenants.values()) if (t.organizationId === orgId) out.add(t.id);
    return out;
  }

  /** Whether a `tnt_` id belongs to the caller's organization. The one check. */
  private ownsTenant(tenantId: string): boolean {
    return this.callerTenantIds().has(tenantId);
  }

  /** Unscoped ownership counts, for the migration inventory. */
  ownershipCounts(): { total: number; assigned: number; unresolved: number } {
    return this.tenancy.countOwnership(
      [...this.tenants.values()].map((t) => ({ tenantId: t.organizationId })),
    );
  }

  private tenants = new Map<string, CloudTenant>();
  private projects = new Map<string, CloudProject>();
  private teams = new Map<string, CloudTeam>();
  private workers = new Map<string, TenantWorker>();
  private isolation = new Map<string, StorageIsolation>();
  private homeTenantId = '';

  private loaded = false;
  private persisting = false;
  private dirty = false;
  private lastPersist: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string, private readonly localOrgId: string, private readonly localOrgName: string) {
    super();
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const data = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as Partial<TenancyFile>;
      for (const t of data.tenants ?? []) if (t?.id) this.tenants.set(t.id, t);
      for (const p of data.projects ?? []) if (p?.id) this.projects.set(p.id, p);
      for (const t of data.teams ?? []) if (t?.id) this.teams.set(t.id, t);
      for (const w of data.workers ?? []) if (w?.id) this.workers.set(w.id, w);
      for (const i of data.isolation ?? []) if (i?.tenantId) this.isolation.set(i.tenantId, i);
      if (!data.seeded || this.tenants.size === 0) this.applySeed();
    } catch {
      this.applySeed();
    }
    const home = [...this.tenants.values()].find((t) => t.isHome);
    this.homeTenantId = home?.id ?? '';
    this.loaded = true;
    log.info('Cloud tenancy ready', { tenants: this.tenants.size, regions: CLOUD_REGIONS.length, projects: this.projects.size });
  }

  private applySeed(): void {
    const now = Date.now();
    // Demo fixtures (sample remote tenants + sample home-storage figures) only exist when demo seeds are
    // explicitly enabled. In a production install the home tenant is the ONLY tenant, created now, with a
    // real (zero-until-measured) storage footprint — no fabricated tenants or storage numbers.
    const demo = demoSeedsEnabled();
    // Home tenant from the local org
    const homeId = `tnt_${randomUUID()}`;
    this.tenants.set(homeId, {
      id: homeId,
      name: this.localOrgName,
      slug: this.localOrgName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      organizationId: this.localOrgId,
      regionId: 'us-east',
      tier: 'enterprise',
      status: 'active',
      isHome: true,
      storageNamespace: `np-${this.localOrgId}`,
      createdAt: new Date(demo ? now - 120 * 86_400_000 : now).toISOString(),
    });
    this.isolation.set(homeId, {
      tenantId: homeId,
      tenantName: this.localOrgName,
      namespace: `np-${this.localOrgId}`,
      encryptionKeyId: `kms_${randomUUID().slice(0, 12)}`,
      regionId: 'us-east',
      residency: 'us',
      objects: demo ? 12_840 : 0,
      bytes: demo ? 318_767_104 : 0,
    });

    if (!demo) {
      this.schedulePersist();
      return;
    }

    for (const d of DEMO_TENANTS) {
      const id = `tnt_${randomUUID()}`;
      this.tenants.set(id, {
        id,
        name: d.name,
        slug: d.slug,
        organizationId: `org-${d.slug}`,
        regionId: d.regionId,
        tier: d.tier,
        status: 'active',
        isHome: false,
        storageNamespace: `np-${d.slug}`,
        createdAt: new Date(now - Math.floor(Math.random() * 200 + 30) * 86_400_000).toISOString(),
      });
      this.isolation.set(id, {
        tenantId: id,
        tenantName: d.name,
        namespace: `np-${d.slug}`,
        encryptionKeyId: `kms_${randomUUID().slice(0, 12)}`,
        regionId: d.regionId,
        residency: residencyOf(d.regionId),
        objects: d.objects,
        bytes: d.bytes,
      });
      for (const name of d.projects) {
        const pid = `prj_${randomUUID()}`;
        this.projects.set(pid, { id: pid, tenantId: id, name, key: name.slice(0, 4).toUpperCase(), description: '', createdAt: new Date(now).toISOString() });
      }
      for (const team of d.teams) {
        const tid = `tem_${randomUUID()}`;
        this.teams.set(tid, { id: tid, tenantId: id, name: team.name, memberCount: team.members, createdAt: new Date(now).toISOString() });
      }
      for (const w of d.workers) {
        const wid = `twk_${randomUUID()}`;
        this.workers.set(wid, { id: wid, tenantId: id, workerId: wid, name: w.name, role: w.role });
      }
    }
    this.schedulePersist();
  }

  private async persist(): Promise<void> {
    const tmp = `${this.filePath}.tmp`;
    const payload: TenancyFile = {
      tenants: [...this.tenants.values()],
      projects: [...this.projects.values()],
      teams: [...this.teams.values()],
      workers: [...this.workers.values()],
      isolation: [...this.isolation.values()],
      seeded: true,
    };
    await fs.writeFile(tmp, JSON.stringify(payload), { mode: 0o600 });
    await fs.rename(tmp, this.filePath);
  }
  private schedulePersist(): void {
    this.dirty = true;
    if (this.persisting) return;
    this.persisting = true;
    this.lastPersist = this.drain();
  }
  private async drain(): Promise<void> {
    try {
      while (this.dirty) {
        this.dirty = false;
        await this.persist();
      }
    } catch (err) {
      log.error('Tenancy persist failed', { error: String(err) });
    } finally {
      this.persisting = false;
    }
  }
  async flush(): Promise<void> {
    while (this.persisting) await this.lastPersist;
  }

  /**
   * The INSTALL'S home cloud tenant. BOOT ONLY.
   *
   * P13C ROUND 6 — classified rather than scoped, because at composition there
   * is no caller whose scope could be consulted: `activeTenantScope()` is null
   * and `homeTenantForCaller()` would return null too. Reading `isHome` is the
   * only thing that CAN work there.
   *
   * The defect was never this accessor. It was that its result was frozen into
   * two downstream stores and then used as their only notion of tenant forever.
   * Those stores now resolve the caller themselves; this is used once, at boot,
   * to seed them.
   *
   * ANY per-request caller wants `homeTenantForCaller()`.
   */
  homeTenant(): CloudTenant | null {
    return this.tenants.get(this.homeTenantId) ?? null;
  }
  regions(): CloudRegion[] {
    return CLOUD_REGIONS;
  }
  /** The CALLER'S cloud tenants. Was every organization's, on `cloud:read`. */
  listTenants(): CloudTenant[] {
    const mine = this.callerTenantIds();
    return [...this.tenants.values()]
      .filter((t) => mine.has(t.id))
      .sort((a, b) => (a.isHome ? -1 : b.isHome ? 1 : a.name.localeCompare(b.name)));
  }
  /**
   * The CALLER'S home cloud tenant.
   *
   * P13C ROUND 5, SECOND PASS. `cloud/index.ts` resolved the caller's cloud
   * tenant as `listTenants()[0]`, and `listTenants` sorts home first — so for
   * the seeded organization `[0]` was always the home tenant, `setTenantStatus`
   * refuses home, and that channel could never succeed. Any second cloud tenant
   * that organization provisioned was invisible to every project and team
   * surface.
   *
   * The mapping helper below returns a SET and its own comment warns against
   * "silently taking the first" — and the caller then took the first. Named
   * explicitly here so the intent is in the signature rather than in an index.
   */
  homeTenantForCaller(): CloudTenant | null {
    const mine = this.listTenants();
    return mine.find((t) => t.isHome) ?? mine[0] ?? null;
  }

  /** One cloud tenant, IF the caller's organization owns it. */
  tenant(id: string): CloudTenant | null {
    const t = this.tenants.get(id) ?? null;
    return t !== null && this.ownsTenant(id) ? t : null;
  }
  /**
   * P13C REMEDIATION — N4. AN ABSENT TENANT MEANS NOTHING, NOT EVERYTHING.
   *
   * These three took `tenantId?: string` and, when it was undefined, returned
   * EVERY tenant's rows. The IPC schema (`ByTenant`) makes the field optional,
   * so `{}` was a valid payload — and `{}` was the bypass: a caller who simply
   * omitted the field received every tenant's projects, teams and workers. The
   * `cloud:read` permission on those channels is a capability check, not a
   * membership check, so it did not narrow anything.
   *
   * Requiring the argument makes the caller name a tenant, and the handlers now
   * resolve that name from the session rather than the payload. An empty or
   * absent id yields an empty list: the fail-closed reading of "which tenant?"
   * with no answer.
   */
  listProjects(tenantId: string): CloudProject[] {
    if (!tenantId || !this.ownsTenant(tenantId)) return [];
    return [...this.projects.values()]
      .filter((p) => p.tenantId === tenantId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  listTeams(tenantId: string): CloudTeam[] {
    if (!tenantId || !this.ownsTenant(tenantId)) return [];
    return [...this.teams.values()]
      .filter((t) => t.tenantId === tenantId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  listWorkers(tenantId: string): TenantWorker[] {
    if (!tenantId || !this.ownsTenant(tenantId)) return [];
    return [...this.workers.values()].filter((w) => w.tenantId === tenantId);
  }
  /**
   * The CALLER'S storage isolation records.
   *
   * The sharpest of the install-wide reads: `namespace` and `encryptionKeyId`
   * are infrastructure identifiers for another customer's data at rest.
   */
  listIsolation(): StorageIsolation[] {
    const mine = this.callerTenantIds();
    return [...this.isolation.values()]
      .filter((i) => mine.has(i.tenantId))
      .sort((a, b) => b.bytes - a.bytes);
  }

  /**
   * Counts over the CALLER'S cloud footprint.
   *
   * P13C ROUND 6 — HALF OF IT WAS STILL AN INSTALL-WIDE CENSUS, under a header
   * that said it was not. `tenants`/`active`/`regions` went through the scoped
   * `listTenants()`; `projects`, `teams` and `workers` read `.size` off the raw
   * Maps while `listProjects`/`listTeams`/`listWorkers` twenty lines above are
   * all `ownsTenant`-gated.
   *
   * This is the third summary-beside-a-scoped-listing found in one review
   * (`federationStore.summary`, `apiPlatformStore.summary`, this). The pattern
   * is now explicit: WHEN A LISTING IS SCOPED, EVERY AGGREGATE OVER THE SAME
   * COLLECTION MUST BE SCOPED IN THE SAME COMMIT. Reviewers check the listing
   * because it returns the records; the count is read as harmless and it is the
   * same query with the rows dropped.
   */
  summary(): TenantSummary {
    const tenants = this.listTenants();
    return {
      tenants: tenants.length,
      active: tenants.filter((t) => t.status === 'active').length,
      regions: new Set(tenants.map((t) => t.regionId)).size,
      // Summed over the caller's OWN tenants — `listProjects`/`listTeams`/
      // `listWorkers` are per cloud tenant and `ownsTenant`-gated, so this is the
      // same authorization the listings enforce, applied once per owned tenant.
      projects: tenants.reduce((n, t) => n + this.listProjects(t.id).length, 0),
      teams: tenants.reduce((n, t) => n + this.listTeams(t.id).length, 0),
      workers: tenants.reduce((n, t) => n + this.listWorkers(t.id).length, 0),
    };
  }

  /**
   * Provision a cloud tenant FOR THE CALLER'S ORGANIZATION.
   *
   * `organizationId` was derived from the display NAME — `org-${slug}` — so a
   * newly provisioned tenant belonged to an organization that generally did not
   * exist, and belonged to the CALLER never. Under the new mapping that would
   * make every provisioned tenant immediately invisible to the person who
   * provisioned it, so this is both the security fix and the thing that makes
   * the feature work.
   *
   * A name-derived organization id is also how a caller could have addressed
   * somebody else's organization by typing their name, which is the same defect
   * federation's `inviteOrg` still has.
   */
  createTenant(input: { name: string; regionId: CloudRegionId; tier: TenantTier }): CloudTenant {
    const organizationId = this.tenancy.requireTenant();
    const id = `tnt_${randomUUID()}`;
    const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const tenant: CloudTenant = {
      id,
      name: input.name,
      slug,
      organizationId,
      regionId: input.regionId,
      tier: input.tier,
      status: 'provisioning',
      isHome: false,
      storageNamespace: `np-${slug}`,
      createdAt: new Date().toISOString(),
    };
    this.tenants.set(id, tenant);
    this.isolation.set(id, {
      tenantId: id,
      tenantName: input.name,
      namespace: `np-${slug}`,
      encryptionKeyId: `kms_${randomUUID().slice(0, 12)}`,
      regionId: input.regionId,
      residency: residencyOf(input.regionId),
      objects: 0,
      bytes: 0,
    });
    this.schedulePersist();
    this.emit('changed');
    return tenant;
  }

  /** Suspend or resume one of the CALLER'S cloud tenants. Was a bare id. */
  setTenantStatus(id: string, status: TenantStatus): CloudTenant | null {
    const t = this.tenants.get(id);
    if (!t || t.isHome || !this.ownsTenant(id)) return null;
    const next: CloudTenant = { ...t, status };
    this.tenants.set(id, next);
    this.schedulePersist();
    this.emit('changed');
    return next;
  }

  createProject(input: { tenantId: string; name: string; description?: string }): CloudProject | null {
    if (!this.ownsTenant(input.tenantId)) return null;
    const id = `prj_${randomUUID()}`;
    const project: CloudProject = {
      id,
      tenantId: input.tenantId,
      name: input.name,
      key: input.name.slice(0, 4).toUpperCase(),
      description: input.description ?? '',
      createdAt: new Date().toISOString(),
    };
    this.projects.set(id, project);
    this.schedulePersist();
    this.emit('changed');
    return project;
  }

  /** Delete one of the CALLER'S projects. Was `projects.delete(id)` on a bare id. */
  deleteProject(id: string): boolean {
    const project = this.projects.get(id) ?? null;
    if (project === null || !this.ownsTenant(project.tenantId)) return false;
    const ok = this.projects.delete(id);
    if (ok) {
      this.schedulePersist();
      this.emit('changed');
    }
    return ok;
  }

  createTeam(input: { tenantId: string; name: string }): CloudTeam | null {
    if (!this.ownsTenant(input.tenantId)) return null;
    const id = `tem_${randomUUID()}`;
    const team: CloudTeam = { id, tenantId: input.tenantId, name: input.name, memberCount: 0, createdAt: new Date().toISOString() };
    this.teams.set(id, team);
    this.schedulePersist();
    this.emit('changed');
    return team;
  }

  /** Fold the live workforce workers onto the home tenant (idempotent). */
  syncHomeWorkers(refs: { workerId: string; name: string; role: string }[]): void {
    if (!this.homeTenantId) return;
    for (const w of this.workers.values()) if (w.tenantId === this.homeTenantId) this.workers.delete(w.id);
    for (const ref of refs) {
      const id = `twk_${ref.workerId}`;
      this.workers.set(id, { id, tenantId: this.homeTenantId, workerId: ref.workerId, name: ref.name, role: ref.role });
    }
    this.schedulePersist();
  }
}
