/**
 * The Developer registry: developer accounts, API keys, OAuth applications, and
 * the raw usage ledger. API key + OAuth secrets are high-entropy tokens; only a
 * SHA-256 hash is persisted, and the clear secret is returned exactly once at
 * creation. Electron-free; the singleton lives in developerInstance.ts.
 *
 * P13C ROUND 3 — H-3. THE WHOLE STORE WAS ONE PARTITION.
 *
 * There is exactly one developer account on an install — `dev-owner`, seeded to
 * the literal `ORG_ID` — and every key, application and usage row hangs off its
 * `developerId`. So `keysFor(devId())` was every tenant's keys, `appsFor` was
 * every tenant's OAuth applications, and the analytics window was every tenant's
 * traffic. Three consequences, and only the first is disclosure:
 *
 *   READ    — key names, prefixes, last4, scopes and last-used times; OAuth
 *             client ids, redirect URIs and grant types. That is a map of
 *             another organization's integrations.
 *   REVOKE  — `revokeKey(id)` and `deleteApp(id)` took a BARE payload id and
 *             deleted whatever it named. One tenant could cut another tenant's
 *             production API access, and an OAuth application deletion is not
 *             recoverable: the client secret existed exactly once.
 *   BILLING — usage rows drive the metered invoice, so one tenant's traffic was
 *             counted against another's quota and period spend.
 *
 * The fix is an owner on the row, not a check in the handler, because these
 * accessors are reached from the ecosystem IPC surface, the developer-platform
 * projection AND the marketplace publisher lookup. A handler check would have to
 * be right in three places and stay right in the fourth somebody adds.
 *
 * WHAT DELIBERATELY STAYS UNSCOPED — and why that is not a hole. `verifyKey`,
 * `verifyAppCredentials`, `revokeToken` and `isTokenRevoked` resolve a PRESENTED
 * CREDENTIAL. They run before any tenant is known — resolving the credential is
 * what would establish one — so a scoped lookup there could only ever deny.
 * They are named for what they are and answer no listing.
 */
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import type {
  ApiKey,
  ApiKeyWithSecret,
  ApiScope,
  DeveloperAccount,
  OAuthApplication,
  OAuthApplicationWithSecret,
  OAuthGrantType,
  PlanTier,
  TenantScope,
  UsageRecord,
} from '@neuropause/shared';
import { TenantOwnership } from '../../tenancy/tenantOwnedStore';
import { createLogger } from '../../logger';
import { declareStoreScope } from '../../tenancy/storeScope';

/**
 * P13C ROUND 10 — THE RETENTION DECLARATION THIS FILE COULD NOT MAKE.
 *
 * The store satisfied the scope gate by holding a `TenantOwnership`, which takes
 * no retention argument. This file has its own history in the class, and it is
 * the sharpest version of it in the program: the usage cap was install-wide and
 * oldest-first, so a high-traffic tenant chose which of ANOTHER tenant's billing
 * rows was destroyed — and the first attempt at the fix left an install-wide
 * `slice(length - USAGE_CAP)` FALLBACK after the per-tenant prune, which with two
 * tenants at 12,000 rows each did the entire original damage while the per-tenant
 * prune above it was a no-op. See `recordUsage`.
 */
declareStoreScope({
  name: 'ecosystem-developer',
  scope: 'TENANT',
  persistence: 'file',
  authority: 'ORG_ROLE',
  classification: 'CUSTOMER_DERIVED',
  retentionScope: 'OWNER',
  retentionAuthority: 'OWNER',
  retention:
    'ONE cap and TWO single-row removals, plus one entry that belongs to nobody. The cap is ' +
    '`recordUsage` → `tenancy.pruneOwn(usage, PER_TENANT_USAGE_CAP (20,000), oldest-first)`, which ' +
    'counts and evicts within the writing tenant only and has NOTHING after it. Keys and OAuth ' +
    'applications are never capped: `revokeKey` marks `revokedAt` and removes nothing, and ' +
    '`deleteApp(id)` requires `tenancy.mine(app)` first — it was `apps.delete(id)` on a bare payload ' +
    'id, the sharpest write in the file, because an OAuth client secret existed exactly once and ' +
    'cannot be reissued. THE ONE ROW THAT IS NOBODY\'S, stated rather than averaged away: ' +
    '`isTokenRevoked(jti)` deletes a revocation entry once it has EXPIRED. That map is the ' +
    'credential-resolution surface the file header names as deliberately unscoped — it runs before ' +
    'any tenant is established — but the removal cannot reach another owner in any meaningful sense: ' +
    'it deletes exactly the entry for a jti the caller has PRESENTED (and therefore holds), only ' +
    'after that token has expired, at which point the revocation is a no-op. No volume, id or ' +
    'payload widens it.',
  reason:
    "One organization's API keys (name, prefix, last4, scopes, last-used), its OAuth applications " +
    '(client ids, redirect URIs, grant types) and its raw usage ledger. There is exactly one ' +
    'developer ACCOUNT on an install — a display identity — and every key, application and usage ' +
    'row used to hang off it, so `keysFor(devId())` was every tenant\'s keys and the usage rows ' +
    "drove another tenant's metered invoice. The owner is on the ROW rather than in the handler " +
    'because these accessors are reached from the ecosystem IPC surface, the developer-platform ' +
    'projection AND the marketplace publisher lookup. Binding is asserted by the TenantOwnership ' +
    'this class holds.',
});

