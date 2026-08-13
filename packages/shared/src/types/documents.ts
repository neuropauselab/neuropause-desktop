/**
 * Documents → Registry — document-management domain types + pure versioning
 * logic (W5.2). A NEW certification family; RBAC deliberately reuses
 * `operations:read` / `operations:manage` (the established precedent).
 *
 * A document is a REGISTRY entry over content that lives elsewhere (a file
 * path, a URL, a drive ref) — this platform is local-first and does not
 * embed binaries in records. VERSIONING is append-only: `Check In` snapshots
 * the draft reference + notes as version N+1 into the read-only version
 * history; history is never edited, never reordered, never shrunk. Archived
 * documents are immutable (the W1 marker pattern). OCR and e-signatures are
 * the approved report's deferred items — named here, not faked.
 *
 * Pure (no I/O), so it is shared by the backend hooks and the tests.
 */
import type { EnterpriseEntity } from './enterpriseModule';

/** The Documents module id + record kind (the framework store key). */
export const DOCUMENTS_MODULE_ID = 'documents-registry';
export const DOCUMENT_KIND = 'document';

/** One immutable version snapshot. */
export interface DocumentVersion {
  version: number;
  ref: string;
  notes: string;
  at: string;
  by: string;
}

/** A typed view over a document record's flat fields. */
export interface RegistryDocument {
  id: string;
  documentNumber: string;
  title: string;
  category: string;
  owner: string;
  currentVersion: number;
  draftRef: string;
  draftNotes: string;
  versions: DocumentVersion[];
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}
function num(v: unknown): number {
  return typeof v === 'number' ? v : Number(str(v)) || 0;
}

/** Parse the append-only version history (tolerant: bad JSON → empty). */
export function parseDocumentVersions(raw: unknown): DocumentVersion[] {
  try {
    const parsed = JSON.parse(str(raw) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((v) => typeof v === 'object' && v !== null)
      .map((v) => {
        const o = v as Record<string, unknown>;
        return {
          version: num(o.version),
          ref: str(o.ref),
          notes: str(o.notes),
          at: str(o.at),
          by: str(o.by),
        };
      });
  } catch {
    return [];
  }
}

/** Project a framework record into a typed document. */
export function documentFromRecord(record: EnterpriseEntity): RegistryDocument {
  const f = record.fields;
  return {
    id: record.id,
    documentNumber: str(f.documentNumber) || record.title,
    title: str(f.title),
    category: str(f.category),
    owner: str(f.owner),
    currentVersion: num(f.currentVersion),
    draftRef: str(f.draftRef),
    draftNotes: str(f.draftNotes),
    versions: parseDocumentVersions(f.versionsJson),
    archivedAt: str(f.archivedAt) || null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * Append version N+1 — the ONLY legal history mutation. Returns the new
 * history and the new version number; the input array is never modified.
 */
export function appendDocumentVersion(
  versions: DocumentVersion[],
  entry: { ref: string; notes: string; at: string; by: string },
): { versions: DocumentVersion[]; version: number } {
  const version = versions.reduce((max, v) => Math.max(max, v.version), 0) + 1;
  return { versions: [...versions, { version, ...entry }], version };
}
