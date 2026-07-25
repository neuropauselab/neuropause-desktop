/**
 * The Gateway store: fixed-window rate counters per key, per-period quota
 * counters per developer, and the gateway audit trail + metrics. `peek` reports
 * remaining without consuming (so a denied request costs nothing); `commit`
 * records one allowed request. Electron-free.
 */
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { GatewayAuditEntry, GatewayMetrics, QuotaPolicy, RateLimitPolicy } from '@neuropause/shared';
import { AuditChain, type AuditChainSnapshot, type AuditVerifyResult } from '../../security/auditChain';
import { createLogger } from '../../logger';

const log = createLogger('api-gateway');
const DEFAULT_AUDIT_CAP = 10_000;

/** Deterministic serialization of a gateway audit entry (fixed key order) for hashing. */
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

  /** Remaining-in-window + quota-used, without consuming. */
  peek(keyId: string | null, developerId: string | null, rateLimit: RateLimitPolicy, quota: QuotaPolicy, now: number): { rateRemaining: number; quotaUsed: number } {
    let rateRemaining = rateLimit.max;
    if (keyId) {
      const r = this.rate.get(keyId);
      if (r && now - r.windowStart < rateLimit.windowMs) rateRemaining = Math.max(0, rateLimit.max - r.count);
    }
    let quotaUsed = 0;
    if (developerId) {
      const q = this.quota.get(developerId);
      const pk = periodKey(quota.period, now);
      if (q && q.periodKey === pk) quotaUsed = q.count;
    }
    return { rateRemaining, quotaUsed };
  }

  /** Record one allowed request against the rate window + quota period. */
  commit(keyId: string | null, developerId: string | null, rateLimit: RateLimitPolicy, quota: QuotaPolicy, now: number): void {
    if (keyId) {
      const r = this.rate.get(keyId);
      if (!r || now - r.windowStart >= rateLimit.windowMs) this.rate.set(keyId, { windowStart: now, count: 1 });
      else this.rate.set(keyId, { windowStart: r.windowStart, count: r.count + 1 });
    }
    if (developerId) {
      const pk = periodKey(quota.period, now);
      const q = this.quota.get(developerId);
      if (!q || q.periodKey !== pk) this.quota.set(developerId, { periodKey: pk, count: 1 });
      else this.quota.set(developerId, { periodKey: pk, count: q.count + 1 });
    }
  }

  record(entry: Omit<GatewayAuditEntry, 'id'>): GatewayAuditEntry {
    const full: GatewayAuditEntry = { id: `gw_${randomUUID()}`, ...entry };
    this.auditChain.append(full);
    this.audit.push(full);
    while (this.audit.length > this.auditCap) {
      this.auditChain.dropOldest(this.audit[0]);
      this.audit.shift();
    }
    this.schedulePersist();
    this.emit('changed');
    return full;
  }

  auditEntries(limit = 100): GatewayAuditEntry[] {
    return this.audit.slice(-limit).reverse();
  }

  /** Total audit entries ever recorded, including those rotated out of retention. */
  totalAudit(): number {
    return this.auditChain.totalAppended;
  }

  /** Recompute the audit hash-chain; `ok:false` means an entry was altered or removed. */
  verifyAuditIntegrity(): AuditVerifyResult {
    return this.auditChain.verify(this.audit);
  }

  metrics(windowDays: number, now: number): GatewayMetrics {
    const since = now - windowDays * 86_400_000;
    const rows = this.audit.filter((a) => Date.parse(a.at) >= since);
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