const log = createLogger('developer-registry');
/**
 * Usage retention, PER TENANT.
 *
 * Was one install-wide cap of 20 000. Kept at the same number per tenant rather
 * than divided by a tenant count, because dividing would mean adding a customer
 * silently shortens every existing customer's billing history.
 */
const PER_TENANT_USAGE_CAP = 20_000;

interface StoredKey extends ApiKey {
  hash: string;
}
interface StoredApp extends OAuthApplication {
  secretHash: string;
}
interface DevFile {
  developers: DeveloperAccount[];
  /** P13C Round 4 — per-organization plan tiers. Absent in pre-Round-4 files. */
  plans?: Array<{ tenantId: string; planTier: PlanTier }>;
  keys: StoredKey[];
  apps: StoredApp[];
  usage: UsageRecord[];
  /** P3.0 — revoked access-token jtis with their expiry (pruned once expired). */
  revokedTokens: Array<{ jti: string; expMs: number }>;
  seeded: boolean;
}

export interface SeedDeveloper {
  id: string;
  name: string;
  email: string;
  organization: string;
  orgId: string;
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/**
 * First-claim-wins coherence for the developer portal's owner label. The single
 * `dev-owner` account's display identity mirrors the enterprise *claimed* owner
 * (its documented source of truth — see the note in developerInstance). Returns
 * the identity to apply, or `null` to keep the seeded placeholder while the
 * workspace owner is still unclaimed (`email === null`). Display metadata only:
 * access to every ecosystem channel is governed by the enterprise RBAC spine
 * (see ecosystemAuthz), never by this account's identity.
 */
export function developerOwnerIdentity(
  owner: { name: string; email: string | null } | null,
): { name: string; email: string } | null {
  if (!owner || owner.email === null) return null;
  return { name: owner.name, email: owner.email };
}

export class DeveloperStore extends EventEmitter {
  /** The tenant boundary. Registered with the startup gate by construction. */
  private readonly tenancy = new TenantOwnership('ecosystem-developer');
  private developers = new Map<string, DeveloperAccount>();
  private keys = new Map<string, StoredKey>();
  private apps = new Map<string, StoredApp>();
  private usage: UsageRecord[] = [];
  /**
   * API plan tier PER ORGANIZATION.
   *
   * Beside the shared developer account rather than on it: the account is one
   * display identity for the install, and an entitlement is not a display
   * property. Absent means Free, so a new organization starts at the safe tier
   * rather than inheriting whatever the last one set.
   */
  private planByTenant = new Map<string, PlanTier>();
  /** P3.0 — revoked access-token jtis → expiry (ms). Pruned on read + load. */
  private revokedTokens = new Map<string, number>();
  private loaded = false;
  private persisting = false;
  private dirty = false;
  private lastPersist: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string, private readonly seed: SeedDeveloper) {
    super();
  }

