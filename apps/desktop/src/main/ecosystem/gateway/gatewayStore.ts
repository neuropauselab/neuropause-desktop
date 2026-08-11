/**
 * The Gateway store: fixed-window rate counters per key, per-period quota
 * counters per developer, and the gateway audit trail + metrics. `peek` reports
 * remaining without consuming (so a denied request costs nothing); `commit`
 * records one allowed request. Electron-free.
 */
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import type {
  GatewayAuditEntry,
  GatewayMetrics,
  QuotaPolicy,
  RateLimitPolicy,
  TenantScope,
} from '@neuropause/shared';
import { TenantOwnership } from '../../tenancy/tenantOwnedStore';
import { AuditChain, AUDIT_CHAIN_ALGO, type AuditChainSnapshot, type AuditVerifyResult } from '../../security/auditChain';
import { createLogger } from '../../logger';
import { declareStoreScope } from '../../tenancy/storeScope';

/**
 * P13C ROUND 9 — F13. The structural scope declaration. See tenancy/storeScope.ts.
 */
declareStoreScope({
  name: 'ecosystem-gateway-audit',
  scope: 'TENANT',
  persistence: 'file',
  authority: 'SYSTEM',
  classification: 'CUSTOMER_DERIVED',
  /**
   * P13C ROUND 10. SYSTEM: no channel, id or payload can cause a removal here.
   * The cap fires inside `record()` and nothing else deletes an audit row — an
   * audit trail with a delete button is not an audit trail.
   *
   * The other matches the retention scanner finds in this file are `chains.clear()`
   * and `ownerCounts.clear()`, which rebuild derived structures (one hash chain
   * and one count per owner) from `this.audit` after a load; they remove no rows.
   */
  retentionScope: 'OWNER',
  retentionAuthority: 'SYSTEM',
  retention:
    'Capped PER TENANT (auditCap rows each, default 10,000) as of Round 9, over ONE HASH CHAIN PER ' +
    'TENANT. Round 3 shipped an install-wide cap; Round 8 widened it to auditCap x (tenants with ' +
    "entries) and said in its own comment that this was NOT a fix, because a noisy tenant could still " +
    "push another tenant's oldest audit rows out. Retention now cannot reach another tenant's rows at " +
    'all: eviction drops the front of the OWNING tenant\'s chain, which is the only position ' +
    '`AuditChain.dropOldest` is correct for. Rows with no owner are capped in their own chain.',
  reason:
    "Rows name the tenant, the API credential, the request path and the outcome — the record of who "  +
    'called what and whether it was allowed. An audit trail one customer can cause another customer to ' +
    'lose is not an audit trail.',
});

const log = createLogger('api-gateway');
const DEFAULT_AUDIT_CAP = 10_000;

/**
 * The chain/retention bucket for rows written before the audit trail had an owner.
 *
 * They belong to nobody, are read by nobody (`onlyMine` refuses an unowned row),
 * and get their own chain so that no tenant's traffic can evict them and they
 * cannot evict any tenant's rows.
 */
const UNOWNED_AUDIT_OWNER = ' unowned';

/** The legacy namespace: the single install-wide chain that existed before Round 9. */
const LEGACY_CHAIN_NAMESPACE = 'api-gateway';

/**
 * Sticky evidence that the pre-Round-9 install-wide chain failed verification at
 * the moment it was split into per-tenant chains.
 *
 * It is PERSISTED. Without it, splitting a tampered log would derive fresh
 * per-tenant chains from the tampered rows and the next load would report a clean
 * bill of health — an upgrade that erases the tamper evidence is worse than the
 * unfairness it was fixing.
 */
interface GatewayIntegrityBreach {
  at: string;
  head: string;
  recomputed: string;
  retained: number;
}

