/**
 * Where approval decisions actually live.
 *
 * `approvalEngine.ts` is deliberately pure: `evaluateApproval` and
 * `applyDecision` take the existing decisions as an argument and hand back a
 * new list. That is the right shape for the rules — it makes segregation of
 * duties trivially testable — but it means the engine has no memory. Nothing
 * in the app was storing what it returned, so every approval evaluated against
 * an empty history and no document could ever reach `approved`.
 *
 * This is that memory, and nothing more. It holds decisions; it does not
 * decide. The rules stay in one place.
 *
 * Append-only by design: a rejection followed by an approval is a sequence a
 * reader needs to see, not a value to overwrite. `applyDecision` already
 * refuses a repeat decision by the same approver on the same step, so growth
 * is bounded by the policy rather than by trust in the caller.
 *
 * Electron-free — the path is injected, so this runs under plain Node in tests.
 */
import { promises as fs } from 'node:fs';
import type { ApprovalRecord } from './approvalEngine';
import { readStoreFile, envelopeStamp } from '../storage/storeEnvelope';
import type { TenantScope } from '@neuropause/shared';
import { TenantOwnership } from '../tenancy/tenantOwnedStore';

/** `moduleId/documentId` — unique across the registry. */

interface ApprovalFile {
  schemaVersion?: number;
  /** key → decisions, oldest first. */
  approvals: Record<string, ApprovalRecord[]>;
}

/** Guards against an unbounded file if a policy is ever misconfigured. */
const MAX_DECISIONS_PER_DOCUMENT = 50;

export class ApprovalStore {
  /**
   * P13C ROUND 5 — TENANT-SCOPED.
   *
   * The primary key here is `moduleId/documentId` — a tenant's purchase order,
   * invoice or quote — and the values are named approvers plus free-text notes
   * about that document. There was no owner field at all.
   *
   * Its safety today is entirely BORROWED: the two IPC handlers resolve the
   * record through the scoped module store first, so a foreign id reads as
   * absent before this store is reached. That closes the reachable path and
   * leaves the store one new caller away from a disclosure, which is exactly
   * the shape the migration inventory has recorded as REQUIRES_MIGRATION.
   */
  private readonly tenancy = new TenantOwnership('erp-approvals');

  /** Bind the tenant boundary. UNBOUND DENIES. Chainable. */
  bindScope(source: () => TenantScope | null): this {
    this.tenancy.bindScope(source);
    return this;
  }
  hasScope(): boolean {
    return this.tenancy.hasScope();
  }

  /**
   * The tenant-qualified key.
   *
   * Keying rather than filtering, for the reason H4 gave: a filter is something
   * a future accessor can forget and a key is not. Two tenants may hold the same
   * `moduleId/documentId` without colliding, which they previously could not.
   */
  private scopedKey(moduleId: string, documentId: string): string | null {
    const tenantId = this.tenancy.scopeOrDeny()?.tenantId ?? null;
    if (tenantId === null || tenantId === '') return null;
    return JSON.stringify([tenantId, moduleId, documentId]);
  }

  private byDocument = new Map<string, ApprovalRecord[]>();
  private loaded = false;
  private persisting = false;
  private dirty = false;
  private lastPersist: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    const result = await readStoreFile<Partial<ApprovalFile>>(this.filePath);
    if (result.state === 'loaded' && result.data?.approvals) {
      for (const [key, list] of Object.entries(result.data.approvals)) {
        if (Array.isArray(list)) this.byDocument.set(key, list.filter((r) => Boolean(r?.stepId)));
      }
    }
    this.loaded = true;
  }

  /**
   * Decisions recorded so far, FOR THE CALLER'S DOCUMENT.
   *
   * An unresolved caller and an unknown document give the same answer — an
   * empty list — so the read is not an existence oracle over another tenant's
   * document ids.
   */
  forDocument(moduleId: string, documentId: string): ApprovalRecord[] {
    const key = this.scopedKey(moduleId, documentId);
    if (key === null) return [];
    return [...(this.byDocument.get(key) ?? [])];
  }

  /**
   * Replace the decision list for a document.
   *
   * Takes the whole list rather than one decision because that is exactly what
   * `applyDecision` returns — passing the engine's output straight through
   * removes any chance of this store and the engine disagreeing about what was
   * decided.
   */
  replace(moduleId: string, documentId: string, approvals: readonly ApprovalRecord[]): void {
    const key = this.scopedKey(moduleId, documentId);
    // A decision with no tenant would be written under a key nobody can read
    // back — the row would exist, gate nothing, and be invisible. Refuse it.
    if (key === null) return;
    const capped = approvals.slice(-MAX_DECISIONS_PER_DOCUMENT);
    this.byDocument.set(key, [...capped]);
    this.schedulePersist();
  }

  /** Forget a document's approvals — used when the document itself is deleted. */
  forget(moduleId: string, documentId: string): void {
    const key = this.scopedKey(moduleId, documentId);
    if (key !== null && this.byDocument.delete(key)) this.schedulePersist();
  }

  /**
   * Total documents with decisions, ACROSS TENANTS.
   *
   * Deliberately unscoped and deliberately narrow: it returns one integer and no
   * content, and it exists for the migration inventory's evidence that
   * pre-Round-5 rows are held under unscoped keys and shown to nobody. It has no
   * production caller.
   */
  count(): number {
    return this.byDocument.size;
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
        const file: ApprovalFile = {
          ...envelopeStamp(),
          approvals: Object.fromEntries(this.byDocument),
        };
        const tmp = `${this.filePath}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(file), { mode: 0o600 });
        await fs.rename(tmp, this.filePath);
      }
    } catch {
      // A failed write must not unwind the decision the user just made; the
      // in-memory list stays authoritative for this session.
    } finally {
      this.persisting = false;
    }
  }

  async flush(): Promise<void> {
    while (this.persisting) await this.lastPersist;
  }
}
