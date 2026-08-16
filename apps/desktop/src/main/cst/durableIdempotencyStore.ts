/**
 * P13C H-FINDING-4 (Option C) — a Node-20-compatible, restart-durable CST IdempotencyStore for the
 * M365 IPC governed-action Cohort-1 path.
 *
 * Why this exists: the CST kernel's restart/replay control flow is store-agnostic and already
 * correct — a replay of a DONE key returns the original outcome without re-executing, and an
 * IN_FLIGHT key reconciles/HOLDs rather than re-executes (NP-CST-106/107, NP-NC-08/13/16). What is
 * missing for restart durability is a durable IDEMPOTENCY INTENT store. The frozen CST DurableStore
 * uses `node:sqlite` (Node ≥22), which is unavailable under this app's declared Node-20 floor
 * (CST-1.3.0-DEFECTS-FOUND.md D-CST-B). This class provides the same intent durability using the
 * repository's Node-20-safe atomic-rename pattern (cf. ExecutionStore), adapted to the SYNCHRONOUS
 * `IdempotencyStorePort` contract.
 *
 * SCOPE (declared): SINGLE-PROCESS restart durability. The CLAIM store stays in-memory — atomic
 * single-winner is a within-process property (NP-PG-10), and a fresh process holds no in-flight
 * claims; only the intent (NP-PG-09 DURABILITY) must cross a process boundary.
 *
 * NOT provided / NOT claimed: fsync / power-loss durability (atomic rename only, no fsync);
 * cross-process or multi-instance atomic single-winner (a JSON file has no cross-process
 * check-reserve primitive — SQLite PRIMARY KEY would, but node:sqlite is unavailable here).
 *
 * Fail-closed: the port methods are SYNCHRONOUS, so persistence is synchronous (`writeFileSync` +
 * atomic `renameSync`) and completes BEFORE the method returns — preserving the kernel's atomic
 * check→reserve→persist with no suspension point. A corrupt persisted file throws on construction
 * (it is NEVER silently reset to "nothing consumed", which could permit a duplicate effect). A
 * persistence failure at `acquire` rolls the in-memory reservation back and rethrows, so no
 * admission (and therefore no effect) is recorded.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { IdempotencyStorePort, IntentState } from '@neuropause/cst/dist/src/stores.js';
import type { IdempotencyKey } from '@neuropause/cst/dist/src/types.js';
import { declareStoreScope } from '../tenancy/storeScope';

/**
 * The governed-action idempotency ledger is TENANT-scoped CUSTOMER_DERIVED state: every record is
 * intrinsically tenant-attributed because the intent key is
 * `sha256(canonicalize({ tenantId, connectorId, accountId, actionId, params }))`. The CST kernel
 * accesses it only by EXACT key, never by tenant query or bulk operation, so no read discloses and
 * no removal reaches across a tenant boundary. This is the DURABILITY half of the boundary — the
 * same shape as `execute-engine-sessions`.
 */
declareStoreScope({
  name: 'm365-governed-action-idempotency',
  scope: 'TENANT',
  persistence: 'file',
  // The CST kernel writes/completes/releases automatically; no user-facing surface mutates it.
  authority: 'SYSTEM',
  classification: 'CUSTOMER_DERIVED',
  retentionScope: 'OWNER',
  retentionAuthority: 'SYSTEM',
  retention:
    'Two removals, both by EXACT tenant-embedding idempotency key — never a cap, TTL or bulk sweep. ' +
    '(1) `release(key)` drops an IN_FLIGHT intent that acquired but never reached its effect (kernel ' +
    'revalidation/replay bail), reaching only the single record whose exact key the caller holds; a ' +
    'DONE intent is NEVER released. (2) `complete(key, outcome)` overwrites the same key in place ' +
    '(IN_FLIGHT→DONE), a write, not a delete. Because the key embeds `tenantId`, no removal can reach ' +
    "another tenant's record — it would require that tenant's exact key. No count cap, no age sweep, " +
    'no cross-owner deletion path.',
  reason:
    'Single-process restart-durable single-use for the H-FINDING-4 Cohort-1 M365 IPC governed-action ' +
    'path: the durable intent (NP-PG-09) prevents a second consequential effect after a process ' +
    'restart. Tenant-safe by KEY CONSTRUCTION (the canonical binding embeds tenantId) rather than by a ' +
    'per-tenant partition, because the CST kernel only ever reads/writes an exact key. This is the ' +
    'destruction/durability half of the boundary, mirroring `execute-engine-sessions`.',
});

