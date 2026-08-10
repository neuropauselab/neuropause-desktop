/**
 * Document Intelligence — wire-facing types.
 *
 * A document here is a FILE: bytes on disk, with a record describing what was
 * read out of it and where each value came from. That is deliberately
 * different from the two things this codebase already calls a document —
 * `documents-registry` (a record pointing at a path someone else owns) and the
 * ERP document layer (an invoice/PO/bill with line items and an approval
 * policy). Neither of those holds a file, and neither is replaced here.
 *
 * THE RULE THIS MODEL EXISTS TO ENFORCE
 *
 * A value with no evidence is not an extraction. It is an invention. So
 * `DocumentField.evidence` is not optional: every field names the exact text
 * it was read from and the line it was on, and a field that cannot do that is
 * not emitted at all. "The total is ₹1,180" and "I could not find a total" are
 * both acceptable answers; "the total is probably ₹1,180" is not, unless the
 * word "probably" is backed by a stated basis.
 *
 * WHAT THIS BUILD CANNOT DO
 *
 * There is no PDF engine and no OCR engine bundled. A PDF or an image is
 * stored, hashed and listed — and its extraction status is `unsupported`, with
 * the reason. No text is guessed at, and nothing downstream is allowed to read
 * as though extraction succeeded.
 */

/** What a document appears to be. `unknown` is a real answer, not a failure. */
export type DocumentKind =
  | 'invoice'
  | 'purchase_order'
  | 'receipt'
  | 'quote'
  | 'contract'
  | 'statement'
  | 'report'
  | 'other'
  | 'unknown';

export const DOCUMENT_KIND_LABEL: Record<DocumentKind, string> = {
  invoice: 'Invoice',
  purchase_order: 'Purchase order',
  receipt: 'Receipt',
  quote: 'Quote',
  contract: 'Contract',
  statement: 'Statement',
  report: 'Report',
  other: 'Other document',
  unknown: 'Not recognised',
};

export type DocumentStatus =
  /** Bytes are on disk and hashed; nothing has been read out yet. */
  | 'stored'
  /** Read and understood well enough to act on. */
  | 'extracted'
  /** Read, but something needs a person before it can be used. */
  | 'needs_review'
  /** The format cannot be read by this build. Stored, never guessed at. */
  | 'unsupported';

export type DocumentExtractionStatus =
  | 'not_attempted'
  | 'unsupported'
  | 'extracted'
  | 'partial'
  | 'failed';

/**
 * Where a value came from, precisely enough to go and look.
 *
 * `snippet` is the actual source text, not a paraphrase. It is what makes
 * "where did this number come from?" answerable by a person holding the
 * original file.
 */
export interface DocumentEvidence {
  method:
    /** A label and its value on the same line: `Invoice Number: INV-0001`. */
    | 'labelled_value'
    /** A label on one line and the value on the next. */
    | 'labelled_next_line'
    /** A cell in a table the parser recognised. */
    | 'table_cell'
    /** A pattern matched somewhere in the text with no adjacent label. */
    | 'pattern'
    /** Read from the file name — weak, and always marked as such. */
    | 'filename'
    /** A person typed it. The strongest evidence there is. */
    | 'user_correction';
  /** The exact source text. */
  snippet: string;
  /** One-based line in the extracted text, when the method has one. */
  line: number | null;
  /** Table or sheet name, for a tabular source. */
  table: string | null;
}

export interface DocumentField {
  key: string;
  label: string;
  /** Null when a field is known to be absent — distinct from a wrong guess. */
  value: string | number | null;
  evidence: DocumentEvidence;
  /**
   * How much the extraction method is trusted, 0–1.
   *
   * Never produced by a model. It is a fixed number per method, because a
   * confidence that varies for reasons nobody can state is worse than no
   * confidence at all.
   */
  confidence: number;
  /** The stated reason for that number, in words. */
  confidenceBasis: string;
  /** True once a person has overridden the extracted value. */
  corrected: boolean;
}

