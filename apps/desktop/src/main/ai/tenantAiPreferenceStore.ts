/**
 * TENANT AI PREFERENCE. P13C ROUND 17 · DECISION D-5.
 *
 * WHY THIS STORE EXISTS
 *
 * First-run asked every new user *"Where should your AI work?"* and answered it
 * by calling `ai:config.setMode` — which is `cloud:operate`, platform-only, one
 * `ai-config.json` for the machine. `platformOperatorRegistry` deliberately
 * refuses to self-seed (*"EMPTY MEANS NOBODY … no bootstrap-if-empty path"*), so
 * a fresh install has no operator and both onboarding buttons were refused. Two
 * independently correct decisions composing into a product nobody could set up.
 *
 * D-5 keeps the platform boundary and gives the organization its own preference.
 *
 * WHY NOT `experience-profile`, WHICH ALREADY HOLDS `aiModeChosen`
 *
 * Because its own declaration says `scope: 'USER'`, `authority: 'USER'`, and
 * *"`experience:profile.set` and `experience:profile.reset` are on the PUBLIC
 * channel list — no auth, no permission"*. Putting an organization's AI
 * preference behind an unauthenticated channel would be a bypass of the very
 * boundary D-5 exists to protect. The convenient home is the wrong one.
 *
 * WHAT IT CAN AND CANNOT SAY
 *
 * `TenantAiMode` is two values. `'external'` is not offered, so "elevate this
 * organization into direct external routing" is not a request the resolver
 * declines — it is a request the type cannot construct. The effective mode is
 * always `min(platform, tenant)`; see `resolveEffectiveAiMode`.
 *
 * SHAPE
 *
 * `Record<orgId, {mode, updatedAt}>` — one row per organization, keyed by owner.
 * The read filter and the removal boundary are therefore the same key, so they
 * cannot drift apart, which is the property `enterprise-health-history` had to
 * be rebuilt to obtain.
 */