/**
 * Deterministic serialization of a gateway audit entry (fixed key order) for hashing.
 *
 * P13C ROUND 3 — H-3. `tenantId` is appended ONLY when present.
 *
 * A hash chain and a schema change are natural enemies: adding a field to the
 * canonical form changes the hash of every historical entry, so an install that
 * upgrades would fail `verify()` on load and emit an integrity violation — an
 * alarm indistinguishable from real tampering, which is the worst possible
 * outcome for a tamper-evidence mechanism.
 *
 * Omitting the key for entries that lack an owner makes pre-Round-3 rows hash
 * EXACTLY as before, so the existing chain still verifies, while every new entry
 * covers its tenant. The alternative — leaving the owner outside the chain —
 * would mean the field the reads are filtered on is the one field not protected
 * by the tamper evidence.
 */
function canonicalGatewayEntry(e: GatewayAuditEntry): string {
  return JSON.stringify({
    at: e.at,
    developerId: e.developerId,
    id: e.id,
    keyId: e.keyId,
    latencyMs: e.latencyMs,
    method: e.method,
    path: e.path,
    reason: e.reason,
    status: e.status,
    ...(e.tenantId ? { tenantId: e.tenantId } : {}),
    version: e.version,
  });
}

interface RateState {
  windowStart: number;
  count: number;
}
interface QuotaState {
  periodKey: string;
  count: number;
}
interface GatewayFile {
  audit: GatewayAuditEntry[];
  /** PRE-ROUND-9: the single install-wide chain. Read for migration, never written. */
  integrity?: AuditChainSnapshot;
  /** ROUND 9: one chain per owner, keyed by tenant id (or the unowned bucket). */
  integrityByOwner?: Record<string, AuditChainSnapshot>;
  /** Set once, and kept forever, if the legacy chain was already broken when it was split. */
  integrityBreach?: GatewayIntegrityBreach | null;
  /**
   * Appends and drops the legacy chain accounted for BEFORE the split, so
   * `totalAudit()` does not reset on upgrade. `carriedAppended` counts only the
   * entries the legacy chain had already rotated out; the retained ones are
   * re-counted by the per-owner chains.
   */
  carriedAppended?: number;
  carriedDropped?: number;
}

function periodKey(period: 'day' | 'month', now: number): string {
  const iso = new Date(now).toISOString();
  return period === 'day' ? iso.slice(0, 10) : iso.slice(0, 7);
}

export class GatewayStore extends EventEmitter {
  /** The tenant boundary. Registered with the startup gate by construction. */
  private readonly tenancy = new TenantOwnership('ecosystem-gateway-audit');
  private rate = new Map<string, RateState>();
  private quota = new Map<string, QuotaState>();
  private audit: GatewayAuditEntry[] = [];
  private loaded = false;
  private persisting = false;
  private dirty = false;
  private lastPersist: Promise<void> = Promise.resolve();
  private readonly auditCap: number;
  /**
   * ONE HASH CHAIN PER OWNER. P13C ROUND 9 — F13.
   *
   * Round 8 could not make retention fair because there was one chain over one
   * array: `AuditChain.dropOldest` folds the dropped entry into the chain base,
   * so it is only correct for the entry at the FRONT, and removing the caller's
   * oldest row from the middle broke verification for every row after it. That
   * constraint is real — and it is a constraint on ONE chain. With a chain per
   * owner, the caller's oldest row IS the front of the caller's chain, so
   * per-tenant retention and tamper evidence stop being in tension.
   */
  private chains = new Map<string, AuditChain<GatewayAuditEntry>>();
  /** How many retained rows each owner has. Kept in step with `audit`. */
  private ownerCounts = new Map<string, number>();
  private breach: GatewayIntegrityBreach | null = null;
  private carriedAppended = 0;
  private carriedDropped = 0;

  constructor(
    private readonly filePath: string,
    opts: { auditCap?: number } = {},
  ) {
    super();
    this.auditCap = Math.max(1, opts.auditCap ?? DEFAULT_AUDIT_CAP);
  }

  /**
   * The chain/retention owner of one entry. Unowned rows are never guessed into a tenant.
   *
   * Tenant keys are namespaced with `t:` so no tenant id can collide with the
   * unowned bucket and inherit its chain — the same reason the key appears in the
   * chain namespace rather than the chain being shared.
   */
  private ownerOf(e: GatewayAuditEntry): string {
    const owner = e.tenantId;
    return typeof owner === 'string' && owner !== '' ? `t:${owner}` : UNOWNED_AUDIT_OWNER;
  }