  /** Bind the tenant boundary. UNBOUND DENIES. Chainable. */
  bindScope(source: () => TenantScope | null): this {
    this.tenancy.bindScope(source);
    return this;
  }
  hasScope(): boolean {
    return this.tenancy.hasScope();
  }
  /** Unscoped ownership counts across keys + apps + usage, for the inventory only. */
  ownershipCounts(): { total: number; assigned: number; unresolved: number } {
    return this.tenancy.countOwnership([
      ...this.keys.values(),
      ...this.apps.values(),
      ...this.usage,
    ]);
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const data = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as Partial<DevFile>;
      for (const d of data.developers ?? []) if (d?.id) this.developers.set(d.id, d);
      for (const k of data.keys ?? []) if (k?.id) this.keys.set(k.id, k);
      for (const a of data.apps ?? []) if (a?.id) this.apps.set(a.id, a);
      this.usage = Array.isArray(data.usage) ? data.usage : [];
      for (const p of data.plans ?? []) if (p?.tenantId) this.planByTenant.set(p.tenantId, p.planTier);
      const now = Date.now();
      for (const t of data.revokedTokens ?? []) if (t?.jti && t.expMs > now) this.revokedTokens.set(t.jti, t.expMs);
      if (!data.seeded || this.developers.size === 0) this.applySeed();
    } catch {
      this.applySeed();
    }
    this.loaded = true;
    log.info('Developer registry ready', { developers: this.developers.size, keys: this.keys.size, apps: this.apps.size });
  }

  private applySeed(): void {
    if (!this.developers.has(this.seed.id)) {
      this.developers.set(this.seed.id, {
        id: this.seed.id,
        name: this.seed.name,
        email: this.seed.email,
        organization: this.seed.organization,
        orgId: this.seed.orgId,
        planTier: 'free',
        status: 'active',
        createdAt: new Date().toISOString(),
      });
    }
    this.schedulePersist();
  }

  private async persist(): Promise<void> {
    const file: DevFile = {
      developers: [...this.developers.values()],
      keys: [...this.keys.values()],
      apps: [...this.apps.values()],
      usage: this.usage,
      plans: [...this.planByTenant.entries()].map(([tenantId, planTier]) => ({ tenantId, planTier })),
      revokedTokens: [...this.revokedTokens.entries()].map(([jti, expMs]) => ({ jti, expMs })),
      seeded: true,
    };
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(file), { mode: 0o600 });
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
      log.error('Developer persist failed', { error: String(err) });
    } finally {
      this.persisting = false;
    }
  }
  async flush(): Promise<void> {
    while (this.persisting) await this.lastPersist;
  }

  /* ── developers ── */

  /**
   * The install's developer account, with the CALLER'S plan tier.
   *
   * The identity is shared (one portal account per install) and the entitlement
   * is not. Overlaying the tenant's plan here means every existing reader —
   * the dashboard, the billing summary, the gateway — gets the right tier
   * without each having to remember to ask separately.
   */
  defaultDeveloper(): DeveloperAccount {
    const base = this.developers.get(this.seed.id) ?? [...this.developers.values()][0];
    return { ...base, planTier: this.planFor() };
  }
  developer(id: string): DeveloperAccount | null {
    return this.developers.get(id) ?? null;
  }
  setOwnerIdentity(name: string, email: string): void {
    const d = this.developers.get(this.seed.id);
    if (d && (d.name !== name || d.email !== email)) {
      this.developers.set(this.seed.id, { ...d, name, email });
      this.schedulePersist();
      this.emit('changed');
    }
  }
  /**
   * The CALLER'S API plan tier, and its gateway limits.
   *
   * P13C ROUND 4 — the last cross-tenant WRITE on this surface. Round 3 gave
   * keys, applications and usage rows an owner but left the single `dev-owner`
   * ACCOUNT shared, and `runGateway` derives every request's rate limit and
   * quota from `developer.planTier`. So one tenant calling
   * `ecosystem:developer.setPlan` with `'free'` collapsed ANOTHER tenant's
   * production API limits — a cross-tenant denial of service through a config
   * write, which is why it is not merely a fairness issue.
   *
   * Plan tier is now held PER ORGANIZATION rather than on the shared account.
   * The account keeps its display identity, which is what it was actually for;
   * the entitlement moves to the tenant, which is what an entitlement is.
   */
  setPlan(_developerId: string, planTier: PlanTier): DeveloperAccount | null {
    const tenantId = this.tenancy.requireTenant();
    this.planByTenant.set(tenantId, planTier);
    this.schedulePersist();
    this.emit('changed');
    return this.defaultDeveloper();
  }

  /** The plan tier in force for the CALLER. Free until the tenant sets one. */
  planFor(): PlanTier {
    const tenantId = this.tenancy.scopeOrDeny()?.tenantId ?? null;
    if (tenantId === null) return 'free';
    return this.planByTenant.get(tenantId) ?? 'free';
  }

  /* ── API keys ── */

  /** The CALLER'S keys for this developer. Was every tenant's keys on the install. */
  keysFor(developerId: string): ApiKey[] {
    return this.tenancy
      .onlyMine([...this.keys.values()])
      .filter((k) => k.developerId === developerId)
      .map(strip);
  }

  createKey(developerId: string, name: string, scopes: ApiScope[], expiresAt: string | null = null): ApiKeyWithSecret {
    const id = `key_${randomUUID()}`;
    const raw = randomBytes(24).toString('base64url');
    const prefix = `npk_live_${raw.slice(0, 6)}`;
    const secret = `${prefix}.${raw}`;
    const stored: StoredKey = {
      id,
      tenantId: this.tenancy.requireTenant(),
      developerId,
      name,
      prefix,
      last4: raw.slice(-4),
      scopes,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      expiresAt,
      revokedAt: null,
      hash: sha256(secret),
    };
    this.keys.set(id, stored);
    this.schedulePersist();
    this.emit('changed');
    return { key: strip(stored), secret };
  }

  /**
   * Revoke one of the CALLER'S keys. A foreign id is indistinguishable from an
   * invented one — both `null` — so the refusal is not an existence oracle over
   * another tenant's credential ids.
   */
  revokeKey(id: string): ApiKey | null {
    const k = this.mineOrNull(id);
    if (!k || k.revokedAt) return k ? strip(k) : null;
    const next = { ...k, revokedAt: new Date().toISOString() };
    this.keys.set(id, next);
    this.schedulePersist();
    this.emit('changed');
    return strip(next);
  }

  /**
   * P3.0 — rotate a key: mint a fresh secret (a new key with the same name / scopes /
   * expiry) and revoke the old one, so a leaked secret is cut over cleanly. Returns
   * the new secret exactly once, like `createKey`.
   */
  rotateKey(id: string): ApiKeyWithSecret | null {
    const k = this.mineOrNull(id);
    if (!k || k.revokedAt) return null;
    const rotated = this.createKey(k.developerId, k.name, k.scopes, k.expiresAt);
    this.revokeKey(id);
    return rotated;
  }

  /** One of the caller's keys by id, or null. The single ownership resolve. */
  private mineOrNull(id: string): StoredKey | null {
    const k = this.keys.get(id) ?? null;
    return k !== null && this.tenancy.mine(k) ? k : null;
  }

  /**
   * Resolve a PRESENTED raw token to its key, or null. Records last-used.
   *
   * DELIBERATELY UNSCOPED — see the file header. The caller has proved
   * possession of the secret, which is the whole authentication, and this runs
   * before any tenant is established. Scoping it would break external API
   * access without closing anything: possession of the token is the credential.
   */
  verifyKey(token: string): ApiKey | null {
    const hash = sha256(token);
    for (const k of this.keys.values()) {
      if (k.hash === hash) {
        if (k.revokedAt) return null;
        if (k.expiresAt && Date.parse(k.expiresAt) < Date.now()) return null;
        const next = { ...k, lastUsedAt: new Date().toISOString() };
        this.keys.set(k.id, next);
        this.schedulePersist();
        return strip(next);
      }
    }
    return null;
  }

  /* ── OAuth apps ── */

  /** The CALLER'S OAuth applications. Was every tenant's integration map. */
  appsFor(developerId: string): OAuthApplication[] {
    return this.tenancy
      .onlyMine([...this.apps.values()])
      .filter((a) => a.developerId === developerId)
      .map(stripApp);
  }

  createApp(developerId: string, name: string, redirectUris: string[], scopes: ApiScope[], grantTypes: OAuthGrantType[]): OAuthApplicationWithSecret {
    const id = `app_${randomUUID()}`;
    const clientId = `npc_${randomBytes(12).toString('hex')}`;
    const clientSecret = `nps_${randomBytes(24).toString('base64url')}`;
    const stored: StoredApp = {
      id,
      tenantId: this.tenancy.requireTenant(),
      developerId,
      name,
      clientId,
      secretLast4: clientSecret.slice(-4),
      redirectUris,
      scopes,
      grantTypes,
      createdAt: new Date().toISOString(),
      secretHash: sha256(clientSecret),
    };
    this.apps.set(id, stored);
    this.schedulePersist();
    this.emit('changed');
    return { application: stripApp(stored), clientSecret };
  }

  /**
   * Delete one of the CALLER'S OAuth applications.
   *
   * This was `this.apps.delete(id)` on a bare payload id — the sharpest write in
   * the file, because the deletion is irreversible in a way a key revocation is
   * not: the client secret was returned exactly once at creation and cannot be
   * reissued for the same client id.
   */
  deleteApp(id: string): boolean {
    const app = this.apps.get(id) ?? null;
    if (app === null || !this.tenancy.mine(app)) return false;
    const ok = this.apps.delete(id);
    if (ok) {
      this.schedulePersist();
      this.emit('changed');
    }
    return ok;
  }

  /** P3.0 — verify an OAuth client's id + secret (for the client-credentials grant). */
  verifyAppCredentials(clientId: string, secret: string): OAuthApplication | null {
    const hash = sha256(secret);
    for (const a of this.apps.values()) {
      if (a.clientId === clientId && a.secretHash === hash) return stripApp(a);
    }
    return null;
  }

  /* ── access-token revocation (P3.0) ── */

  /** Revoke an issued access token by jti until its natural expiry. */
  revokeToken(jti: string, expMs: number): boolean {
    if (this.revokedTokens.has(jti)) return false;
    this.revokedTokens.set(jti, expMs);
    this.schedulePersist();
    this.emit('changed');
    return true;
  }

  /** Whether a token jti is revoked. Prunes the entry once it has expired. */
  isTokenRevoked(jti: string): boolean {
    const exp = this.revokedTokens.get(jti);
    if (exp === undefined) return false;
    if (exp <= Date.now()) {
      this.revokedTokens.delete(jti);
      return false;
    }
    return true;
  }

  /* ── usage ── */

  /**
   * Append one usage row, owned by the caller.
   *
   * The owner may be pre-supplied (the gateway path knows the key's tenant
   * before it knows the session's) and otherwise comes from the active scope.
   * Retention is PER TENANT: the cap was install-wide and oldest-first, so a
   * high-traffic tenant chose which of another tenant's billing rows was
   * destroyed — and these rows are what the metered invoice is computed from.
   */
  recordUsage(rec: Omit<UsageRecord, 'id'>): UsageRecord {
    const tenantId = rec.tenantId ?? this.tenancy.scopeOrDeny()?.tenantId ?? null;
    const full: UsageRecord = { id: `use_${randomUUID()}`, ...rec, tenantId };
    this.usage.push(full);
    /**
     * PER-TENANT CAP, WITH NO INSTALL-WIDE FALLBACK.
     *
     * The first version of this fix called `pruneOwn(usage, USAGE_CAP, …)` and
     * then, if the array was STILL over `USAGE_CAP`, fell back to
     * `slice(length - USAGE_CAP)` — an install-wide, oldest-first trim. With two
     * tenants at 12 000 rows each the per-tenant prune is a no-op (neither
     * exceeds 20 000) and the fallback deletes 4 000 rows that are mostly the
     * other tenant's. So the fallback quietly restored the exact defect the
     * prune was added to remove, and it took the sweep to see it.
     *
     * The cap is now per tenant with nothing after it. An install with more
     * tenants holds more rows. That is the honest trade, and it is the same one
     * `TenantOwnership.pruneOwn` already documents: the alternative is one
     * customer deleting another's billing evidence.
     */
    this.usage = this.tenancy.pruneOwn(
      this.usage,
      PER_TENANT_USAGE_CAP,
      (a, b) => a.at.localeCompare(b.at),
    );
    this.schedulePersist();
    return full;
  }

  /** The CALLER'S usage. Drives the metered invoice, so this is a billing boundary. */
  usageFor(developerId: string, sinceMs: number): UsageRecord[] {
    return this.tenancy
      .onlyMine(this.usage)
      .filter((u) => u.developerId === developerId && Date.parse(u.at) >= sinceMs);
  }

  countSince(developerId: string, sinceMs: number): number {
    return this.usageFor(developerId, sinceMs).length;
  }
}

function strip(k: StoredKey): ApiKey {
  const { hash: _hash, ...rest } = k;
  return rest;
}
function stripApp(a: StoredApp): OAuthApplication {
  const { secretHash: _secretHash, ...rest } = a;
  return rest;
}