/** A person's override, kept forever alongside what it replaced. */
export interface DocumentCorrection {
  at: string;
  by: string;
  fieldKey: string;
  fieldLabel: string;
  from: string | number | null;
  to: string | number | null;
  reason: string;
}

export interface DocumentIssue {
  severity: 'error' | 'warning';
  /** The field this concerns, when it concerns one. */
  fieldKey: string | null;
  message: string;
}

/** A confirmed connection between a document and a business record. */
export interface DocumentLink {
  moduleId: string;
  moduleTitle: string;
  recordId: string;
  recordTitle: string;
  /** Plain words: "Invoice for this customer". */
  relationship: string;
  /** How the connection was established. Never `auto` — a person confirms. */
  method: 'confirmed_by_person';
  by: string;
  at: string;
  /** The document value that justified offering it. */
  basis: string;
}

/** A connection the engine can support with evidence but will not make itself. */
export interface DocumentLinkCandidate {
  moduleId: string;
  moduleTitle: string;
  recordId: string;
  recordTitle: string;
  relationship: string;
  /** `exact` — a declared key matched literally. `normalized` — only after canonicalising. */
  match: 'exact' | 'normalized';
  basis: string;
  fieldKey: string;
}

export interface DocumentRecord {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** Content hash. Also the de-duplication key — the same file twice is one document. */
  sha256: string;
  uploadedAt: string;
  uploadedBy: string;
  /** The parser's verdict on the format, e.g. `docx`, `pdf`, `csv`. */
  format: string;
  status: DocumentStatus;
  /** Set when the format cannot be read. Shown verbatim, never softened. */
  unsupportedReason: string | null;

  kind: DocumentKind;
  kindConfidence: number;
  /** The evidence for the classification, in words. */
  kindReasons: string[];
  kindMethod: 'detected' | 'reviewer';

  extractionStatus: DocumentExtractionStatus;
  fields: DocumentField[];
  corrections: DocumentCorrection[];
  issues: DocumentIssue[];
  links: DocumentLink[];

  /** How much text was actually read. Zero is a fact worth showing. */
  textLength: number;
  /** Tables the parser found, by name. */
  tableNames: string[];
}

/** A document as the list view needs it — no fields, no text. */
export interface DocumentSummary {
  id: string;
  filename: string;
  sizeBytes: number;
  uploadedAt: string;
  uploadedBy: string;
  format: string;
  status: DocumentStatus;
  kind: DocumentKind;
  kindConfidence: number;
  extractionStatus: DocumentExtractionStatus;
  fieldCount: number;
  linkCount: number;
  issueCount: number;
  unsupportedReason: string | null;
}

/** The detail view: the record, plus what could be linked and what it costs. */
export interface DocumentDetail {
  document: DocumentRecord;
  candidates: DocumentLinkCandidate[];
  /**
   * A business action the document's contents would support, if a person
   * approves it. Never executed automatically.
   */
  proposal: DocumentProposal | null;
}

/**
 * A proposed business record, derived from a document.
 *
 * Held as a PROPOSAL rather than executed, because a file that resembles an
 * invoice is not an instruction to create one. The person who approves it is
 * the person who is accountable for it.
 */
export interface DocumentProposal {
  moduleId: string;
  moduleTitle: string;
  /** What would be created, field by field, with the document as the source. */
  fields: { key: string; label: string; value: string | number | null }[];
  /** Why this is being offered. */
  basis: string;
  /** Blocking reasons — a proposal that cannot proceed says so. */
  blockedReasons: string[];
  /** True when the destination requires an explicit approval to create. */
  requiresApproval: boolean;
}

export interface DocumentUploadResult {
  document: DocumentSummary;
  /** True when this file was already stored; the existing record is returned. */
  duplicate: boolean;
}

/** What this build can read, and what it deliberately cannot. */
export interface DocumentCapabilities {
  readableFormats: string[];
  unreadableFormats: { format: string; reason: string }[];
  /** Stated plainly so no screen has to imply otherwise. */
  ocr: { available: boolean; reason: string };
  maxBytes: number;
}
