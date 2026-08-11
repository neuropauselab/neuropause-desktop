/**
 * Documents: the record, and the bytes.
 *
 * Before this, nothing in the app stored an uploaded file. The importer took
 * base64 across IPC, parsed it, and threw the buffer away — so "where did this
 * value come from?" could be answered with a filename and never with the file.
 * A provenance trail whose evidence has been deleted is a claim, not a trail.
 *
 * DESIGN
 *
 *  - CONTENT-ADDRESSED. The file is stored under its own SHA-256, so uploading
 *    the same document twice costs one copy and produces one record. It also
 *    means the digest in a manifest or an audit line can be checked against
 *    what is actually on disk.
 *  - BYTES AND METADATA ARE SEPARATE. Blobs live under `documents/`; the
 *    records live in one JSON file on the existing `AppendOnlyJsonStore`
 *    substrate — atomic, coalesced, capped, fail-quiet — rather than a second
 *    persistence mechanism invented here.
 *  - DELETION IS REFERENCE-COUNTED. Two records can point at one blob after a
 *    duplicate upload; removing one must not blind the other.
 *  - THE PATH IS DERIVED, NEVER SUPPLIED. Callers name documents by id. A
 *    filename from a renderer never reaches `join`, so `../../` is not an
 *    input this code has.
 */
import { promises as fs } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { DocumentRecord, DocumentSummary } from '@neuropause/shared';
import { AppendOnlyJsonStore } from '../decisions/appendOnlyStore';

/**
 * Documents kept. Oldest fall off first, as everywhere else in the app —
 * except that a LINKED document is never evicted; see `onEvicted`.
 *
 * Exported so the eviction behaviour can be tested by uploading a few more
 * than the cap rather than two thousand files.
 */
const MAX_DOCUMENTS = 40;
export const MAX_DOCUMENTS_FOR_TEST = MAX_DOCUMENTS;

/**
 * The largest file accepted.
 *
 * Bounded because the bytes cross IPC as base64 before they reach here, and an
 * unbounded upload is an unbounded renderer allocation.
 */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