  private chainFor(owner: string): AuditChain<GatewayAuditEntry> {
    let chain = this.chains.get(owner);
    if (!chain) {
      chain = new AuditChain<GatewayAuditEntry>(canonicalGatewayEntry, `${LEGACY_CHAIN_NAMESPACE}:${owner}`);
      this.chains.set(owner, chain);
    }
    return chain;
  }

  /** The retained rows of one owner, in order. The input to that owner's chain. */
  private entriesOf(owner: string): GatewayAuditEntry[] {
    return this.audit.filter((e) => this.ownerOf(e) === owner);
  }

  /** Recount `ownerCounts` from `audit`. Called after a load or a rebuild. */
  private recount(): void {
    this.ownerCounts.clear();
    for (const e of this.audit) {
      const owner = this.ownerOf(e);
      this.ownerCounts.set(owner, (this.ownerCounts.get(owner) ?? 0) + 1);
    }
  }

  /** Derive one chain per owner from the retained rows. For legacy/unchained files. */
  private rebuildOwnerChains(): void {
    this.chains.clear();
    const byOwner = new Map<string, GatewayAuditEntry[]>();
    for (const e of this.audit) {
      const owner = this.ownerOf(e);
      let rows = byOwner.get(owner);
      if (!rows) byOwner.set(owner, (rows = []));
      rows.push(e);
    }
    for (const [owner, rows] of byOwner) this.chainFor(owner).rebuild(rows);
    this.recount();
  }

