/**
 * The Gateway store: fixed-window rate counters per key, per-period quota
 * counters per developer, and the gateway audit trail + metrics. `peek` reports
 * remaining without consuming (so a denied request costs nothing); `commit`
 * records one allowed request. Electron-free.
 */
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type {
  GatewayAuditEntry,
  GatewayMetrics,
  QuotaPolicy,
  RateLimitPolicy,
  TenantScope,
} from '@neuropause/shared';
import { TenantOwnership } from '../../tenancy/tenantOwnedStore';
import { AuditChain, type AuditChainSnapshot, type AuditVerifyResult } from '../../security/auditChain';
import { createLogger } from '../../logger';

const log = createLogger('api-gateway');
const DEFAULT_AUDIT_CAP = 10_000;

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
  integrity?: AuditChainSnapshot;
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
  private readonly auditChain = new AuditChain<GatewayAuditEntry>(canonicalGatewayEntry, 'api-gateway');

  constructor(
    private readonly filePath: string,
    opts: { auditCap?: number } = {},
  ) {
    super();
    this.auditCap = Math.max(1, opts.auditCap ?? DEFAULT_AUDIT_CAP);
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
      if (this.auditChain.restore(data.integrity)) {
        const report = this.auditChain.verify(this.audit);
        if (!report.ok) {
          log.error('API gateway audit integrity check FAILED on load', {
            head: report.head.slice(0, 16),
            recomputed: report.recomputed.slice(0, 16),
            retained: report.retained,
          });
          this.emit('integrity-violation', report);
        }
      } else if (this.audit.length > 0) {
        this.auditChain.rebuild(this.audit); // legacy (unchained) file — upgrade in place
        this.schedulePersist();
      }
    } catch {
      this.audit = [];
      this.auditChain.rebuild([]);
    }
    this.loaded = true;
    log.info('API gateway ready', { audit: this.audit.length });
  }

  private async persist(): Promise<void> {
    const tmp = `${this.filePath}.tmp`;
    const file: GatewayFile = { audit: this.audit, integrity: this.auditChain.snapshot() };
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
    this.auditChain.append(full);
    this.audit.push(full);
    /**
     * RETENTION SCALES WITH TENANT COUNT. IT IS NOT PER-TENANT, AND CANNOT BE.
     *
     * The cap was a flat install-wide 10 000 dropped oldest-first, so tenant A's
     * traffic evicted tenant B's audit history — the same unfairness this round
     * fixed in four other stores with `pruneOwn`.
     *
     * `pruneOwn` is NOT AVAILABLE HERE, and the reason is structural rather than
     * an oversight. This array backs an order-sensitive hash chain:
     * `AuditChain.dropOldest` folds the dropped entry into the chain base, so it
     * is only correct for the entry at the FRONT. Removing the caller's oldest
     * row from the middle would break `verifyAuditIntegrity()` for every
     * remaining row, destroying the property the log exists for.
     *
     * I tried the obvious alternative first — keep dropping from the front only
     * while the oldest row's owner is over its own cap — and it is worse: one
     * ancient row belonging to a quiet tenant blocks all eviction and the array
     * grows without bound. A memory leak is not an improvement on unfairness.
     *
     * So the honest answer is a floor, not a boundary. The cap becomes
     * `auditCap × (number of tenants with entries)`, and eviction stays
     * front-first because the chain requires it. A tenant's rows now survive
     * until the INSTALL exceeds that total, which on a two-tenant install
     * doubles the window before anyone loses anything. It is a large reduction
     * in blast radius and NOT a fix: a sufficiently noisy tenant can still, over
     * time, push another tenant's oldest entries out.
     *
     * Making this fully fair needs one chain per tenant, which is a bigger claim
     * to change than a retention policy and is recorded as open work.
     */
    const tenantsWithEntries = new Set(this.audit.map((e) => e.tenantId ?? '')).size;
    const effectiveCap = this.auditCap * Math.max(1, tenantsWithEntries);
    while (this.audit.length > effectiveCap) {
      this.auditChain.dropOldest(this.audit[0] as GatewayAuditEntry);
      this.audit.shift();
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
   * DELIBERATELY INSTALL-WIDE. It is a statement about the CHAIN — the count the
   * hash covers — and a per-tenant number would not be checkable against it.
   */
  totalAudit(): number {
    return this.auditChain.totalAppended;
  }

  /**
   * Recompute the audit hash-chain; `ok:false` means an entry was altered or removed.
   *
   * DELIBERATELY INSTALL-WIDE, for the same reason as `totalAudit`. A per-tenant
   * chain would be a strictly weaker claim: it could not detect an entry deleted
   * from another tenant's section of the same file.
   */
  verifyAuditIntegrity(): AuditVerifyResult {
    return this.auditChain.verify(this.audit);
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
