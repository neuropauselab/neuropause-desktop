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

/** `moduleId/documentId` — unique across the registry. */
function keyOf(moduleId: string, documentId: string): string {
  return `${moduleId}/${documentId}`;
}

interface ApprovalFile {
  schemaVersion?: number;
  /** key → decisions, oldest first. */
  approvals: Record<string, ApprovalRecord[]>;
}

/** Guards against an unbounded file if a policy is ever misconfigured. */
const MAX_DECISIONS_PER_DOCUMENT = 50;

export class ApprovalStore {
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

  /** Decisions recorded so far. Never null — an unknown document has none. */
  forDocument(moduleId: string, documentId: string): ApprovalRecord[] {
    return [...(this.byDocument.get(keyOf(moduleId, documentId)) ?? [])];
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
    const capped = approvals.slice(-MAX_DECISIONS_PER_DOCUMENT);
    this.byDocument.set(keyOf(moduleId, documentId), [...capped]);
    this.schedulePersist();
  }

  /** Forget a document's approvals — used when the document itself is deleted. */
  forget(moduleId: string, documentId: string): void {
    if (this.byDocument.delete(keyOf(moduleId, documentId))) this.schedulePersist();
  }

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