  /** Bind the tenant boundary. UNBOUND DENIES. Chainable. */
  bindScope(source: () => TenantScope | null): this {
    this.tenancy.bindScope(source);
    return this;
  }
  hasScope(): boolean {
    return this.tenancy.hasScope();
  }
  /** Unscoped ownership counts over the audit array, for the inventory only. */
  ownershipCounts(): { total: number; assigned: number; unresolved: number } {
    return this.tenancy.countOwnership(this.audit);
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const data = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as Partial<GatewayFile>;
      this.audit = Array.isArray(data.audit) ? data.audit : [];
      this.breach = data.integrityBreach ?? null;
      this.carriedAppended = data.carriedAppended ?? 0;
      this.carriedDropped = data.carriedDropped ?? 0;
      this.recount();

      const byOwner = data.integrityByOwner;
      let restored = false;
      if (byOwner && typeof byOwner === 'object') {
        for (const [owner, snap] of Object.entries(byOwner)) {
          const chain = new AuditChain<GatewayAuditEntry>(
            canonicalGatewayEntry,
            `${LEGACY_CHAIN_NAMESPACE}:${owner}`,
          );
          if (chain.restore(snap)) {
            this.chains.set(owner, chain);
            restored = true;
          }
        }
      }

      if (restored) {
        this.reportIntegrity();
      } else if (data.integrity) {
        /**
         * THE SPLIT. A pre-Round-9 file has ONE install-wide chain.
         *
         * It is verified in its legacy form FIRST, so tampering that happened
         * before the upgrade is still detected against the hash that covered it.
         * Only then are the per-owner chains derived. A failure is recorded in
         * `breach`, which is written to the file — so the upgrade cannot launder
         * a broken log into a clean one.
         */
        const legacy = new AuditChain<GatewayAuditEntry>(canonicalGatewayEntry, LEGACY_CHAIN_NAMESPACE);
        if (legacy.restore(data.integrity)) {
          const report = legacy.verify(this.audit);
          if (!report.ok) {
            this.breach = {
              at: new Date().toISOString(),
              head: report.head,
              recomputed: report.recomputed,
              retained: report.retained,
            };
          }
          // Everything the legacy chain had already rotated out stays counted;
          // the retained rows are re-counted by the per-owner chains below.
          this.carriedAppended += Math.max(0, report.totalAppended - this.audit.length);
          this.carriedDropped += report.dropped;
        }
        this.rebuildOwnerChains();
        this.schedulePersist();
        this.reportIntegrity();
      } else if (this.audit.length > 0) {
        this.rebuildOwnerChains(); // legacy (unchained) file — upgrade in place
        this.schedulePersist();
      }
    } catch {
      this.audit = [];
      this.chains.clear();
      this.ownerCounts.clear();
      this.breach = null;
      this.carriedAppended = 0;
      this.carriedDropped = 0;
    }
    this.loaded = true;
    log.info('API gateway ready', { audit: this.audit.length });
  }

  /** Verify at load and raise the alarm once, exactly as the single chain used to. */
  private reportIntegrity(): void {
    const report = this.verifyAuditIntegrity();
    if (report.ok) return;
    log.error('API gateway audit integrity check FAILED on load', {
      head: report.head.slice(0, 16),
      recomputed: report.recomputed.slice(0, 16),
      retained: report.retained,
    });
    this.emit('integrity-violation', report);
  }

  private async persist(): Promise<void> {
    const tmp = `${this.filePath}.tmp`;
    const integrityByOwner: Record<string, AuditChainSnapshot> = {};
    for (const [owner, chain] of this.chains) integrityByOwner[owner] = chain.snapshot();
    const file: GatewayFile = {
      audit: this.audit,
      integrityByOwner,
      integrityBreach: this.breach,
      carriedAppended: this.carriedAppended,
      carriedDropped: this.carriedDropped,
    };
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
      log.error('Gateway persist failed', { error: String(err) });
    } finally {
      this.persisting = false;
    }
  }
  async flush(): Promise<void> {
    while (this.persisting) await this.lastPersist;
  }

  /**
   * P13C ROUND 3 — THE QUOTA COUNTER IS KEYED BY TENANT, NOT BY DEVELOPER.
   *
   * There is one developer account per install, so `quota.get(developerId)` was
   * one shared counter and `decideGateway` denies on `quotaRemaining`. Tenant A
   * burning the monthly quota therefore returned 429 to tenant B for the rest of
   * the period — a cross-tenant denial of service through the enforcement path.
   *
   * The metered-invoice half of this was fixed by scoping the usage ledger; this
   * is the ENFORCEMENT half, and it was missed because the two live in different
   * files. The rate window needs no change: it is keyed by credential id, and
   * credentials became tenant-owned in the same round.
   *
   * `tenantId` is passed in rather than resolved here, because the caller has
   * already worked out whose request this is — from the presented credential
   * where there is one, and only otherwise from the session.
   */
  private quotaKey(tenantId: string | null, developerId: string | null): string | null {
    if (developerId === null) return null;
    return `${tenantId ?? 'unowned'}::${developerId}`;
  }

  /** Remaining-in-window + quota-used, without consuming. */
  peek(keyId: string | null, developerId: string | null, rateLimit: RateLimitPolicy, quota: QuotaPolicy, now: number, tenantId: string | null = null): { rateRemaining: number; quotaUsed: number } {
    let rateRemaining = rateLimit.max;
    if (keyId) {
      const r = this.rate.get(keyId);
      if (r && now - r.windowStart < rateLimit.windowMs) rateRemaining = Math.max(0, rateLimit.max - r.count);
    }
    let quotaUsed = 0;
    const qk = this.quotaKey(tenantId, developerId);
    if (qk) {
      const q = this.quota.get(qk);
      const pk = periodKey(quota.period, now);
      if (q && q.periodKey === pk) quotaUsed = q.count;
    }
    return { rateRemaining, quotaUsed };
  }

  /** Record one allowed request against the rate window + the TENANT's quota period. */
  commit(keyId: string | null, developerId: string | null, rateLimit: RateLimitPolicy, quota: QuotaPolicy, now: number, tenantId: string | null = null): void {
    if (keyId) {
      const r = this.rate.get(keyId);
      if (!r || now - r.windowStart >= rateLimit.windowMs) this.rate.set(keyId, { windowStart: now, count: 1 });
      else this.rate.set(keyId, { windowStart: r.windowStart, count: r.count + 1 });
    }
    const qk = this.quotaKey(tenantId, developerId);
    if (qk) {
      const pk = periodKey(quota.period, now);
      const q = this.quota.get(qk);
      if (!q || q.periodKey !== pk) this.quota.set(qk, { periodKey: pk, count: 1 });
      else this.quota.set(qk, { periodKey: pk, count: q.count + 1 });
    }
  }

  record(entry: Omit<GatewayAuditEntry, 'id'>): GatewayAuditEntry {
    const full: GatewayAuditEntry = { id: `gw_${randomUUID()}`, ...entry };
    const owner = this.ownerOf(full);
    this.chainFor(owner).append(full);
    this.audit.push(full);
    this.ownerCounts.set(owner, (this.ownerCounts.get(owner) ?? 0) + 1);
    /**
     * RETENTION IS PER TENANT. P13C ROUND 9 — F13.
     *
     * The Round 8 comment this replaces was accurate about the constraint and
     * wrong about the conclusion. It said, correctly, that `dropOldest` is only
     * sound for the entry at the FRONT of the chain — so removing the caller's
     * oldest row from the middle of a shared array would break verification for
     * every row after it. It then concluded that per-tenant retention was
     * impossible, settled for `auditCap × (tenants with entries)`, and said in
     * its own text that this was "a large reduction in blast radius and NOT a
     * fix" — an install-wide cap on an audit trail, documented as unfixed and
     * left live. It also recorded the actual answer as open work.
     *
     * That answer is here: ONE CHAIN PER OWNER. The caller's oldest row is the
     * front of the caller's own chain, so `dropOldest` is sound at exactly the
     * position retention needs, and no other tenant's rows move. The rejected
     * alternative (drop from the front only while the front row's owner is over
     * cap) really was worse — one ancient row from a quiet tenant blocked all
     * eviction — but that was a property of sharing one chain, not of fairness.
     *
     * `verifyAuditIntegrity()` is correspondingly stronger, not weaker: it now
     * detects an entry deleted from ANY tenant's section, because each section
     * has a head of its own. Removing every row of one tenant no longer leaves a
     * chain that verifies.
     *
     * The scan for the victim is a `findIndex` over the retained array and runs
     * only when THIS owner is over ITS OWN cap, dropping exactly one row per
     * record in steady state.
     */
    let mine = this.ownerCounts.get(owner) ?? 0;
    while (mine > this.auditCap) {
      const idx = this.audit.findIndex((e) => this.ownerOf(e) === owner);
      if (idx < 0) break;
      this.chainFor(owner).dropOldest(this.audit[idx] as GatewayAuditEntry);
      this.audit.splice(idx, 1);
      mine -= 1;
      this.ownerCounts.set(owner, mine);
    }
    this.schedulePersist();
    this.emit('changed');
    return full;
  }

  /**
   * The CALLER'S audit entries, newest first.
   *
   * THE OUTPUT IS FILTERED AND THE ARRAY NEVER IS. `this.audit` is the input to
   * an order-sensitive hash chain, so removing entries from it to scope a read
   * would break `verifyAuditIntegrity()` and destroy the property the log exists
   * for. Same reasoning, and the same shape, as the workforce governance audit.
   *
   * `limit` is applied AFTER the filter, so a tenant asking for 100 gets 100 of
   * its own rather than whatever survives of the install's last 100 — which
   * would have leaked the mix through the count alone.
   */
  auditEntries(limit = 100): GatewayAuditEntry[] {
    const mine = this.tenancy.onlyMine(this.audit);
    return mine.slice(-limit).reverse();
  }

  /**
   * Total audit entries ever recorded, including those rotated out of retention.
   *
   * DELIBERATELY INSTALL-WIDE. It is a statement about the CHAINS — the count the
   * hashes cover — and a per-tenant number would not be checkable against it. It
   * is now the sum over every owner's chain plus whatever a pre-Round-9 chain had
   * already rotated out before it was split, so upgrading an install does not
   * silently reset the number.
   */
  totalAudit(): number {
    let total = this.carriedAppended;
    for (const chain of this.chains.values()) total += chain.totalAppended;
    return total;
  }

  /**
   * Recompute every audit hash-chain; `ok:false` means an entry was altered or removed.
   *
   * DELIBERATELY INSTALL-WIDE AS A REPORT, and per-owner underneath. The composite
   * `head` is a hash over each owner's head in a fixed order and `recomputed` is
   * the same fold over each owner's recomputation, so the two agree only when
   * EVERY owner's section verifies — one tenant's altered row fails the whole
   * report, exactly as before.
   *
   * WHAT THE SPLIT COSTS, STATED HONESTLY. Round 8 kept one chain partly because
   * "a per-tenant chain could not detect an entry deleted from another tenant's
   * section of the same file". A chain PER tenant does cover every section — edit
   * or delete any tenant's rows and that tenant's chain stops verifying, which
   * `retentionScopeTenancy.test.ts` asserts. There is exactly one case the split
   * gives up: an attacker who removes a tenant's rows AND that tenant's entry from
   * `integrityByOwner` leaves nothing behind that names the tenant, where the
   * single chain would still have had a head covering those rows. That attacker is
   * already inside the threat model `auditChain.ts` states it does not cover — it
   * needs write access to the integrity state, and against the single chain the
   * same access buys a recomputed head. The gap is real, it is smaller than "one
   * customer's traffic silently deletes another customer's audit records", and the
   * mitigation is unchanged: ship entries to append-only external storage.
   */
  verifyAuditIntegrity(): AuditVerifyResult {
    const owners = [...this.chains.keys()].sort((a, b) => a.localeCompare(b));
    const heads: string[] = [];
    const recomputations: string[] = [];
    let retained = 0;
    let dropped = this.carriedDropped;
    let totalAppended = this.carriedAppended;
    for (const owner of owners) {
      const rows = this.entriesOf(owner);
      const r = (this.chains.get(owner) as AuditChain<GatewayAuditEntry>).verify(rows);
      heads.push(`${owner} ${r.head}`);
      recomputations.push(`${owner} ${r.recomputed}`);
      retained += r.retained;
      dropped += r.dropped;
      totalAppended += r.totalAppended;
    }
    const fold = (parts: string[]): string =>
      createHash('sha256').update(`gateway-audit\n${parts.join('\n')}`).digest('hex');
    const head = fold(heads);
    let recomputed = fold(recomputations);
    /**
     * A breach recorded when the legacy chain was split is permanent. It is held
     * on the file, so a tampered log stays reported as tampered across restarts
     * rather than being laundered clean by the upgrade that split it.
     */
    if (this.breach !== null) recomputed = `breached:${this.breach.recomputed}`;
    return {
      ok: head === recomputed,
      algo: AUDIT_CHAIN_ALGO,
      head,
      recomputed,
      retained,
      dropped,
      totalAppended,
    };
  }

  /** The CALLER'S gateway metrics. Was every tenant's traffic, latency and error mix. */
  metrics(windowDays: number, now: number): GatewayMetrics {
    const since = now - windowDays * 86_400_000;
    const rows = this.tenancy.onlyMine(this.audit).filter((a) => Date.parse(a.at) >= since);
    const byStatus: Record<string, number> = {};
    const byVersion: Record<string, number> = {};
    let allowed = 0;
    let rateLimited = 0;
    let unauthorized = 0;
    const latencies: number[] = [];
    for (const a of rows) {
      byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
      byVersion[a.version] = (byVersion[a.version] ?? 0) + 1;
      if (a.status === 200) allowed += 1;
      if (a.status === 429) rateLimited += 1;
      if (a.status === 401 || a.status === 403) unauthorized += 1;
      latencies.push(a.latencyMs);
    }
    latencies.sort((x, y) => x - y);
    const p95 = latencies.length > 0 ? latencies[Math.min(latencies.length - 1, Math.floor(0.95 * latencies.length))] : 0;
    return {
      windowDays,
      requests: rows.length,
      allowed,
      denied: rows.length - allowed,
      rateLimited,
      unauthorized,
      byStatus,
      byVersion,
      p95LatencyMs: Math.round(p95),
    };
  }
}