import { promises as fs, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { TenantScope } from '@neuropause/shared';
import { isTenantAiMode, type TenantAiMode } from '@neuropause/shared';
import { TenantOwnership } from '../tenancy/tenantOwnedStore';
import type { TenantReadGrant } from '../tenancy/tenantOwnedStore';
import { declareStoreScope } from '../tenancy/storeScope';

declareStoreScope({
  name: 'tenant-ai-preference',
  scope: 'TENANT',
  persistence: 'file',
  /** Set by the organization's Owner/Admin through `org:manage`. Never by the platform. */
  authority: 'ORG_ROLE',
  classification: 'CUSTOMER_DERIVED',
  retentionScope: 'OWNER',
  retentionAuthority: 'OWNER',
  retention:
    'ONE row per organization, keyed by `tenantId`. `set` upserts the caller\'s own row and ' +
    '`mergeForGrant` replaces exactly the granted tenant\'s row — both address a single key, so ' +
    'neither can reach another organization\'s preference. There is no list, no cap and no ' +
    'eviction, so no write removes anything belonging to anyone else. The only removal is a ' +
    'restore overwriting the granted tenant\'s own row with the archived one.',
  reason:
    'An organization\'s standing instruction about where its AI work may run. It is customer ' +
    'state, not install telemetry: it is chosen by that organization\'s administrator, it ' +
    'differs between tenants on one machine, and it is one half of the input to the routing ' +
    'decision for that tenant\'s requests. The platform half lives in `ai-config.json` under ' +
    '`cloud:operate` and is deliberately NOT here.',
});

export interface TenantAiPreferenceRow {
  /** The owning organization. The key, and the only ownership evidence. */
  tenantId: string;
  mode: TenantAiMode;
  updatedAt: number;
}

interface PreferenceFile {
  preferences: TenantAiPreferenceRow[];
}

export class TenantAiPreferenceStore {
  private readonly tenancy = new TenantOwnership('tenant-ai-preference');

  private rows: TenantAiPreferenceRow[] = [];
  private loaded = false;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string | null) {}

  /** Bind the tenant boundary. UNBOUND DENIES. Chainable. */
  bindScope(source: () => TenantScope | null): this {
    this.tenancy.bindScope(source);
    return this;
  }
  hasScope(): boolean {
    return this.tenancy.hasScope();
  }
  /** Unscoped ownership counts, for the migration inventory. */
  ownershipCounts(): { total: number; assigned: number; unresolved: number } {
    return this.tenancy.countOwnership(this.rows);
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (this.filePath === null) return;
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<PreferenceFile>;
      const list = Array.isArray(parsed.preferences) ? parsed.preferences : [];
      // A row whose mode is not a value a tenant may hold is dropped rather than
      // coerced: a file edited to say `external` must not become a capability.
      this.rows = list.filter(
        (r): r is TenantAiPreferenceRow =>
          typeof r?.tenantId === 'string' && r.tenantId !== '' && isTenantAiMode(r.mode),
      );
    } catch {
      this.rows = [];
    }
  }

  private persist(): Promise<void> {
    const run = this.writeChain.then(() => this.writeNow());
    this.writeChain = run.catch(() => {});
    return run;
  }

  private async writeNow(): Promise<void> {
    if (this.filePath === null) return;
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.mkdir(dirname(this.filePath), { recursive: true }).catch(() => {});
    await fs.writeFile(tmp, JSON.stringify({ preferences: this.rows } as PreferenceFile), {
      mode: 0o600,
    });
    await fs.rename(tmp, this.filePath);
  }

  /**
   * The CALLER'S preference, or null when they have not chosen one.
   *
   * `onlyMine` rather than a lookup by a caller-supplied id: there is no id
   * parameter to substitute, so the ambient scope is the only selector — the
   * same shape `EnterpriseOrgGet` uses to make the M-11 class impossible.
   */
  mine(): TenantAiPreferenceRow | null {
    this.load();
    return this.tenancy.onlyMine(this.rows)[0] ?? null;
  }

  /**
   * Upsert the caller's own preference.
   *
   * `requireTenant()` throws when no organization is active, matching every
   * other write in this program: a row with no owner is a row nobody can read
   * back, and inventing an owner is worse than refusing.
   */
  async setMine(mode: TenantAiMode, nowMs: number = Date.now()): Promise<TenantAiPreferenceRow> {
    this.load();
    const tenantId = this.tenancy.requireTenant();
    const row: TenantAiPreferenceRow = { tenantId, mode, updatedAt: nowMs };
    this.rows = [...this.rows.filter((r) => r.tenantId !== tenantId), row];
    await this.persist();
    return { ...row };
  }

  /* ── F22 tenant archive seam ─────────────────────────────────────────────
   * Both take a `TenantReadGrant`, the branded type only `authorizeTenantRead`
   * mints, so neither is an unscoped read anything can call.
   */

  snapshotForGrant(grant: TenantReadGrant): TenantAiPreferenceRow[] {
    this.load();
    return this.tenancy.onlyFor(grant, this.rows).map((r) => ({ ...r }));
  }

  /**
   * Replace the granted tenant's row, leaving every other tenant's untouched.
   *
   * Memory is updated BEFORE the write because `persist()` serializes from
   * memory — a disk-only merge would be erased by the next ordinary write.
   * A restored row whose mode is not tenant-holdable is dropped, so a tampered
   * archive cannot install `external` through the restore path.
   */
  async mergeForGrant(
    grant: TenantReadGrant,
    rows: readonly TenantAiPreferenceRow[],
  ): Promise<number> {
    this.load();
    const others = this.rows.filter((r) => r.tenantId !== grant.tenantId);
    const mine = rows.filter((r) => isTenantAiMode(r.mode)).map((r) => ({ ...r }));
    this.rows = [...others, ...mine];
    await this.persist();
    return mine.length;
  }
}
