/**
 * The Executive Memory audit trail. Every memory lifecycle event — created,
 * used, forgotten, rejected (governance result), updated, pinned — is appended
 * here as an immutable `MemoryAuditEvent`, giving a complete, queryable record
 * of what Founder AI chose to remember, recall, or refuse, and why.
 *
 * Append-only by contract. Electron-free (constructor takes a file path); the
 * singleton lives in memoryAuditInstance.ts. Persistence is the standard
 * serialized background writer with atomic temp-file + rename — the same shape
 * as the Governance Runtime's audit log.
 */
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import type { MemoryAuditAction, MemoryAuditEvent, MemoryAuditPage } from '@neuropause/shared';
import { createLogger } from '../logger';
import type { TenantScope } from '@neuropause/shared';
import { TenantOwnership } from '../tenancy/tenantOwnedStore';
import { declareStoreScope } from '../tenancy/storeScope';

/**
 * P13C ROUND 10 — the structural scope declaration. See tenancy/storeScope.ts.
 *
 * THE FILE HAD NO `declareStoreScope` AT ALL. It satisfied the scope gate through
 * `new TenantOwnership('memory-audit-log')` — one of the four declaring APIs, and
 * the one that, like `registerTenantStore`, TAKES NO RETENTION ARGUMENT. So the
 * store that Round 7 found on a PUBLIC channel holding assistant-written record
 * titles, and whose install-wide `slice(length - MAX_ENTRIES)` was the fifth cap
 * in this program able to delete another tenant's audit evidence, has never once
 * been asked in a checkable form whose rows a removal reaches. It is asked here.
 */
declareStoreScope({
  name: 'memory-audit-log',
  scope: 'TENANT',
  persistence: 'file',
  /**
   * SYSTEM: nothing mutates this log through a user-facing surface. Every row is
   * appended by `record()` as a side effect of a memory lifecycle event, and the
   * only channel that reaches it — `ExecMemoryAudit` — is a READ, classified
   * `intelligence:read` since Round 7 (it was public). There is no delete, no
   * edit and no clear on this class.
   */
  authority: 'SYSTEM',
  classification: 'CUSTOMER_DERIVED',
  /** A removal reaches the recording tenant's own rows and no others. Verified below. */
  retentionScope: 'OWNER',
  retentionAuthority: 'SYSTEM',
  retention:
    'ONE removal: the MAX_ENTRIES cap in `record()`, applied through ' +
    '`TenantOwnership.pruneOwn`, which selects victims from `records.filter(r => r.tenantId === ' +
    "mine)` only — so an overflowing tenant can delete nothing but its own oldest rows. It was " +
    '`entries.slice(length - MAX_ENTRIES)` over the single shared array, which made one ' +
    "organization's memory activity destroy another organization's audit evidence; that is the " +
    'fifth install-wide cap this program has found sitting behind correct read filters. ' +
    'THE PERSIST PATH AGREES WITH THE IN-MEMORY PATH, checked rather than assumed: `persist()` ' +
    'writes `{entries: this.entries}` whole, with no second slice of its own, so disk cannot hold ' +
    'a differently-trimmed log than memory. There is no other delete path — no clear, no TTL, no ' +
    'single-row delete, and `page()`\'s `slice(offset, offset + limit)` is pagination over a copy. ' +
    'STATED RATHER THAN HIDDEN: rows recorded with no resolvable tenant are UNATTRIBUTED, ' +
    '`pruneOwn` returns the list untouched when no scope resolves, and `onlyMine` shows them to ' +
    'nobody — so they are unreachable by every read and uncapped by every write. They accumulate. ' +
    'That is a growth bound, not a cross-tenant reach: no tenant can evict them and they can evict ' +
    'nobody.',
  reason:
    'WHY TENANT: `detail` is an assistant-written plain-language summary of what Founder AI chose ' +
    'to remember, recall or refuse, so the rows carry record titles verbatim; `memoryId` and ' +
    '`action` together are a timeline of one organization\'s decision-making. Round 7 found this ' +
    'log with NO tenant field, NO bindScope and its channel in PUBLIC_CHANNELS — no auth, no ' +
    'permission. The owner is stamped in `record()` from the RESOLVER, never from the caller, so a ' +
    'writer that cannot be resolved produces an unattributed row rather than one owned by the ' +
    'wrong tenant. TENANT rather than WORKSPACE because a memory lifecycle event is raised by ' +
    'tenant-level machinery (governance, projection, sync) that carries no workspace of its own. ' +
    'NO `isBound` HERE, DELIBERATELY: the seam this store owns is the `TenantOwnership` field ' +
    'below, which registers itself under this same name in `tenantOwnedStore`\'s registry and is ' +
    'already asserted at startup by `assertAllTenantStoresBound()`. A second binding predicate ' +
    'over the same seam would be a second thing to keep true, not a second check.',
});