/** A corrupt/unreadable persisted store — surfaced (never silently reset) so single-use is not lost. */
export class DurableStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DurableStoreError';
  }
}

interface IntentRecord {
  readonly state: IntentState;
  readonly outcome?: unknown;
}
interface FileShape {
  readonly version: 1;
  readonly records: Record<string, IntentRecord>;
}

function isIntentRecord(v: unknown): v is IntentRecord {
  if (typeof v !== 'object' || v === null) return false;
  const state = (v as { state?: unknown }).state;
  return state === 'IN_FLIGHT' || state === 'DONE';
}
function isFileShape(v: unknown): v is FileShape {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as { version?: unknown; records?: unknown };
  return o.version === 1 && typeof o.records === 'object' && o.records !== null;
}

export class DurableIdempotencyStore implements IdempotencyStorePort {
  private readonly records = new Map<string, IntentRecord>();

  constructor(private readonly filePath: string) {
    this.hydrate();
  }

  /** Load durable intents on construction (= process boot). Missing file = fresh; corrupt = FAIL CLOSED. */
  private hydrate(): void {
    let raw: string;
    try {
      raw = readFileSync(this.filePath, 'utf8');
    } catch (err) {
      // A file that never existed means nothing was consumed yet — a safe empty start. Any OTHER
      // read error (permissions, I/O) is NOT provably-empty, so fail closed rather than assume empty.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw new DurableStoreError(`unreadable idempotency store at ${this.filePath}: ${(err as Error).message}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new DurableStoreError(`corrupt idempotency store at ${this.filePath}: invalid JSON`);
    }
    if (!isFileShape(parsed)) {
      throw new DurableStoreError(`corrupt idempotency store at ${this.filePath}: unexpected shape`);
    }
    for (const [key, rec] of Object.entries(parsed.records)) {
      if (!isIntentRecord(rec)) {
        throw new DurableStoreError(`corrupt idempotency store at ${this.filePath}: invalid record for ${key}`);
      }
      this.records.set(key, rec.state === 'DONE' ? { state: 'DONE', outcome: rec.outcome } : { state: 'IN_FLIGHT' });
    }
  }

  /** NP-CST-106 — the intent record is written (DURABLY) BEFORE the external effect. */
  acquire(key: IdempotencyKey): { fresh: boolean; state: IntentState; outcome?: unknown } {
    const k = String(key);
    const existing = this.records.get(k);
    if (existing) {
      return existing.state === 'DONE'
        ? { fresh: false, state: 'DONE', outcome: existing.outcome }
        : { fresh: false, state: 'IN_FLIGHT' };
    }
    this.records.set(k, { state: 'IN_FLIGHT' });
    try {
      this.persist();
    } catch (err) {
      // Durable reservation failed ⇒ NO admission (and therefore no effect). Roll back and rethrow.
      this.records.delete(k);
      throw err;
    }
    return { fresh: true, state: 'IN_FLIGHT' };
  }

  /** NP-CST-107 — store the whole original outcome so a replay reports it (without re-executing). */
  complete(key: IdempotencyKey, outcome: unknown): void {
    this.records.set(String(key), { state: 'DONE', outcome });
    // The intent's durable IN_FLIGHT (from acquire) already prevents restart re-execution (→ HOLD);
    // recording DONE is a strengthening. If persisting DONE fails, the IN_FLIGHT durable record still
    // protects replay, so do not throw out of the kernel's post-effect path — keep the in-memory DONE.
    try {
      this.persist();
    } catch {
      /* IN_FLIGHT durable record remains the safety net; in-memory DONE protects this process. */
    }
  }

  /** Released when the transition bails AFTER acquire but BEFORE the effect (kernel revalidation/replay). */
  release(key: IdempotencyKey): void {
    const k = String(key);
    if (this.records.get(k)?.state !== 'IN_FLIGHT') return;
    this.records.delete(k);
    try {
      this.persist();
    } catch {
      /* Conservative: if the deletion cannot be persisted, the durable IN_FLIGHT remains and a future
         replay HOLDs (fail-closed: never a duplicate effect), pending operator resolution. */
    }
  }

  /** Synchronous atomic write: temp file → `renameSync`. Node-20-safe. NO fsync (no power-loss claim). */
  private persist(): void {
    const file: FileShape = { version: 1, records: Object.fromEntries(this.records) };
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    writeFileSync(tmp, JSON.stringify(file), { mode: 0o600 });
    renameSync(tmp, this.filePath);
  }
}