export function sha256Of(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

export function summarize(doc: DocumentRecord): DocumentSummary {
  return {
    id: doc.id,
    filename: doc.filename,
    sizeBytes: doc.sizeBytes,
    uploadedAt: doc.uploadedAt,
    uploadedBy: doc.uploadedBy,
    format: doc.format,
    status: doc.status,
    kind: doc.kind,
    kindConfidence: doc.kindConfidence,
    extractionStatus: doc.extractionStatus,
    fieldCount: doc.fields.length,
    linkCount: doc.links.length,
    issueCount: doc.issues.length,
    unsupportedReason: doc.unsupportedReason,
  };
}

export class DocumentStore extends AppendOnlyJsonStore<DocumentRecord> {
  constructor(
    filePath: string,
    private readonly blobDir: string,
    now: () => string,
  ) {
    super(filePath, MAX_DOCUMENTS, now, 'documents');
  }

  /** Where a blob lives. Derived from the digest — never from a filename. */
  private blobPath(sha256: string): string {
    return join(this.blobDir, `${sha256}.bin`);
  }

  /**
   * The cap fell on these. Two things have to happen that the base class
   * cannot know about.
   *
   *  1. THE BYTES GO TOO. Otherwise `documents/` grows without bound —
   *     25 MB × every file ever uploaded — and nothing ever references those
   *     blobs again, so nothing ever removes them.
   *  2. A LINKED DOCUMENT IS PUT BACK. `documents:delete` refuses to remove a
   *     document that a business record cites; eviction went around that
   *     guard entirely and took the link with it. The oldest UNLINKED record
   *     is dropped instead, and if every record is linked the cap yields —
   *     a bounded file is worth less than a business record that can still
   *     name its source.
   */
  protected override onEvicted(evicted: readonly DocumentRecord[]): void {
    const dropped: DocumentRecord[] = [];
    for (const doc of evicted) {
      if (doc.links.length > 0) {
        // Re-admitted. Uses the unscoped readmit seam because eviction is
        // bookkeeping over the whole file, not a tenant-facing read.
        this.readmit(doc);
        continue;
      }
      dropped.push(doc);
    }
    for (const doc of dropped) {
      /**
       * The blob reference count spans EVERY tenant, deliberately.
       *
       * The pool is content-addressed, so two tenants that upload byte-identical
       * files share one blob on disk. Counting only the acting tenant's records
       * would delete a file the other tenant's record still names. That the pool
       * is shared is a real limitation and is documented in the security note;
       * deleting another tenant's bytes would be a worse one.
       */
      if (!this.allUnscoped().some((d) => d.sha256 === doc.sha256)) {
        void fs.rm(this.blobPath(doc.sha256), { force: true }).catch(() => undefined);
      }
    }
  }

  async ensureDir(): Promise<void> {
    await fs.mkdir(this.blobDir, { recursive: true, mode: 0o700 });
  }

  /**
   * The record for a previously-stored identical file, WITHIN SCOPE.
   *
   * A CONTENT HASH IS NOT AUTHORIZATION. Unscoped, this was the sharpest oracle
   * in the app and it was worse than a read: upload a file byte-identical to
   * another tenant's and the response returned THEIR record — its id, who
   * uploaded it, when, how many fields were extracted, how many links it has —
   * plus `duplicate: true`, which confirms those exact bytes exist in the
   * install. And the id it handed back then fed detail, correct, reclassify and
   * delete.
   *
   * Scoped, a duplicate upload across tenants now produces two records that
   * happen to share one blob. That is the correct outcome: the bytes are
   * deduplicated on disk, the KNOWLEDGE that they exist is not.
   */
  existingByHash(sha256: string): DocumentRecord | null {
    return this.visible().find((d) => d.sha256 === sha256) ?? null;
  }

  /**
   * One document by id, or null.
   *
   * The same `null` for "no such document", "another tenant's" and "no scope" —
   * indistinguishable, so an id cannot be used to confirm existence.
   */
  get(id: string): DocumentRecord | null {
    return this.visible().find((d) => d.id === id) ?? null;
  }

  all(): DocumentRecord[] {
    // Newest first — the order a person looking for what they just uploaded
    // expects, and the order the list view renders without re-sorting.
    return this.visible().reverse();
  }

  /**
   * Write the bytes and append the record.
   *
   * Bytes first, deliberately: a record pointing at a file that does not exist
   * is a broken promise, while a blob with no record is merely wasted space
   * that the next identical upload will adopt.
   */
  async put(bytes: Buffer, record: Omit<DocumentRecord, 'id' | 'sha256' | 'sizeBytes'>): Promise<DocumentRecord> {
    await this.ensureDir();
    const sha256 = sha256Of(bytes);
    const path = this.blobPath(sha256);
    // `wx` fails when it already exists, which is exactly right for
    // content-addressed storage: identical content needs no second write.
    await fs.writeFile(path, bytes, { mode: 0o600, flag: 'wx' }).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'EEXIST') throw err;
    });

    const full: DocumentRecord = {
      ...record,
      id: `doc_${randomUUID()}`,
      sha256,
      sizeBytes: bytes.length,
    };
    this.append(full);
    return full;
  }

  /** Read a document's bytes back. Null when the blob has gone missing. */
  async bytes(id: string): Promise<Buffer | null> {
    const doc = this.get(id);
    if (!doc) return null;
    return fs.readFile(this.blobPath(doc.sha256)).catch(() => null);
  }

  /** Apply a patch to a stored record and persist it. */
  update(id: string, patch: Partial<DocumentRecord>): DocumentRecord | null {
    const doc = this.visible().find((d) => d.id === id);
    if (!doc) return null;
    return this.mutate(doc, patch);
  }

  /**
   * Forget a document, and its bytes when nothing else points at them.
   *
   * The reference count is over the records themselves, not a separate tally
   * — a counter that can drift from the thing it counts is a counter that
   * will. Two records can share one blob after a duplicate upload, so removing
   * one must not blind the other.
   */
  async remove(id: string): Promise<boolean> {
    const removed = this.removeWhere((d) => d.id === id);
    const doc = removed[0];
    if (!doc) return false;
    // Reference count over EVERY tenant's records — see `onEvicted`. One
    // tenant removing its record must not delete bytes another still names.
    if (!this.allUnscoped().some((d) => d.sha256 === doc.sha256)) {
      await fs.rm(this.blobPath(doc.sha256), { force: true }).catch(() => undefined);
    }
    return true;
  }
}