const log = createLogger('memory-audit');

const MAX_ENTRIES = 5000;

interface AuditFile {
  entries: MemoryAuditEvent[];
}

export interface MemoryAuditQuery {
  limit?: number;
  offset?: number;
  action?: MemoryAuditAction;
  memoryId?: string;
}

export class MemoryAuditLog extends EventEmitter {
  /**
   * P13C ROUND 7 (final sweep) — the boundary this log never had.
   *
   * No tenant field, no `bindScope`, no registration — and its channel was in
   * `PUBLIC_CHANNELS`: no auth, no permission. `detail` is an assistant-written
   * plain-language summary, so the rows carry record titles verbatim.
   *
   * The memory STORE beside it is scoped and the conversation store was pulled
   * off the public list in an earlier round. This is their sibling.
   */
  private readonly tenancy = new TenantOwnership('memory-audit-log');

  /** Bind the tenant boundary. UNBOUND DENIES. Chainable. */
  bindScope(source: () => TenantScope | null): this {
    this.tenancy.bindScope(source);
    return this;
  }
  hasScope(): boolean {
    return this.tenancy.hasScope();
  }

  private entries: MemoryAuditEvent[] = [];
  private loaded = false;
  private lastPersist: Promise<void> = Promise.resolve();
  private persisting = false;
  private dirty = false;

  constructor(private readonly filePath: string) {
    super();
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const data = JSON.parse(raw) as Partial<AuditFile>;
      this.entries = Array.isArray(data.entries) ? data.entries : [];
    } catch {
      this.entries = [];
    }
    this.loaded = true;
    log.info('Memory audit log ready', { entries: this.entries.length });
  }

  private async persist(): Promise<void> {
    const file: AuditFile = { entries: this.entries };
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(file), { mode: 0o600 });
    await fs.rename(tmp, this.filePath);
  }

  private schedulePersist(): void {
    this.dirty = true;
    if (this.persisting) return;
    this.persisting = true;
    this.lastPersist = this.drainPersist();
  }

  private async drainPersist(): Promise<void> {
    try {
      while (this.dirty) {
        this.dirty = false;
        await this.persist();
      }
    } catch (err) {
      log.error('Memory audit persist failed', { error: String(err) });
    } finally {
      this.persisting = false;
    }
  }

  async flush(): Promise<void> {
    while (this.persisting) await this.lastPersist;
  }

  /** Append one event. Newest entries are kept; the oldest are trimmed past the cap. */
  record(event: MemoryAuditEvent): void {
    // Stamped from the resolver, never from the caller. An unresolved writer
    // produces an UNATTRIBUTED row rather than one owned by the wrong tenant;
    // unattributed rows reach nobody.
    const owner = this.tenancy.scopeOrDeny()?.tenantId;
    this.entries.push(owner === undefined ? event : { ...event, tenantId: owner });
    /**
     * PER TENANT. `slice(length - MAX_ENTRIES)` was install-wide, so one tenant's
     * memory activity deleted another tenant's audit evidence — the fifth
     * retention cap in this program able to do that, and the second found in this
     * round alone. A retention cap is a write.
     */
    this.entries = this.tenancy.pruneOwn(this.entries, MAX_ENTRIES, (a, b) => a.at.localeCompare(b.at));
    this.schedulePersist();
    this.emit('changed', event);
  }

  /** Page through the audit trail, newest first, with optional filters. */
  page(query: MemoryAuditQuery = {}): MemoryAuditPage {
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 1000);
    const offset = Math.max(query.offset ?? 0, 0);
    // The CALLER'S rows.
    let rows = [...this.tenancy.onlyMine(this.entries)].reverse();
    if (query.action) rows = rows.filter((e) => e.action === query.action);
    if (query.memoryId) rows = rows.filter((e) => e.memoryId === query.memoryId);
    const total = rows.length;
    return { entries: rows.slice(offset, offset + limit), total };
  }

  /** The CALLER'S row count. An install-wide size says how busy another tenant is. */
  size(): number {
    return this.tenancy.onlyMine(this.entries).length;
  }
}
