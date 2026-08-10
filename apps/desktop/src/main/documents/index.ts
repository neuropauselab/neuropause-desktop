/**
 * Document Intelligence — subsystem composition + IPC.
 *
 * UPLOAD → INSPECT → CLASSIFY → EXTRACT → VALIDATE → STORE → RELATE, with a
 * person in the loop at every step where the machine is not certain.
 *
 * FOUR RULES, STRUCTURAL RATHER THAN ADVISORY
 *
 *  1. NO FABRICATED TEXT. A PDF or an image is stored, hashed and listed, and
 *     its extraction status is `unsupported` with the reason. This build
 *     bundles no PDF engine and no OCR engine, and says so.
 *  2. NO VALUE WITHOUT EVIDENCE. Every extracted field names the line it came
 *     from and the method that found it. A field that cannot do that is not
 *     emitted.
 *  3. NO SILENT CLASSIFICATION. Below the confidence floor the document is
 *     `unknown` and the person is asked. A wrong type decides which extractor
 *     runs, so guessing it is not a small error.
 *  4. NO AUTOMATIC BUSINESS RECORDS. A file that resembles an invoice is not
 *     an instruction to create one. Links and records are PROPOSED, and the
 *     person who confirms is the person who is accountable.
 *
 * Reuses, rather than duplicating: `parseFile` (the Data Plane's parser),
 * `AppendOnlyJsonStore` (the governance substrate), `canonicalName` (the
 * relationship engine's matching), the existing audit sink, and the existing
 * enterprise module descriptors and permissions.
 */
import { join } from 'node:path';
import type {
  DocumentCapabilities,
  DocumentCorrection,
  DocumentDetail,
  DocumentField,
  DocumentIssue,
  DocumentKind,
  DocumentLink,
  DocumentLinkCandidate,
  DocumentProposal,
  DocumentRecord,
  DocumentSummary,
  DocumentUploadResult,
  EnterpriseModuleDescriptor,
  EnterprisePermission,
} from '@neuropause/shared';
import type {
  DocumentCorrectRequest as DocumentCorrectRequestType,
  DocumentDeleteRequest as DocumentDeleteRequestType,
  DocumentDetailRequest as DocumentDetailRequestType,
  DocumentLinkRequest as DocumentLinkRequestType,
  DocumentListRequest as DocumentListRequestType,
  DocumentReclassifyRequest as DocumentReclassifyRequestType,
  DocumentUploadRequest as DocumentUploadRequestType,
} from '@neuropause/shared';
import {
  DOCUMENT_KIND_LABEL,
  DocumentCorrectRequest,
  DocumentDeleteRequest,
  DocumentDetailRequest,
  DocumentLinkRequest,
  DocumentListRequest,
  DocumentReclassifyRequest,
  DocumentUploadRequest,
  EmptyRequest,
  IpcChannel,
} from '@neuropause/shared';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import type { EnterpriseRecordStore } from '../enterprise/framework/enterpriseRecordStore';
import { createLogger } from '../logger';
import { SUPPORTED_FORMATS, parseFile } from '../dataPlane/parsers';
import { canonicalName } from '../dataPlane/normalize';
import {
  CORRECTION_CONFIDENCE,
  KIND_CONFIDENCE_FLOOR,
  classifyDocument,
  coerceCorrection,
  extractInvoiceFields,
  validateInvoice,
} from './documentUnderstanding';
import { DocumentStore, MAX_DOCUMENT_BYTES, sha256Of, summarize } from './documentStore';

const log = createLogger('documents');

export interface DocumentSubsystemDeps {
  userDataDir: string;
  actor: () => string | null;
  now: () => string;
  audit: (entry: { action: string; target: string; summary: string }) => void;
  authorize: (permission: EnterprisePermission) => void;
  modules: () => readonly EnterpriseModuleDescriptor[];
  storeFor: (moduleId: string) => EnterpriseRecordStore | null;
}

export interface DocumentSubsystem {
  handlers: SecureHandlerDef[];
  store: DocumentStore;
}

/**
 * Which module a kind of document would become a record in, and how it is
 * described in words.
 *
 * Only kinds with a real destination appear. A contract has no contract module
 * in this build, so no proposal is ever offered for one — an empty map entry
 * is the honest representation of "we cannot do anything with this yet".
 */
const KIND_DESTINATION: Partial<Record<DocumentKind, { moduleId: string; relationship: string }>> = {
  invoice: { moduleId: 'finance', relationship: 'Invoice document' },
};

/** Which module a named party on a document might be, and how to say so. */
const PARTY_TARGETS: readonly {
  fieldKey: string;
  moduleId: string;
  keyFields: readonly string[];
  relationship: string;
}[] = [
  {
    fieldKey: 'customer',
    moduleId: 'crm-customers',
    keyFields: ['name', 'customerCode'],
    relationship: 'Document for this customer',
  },
  {
    fieldKey: 'vendor',
    moduleId: 'procurement-suppliers',
    keyFields: ['name', 'gst'],
    relationship: 'Document from this supplier',
  },
];

function textOf(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

export function initDocuments(deps: DocumentSubsystemDeps): DocumentSubsystem {
  const store = new DocumentStore(
    join(deps.userDataDir, 'documents.json'),
    join(deps.userDataDir, 'documents'),
    deps.now,
  );

  const CAPABILITIES: DocumentCapabilities = {
    readableFormats: [...SUPPORTED_FORMATS],
    unreadableFormats: [
      {
        format: 'pdf',
        reason: 'No PDF engine is bundled in this build, so a PDF is stored but not read.',
      },
      {
        format: 'image',
        reason: 'OCR is not configured (external dependency). An image is stored but not read.',
      },
      {
        format: 'xls',
        reason: 'Legacy .xls (OLE compound) is refused rather than mis-parsed.',
      },
    ],
    // Stated as a capability rather than left to be inferred from a blank
    // extraction. "No text was found" and "we cannot read this kind of file"
    // look identical on screen unless one of them says so.
    ocr: {
      available: false,
      reason:
        'No OCR engine is bundled. Text inside a scanned image or a PDF is not read, and none is invented.',
    },
    maxBytes: MAX_DOCUMENT_BYTES,
  };

  const descriptorFor = (moduleId: string): EnterpriseModuleDescriptor | null =>
    deps.modules().find((m) => m.id === moduleId) ?? null;

  /**
   * Records a document's named parties might refer to.
   *
   * OFFERED, never applied. An exact key match and a canonical-name match are
   * reported differently, because "ACME Ltd" ≡ "Acme Limited" is a hint and
   * two real companies can normalise to one string. Each target module's own
   * READ permission is required — a document must not become a way to
   * enumerate a module the reader cannot open.
   */
  const candidatesFor = async (doc: DocumentRecord): Promise<DocumentLinkCandidate[]> => {
    const out: DocumentLinkCandidate[] = [];
    const linked = new Set(doc.links.map((l) => `${l.moduleId}:${l.recordId}`));

    for (const target of PARTY_TARGETS) {
      const field = doc.fields.find((f) => f.key === target.fieldKey);
      const raw = textOf(field?.value).trim();
      if (raw === '') continue;

      const descriptor = descriptorFor(target.moduleId);
      if (!descriptor) continue;
      try {
        deps.authorize(descriptor.permissions.read);
      } catch {
        continue;
      }
      const recordStore = deps.storeFor(target.moduleId);
      if (!recordStore) continue;
      await recordStore.load();

      const wantedExact = raw.toLowerCase();
      const wantedCanonical = canonicalName(raw);

      for (const record of recordStore.list({ status: 'active', limit: 20_000 })) {
        if (linked.has(`${target.moduleId}:${record.id}`)) continue;
        const values = target.keyFields.map((k) => textOf(record.fields[k])).filter((v) => v !== '');
        const exact = values.some((v) => v.toLowerCase() === wantedExact);
        const normalized = !exact && values.some((v) => canonicalName(v) === wantedCanonical);
        if (!exact && !normalized) continue;
        out.push({
          moduleId: target.moduleId,
          moduleTitle: descriptor.title,
          recordId: record.id,
          recordTitle: record.title,
          relationship: target.relationship,
          match: exact ? 'exact' : 'normalized',
          basis: exact
            ? `“${raw}” on the document matches this record exactly.`
            : `“${raw}” on the document matches this record after normalising the name.`,
          fieldKey: target.fieldKey,
        });
        if (out.length >= 20) break;
      }
    }
    return out;
  };

  /**
   * The business record this document would support creating.
   *
   * A proposal with blocking reasons is still returned — the point is to show
   * why it cannot proceed, not to hide it. Nothing here writes.
   */
  const proposalFor = (doc: DocumentRecord): DocumentProposal | null => {
    const destination = KIND_DESTINATION[doc.kind];
    if (!destination) return null;
    const descriptor = descriptorFor(destination.moduleId);
    if (!descriptor) return null;

    const by = new Map(doc.fields.map((f) => [f.key, f]));
    const map: { key: string; label: string; from: string }[] = [
      { key: 'number', label: 'Invoice number', from: 'invoiceNumber' },
      { key: 'customer', label: 'Customer', from: 'customer' },
      { key: 'amount', label: 'Amount', from: 'subtotal' },
      { key: 'taxAmount', label: 'Tax', from: 'tax' },
      { key: 'total', label: 'Total', from: 'total' },
      { key: 'currency', label: 'Currency', from: 'currency' },
      { key: 'issueDate', label: 'Issue date', from: 'invoiceDate' },
      { key: 'dueDate', label: 'Due date', from: 'dueDate' },
    ];

    const fields = map
      .filter((m) => by.has(m.from))
      .map((m) => ({ key: m.key, label: m.label, value: by.get(m.from)?.value ?? null }));

    const blockedReasons: string[] = [];
    if (doc.issues.some((i) => i.severity === 'error')) {
      blockedReasons.push('The extraction has unresolved errors — fix or confirm them first.');
    }
    if (!by.has('invoiceNumber')) blockedReasons.push('No invoice number was found.');
    if (!by.has('total')) blockedReasons.push('No total was found.');
    if (doc.links.length === 0) {
      blockedReasons.push('This document is not linked to a customer or supplier yet.');
    }

    return {
      moduleId: destination.moduleId,
      moduleTitle: descriptor.title,
      fields,
      basis: `Extracted from ${doc.filename}, classified as ${DOCUMENT_KIND_LABEL[doc.kind].toLowerCase()}.`,
      blockedReasons,
      // Creating a financial record is never automatic in this app, and a
      // document-derived one is not the exception.
      requiresApproval: true,
    };
  };

  /** Classify + extract + validate. Pure over the parsed file; writes nothing. */
  const understand = (
    filename: string,
    buf: Buffer,
  ): Pick<
    DocumentRecord,
    | 'format'
    | 'status'
    | 'unsupportedReason'
    | 'kind'
    | 'kindConfidence'
    | 'kindReasons'
    | 'kindMethod'
    | 'extractionStatus'
    | 'fields'
    | 'issues'
    | 'textLength'
    | 'tableNames'
  > => {
    const parsed = parseFile(filename, buf);

    if (parsed.kind === 'unsupported') {
      return {
        format: parsed.format,
        status: 'unsupported',
        unsupportedReason: parsed.unsupportedReason ?? 'This format cannot be read by this build.',
        kind: 'unknown',
        kindConfidence: 0,
        kindReasons: ['The file could not be read, so there is nothing to classify.'],
        kindMethod: 'detected',
        extractionStatus: 'unsupported',
        fields: [],
        issues: [],
        textLength: 0,
        tableNames: [],
      };
    }

    /**
     * The text a classifier can see.
     *
     * For a tabular file the "text" is the grid rendered as lines, so an
     * invoice exported as a spreadsheet classifies on the same evidence as one
     * written as prose. Bounded, because classification reads the whole thing.
     */
    const tableText = parsed.tables
      .flatMap((t) => [t.name, ...t.rows.slice(0, 500).map((r) => r.map((c) => textOf(c)).join('  '))])
      .join('\n');
    const text = [parsed.text ?? '', tableText].filter((s) => s.length > 0).join('\n');

    const classification = classifyDocument(text, filename);
    const extraction =
      classification.kind === 'invoice'
        ? extractInvoiceFields(text, parsed.tables)
        : { fields: [] as DocumentField[], issues: [] as DocumentIssue[] };

    const issues = [
      ...extraction.issues,
      ...(classification.kind === 'invoice' ? validateInvoice(extraction.fields) : []),
    ];

    const hasErrors = issues.some((i) => i.severity === 'error');
    const extractionStatus: DocumentRecord['extractionStatus'] =
      classification.kind === 'unknown'
        ? 'not_attempted'
        : extraction.fields.length === 0
          ? 'failed'
          : hasErrors
            ? 'partial'
            : 'extracted';

    return {
      format: parsed.format,
      // `needs_review` is the honest default for anything the machine is not
      // certain about: an unknown type, or an extraction that disagrees with
      // itself.
      status:
        classification.kind === 'unknown' || hasErrors || classification.confidence < KIND_CONFIDENCE_FLOOR
          ? 'needs_review'
          : 'extracted',
      unsupportedReason: null,
      kind: classification.kind,
      kindConfidence: Math.round(classification.confidence * 100) / 100,
      kindReasons: classification.reasons,
      kindMethod: 'detected',
      extractionStatus,
      fields: extraction.fields,
      issues,
      textLength: text.length,
      tableNames: parsed.tables.map((t) => t.name),
    };
  };

  /**
   * Links the reader is allowed to see.
   *
   * `candidatesFor` gates each target module's read scope; the links did not,
   * so an actor with `data:read` and no `crm:read` could read customer names
   * out of `links[].recordTitle` — and confirm a guess through the document
   * search, whose haystack included them. A confirmed link is not less
   * sensitive than a proposed one.
   */
  const visibleLinks = (doc: DocumentRecord): DocumentLink[] =>
    doc.links.filter((link) => {
      const descriptor = descriptorFor(link.moduleId);
      if (!descriptor) return false;
      try {
        deps.authorize(descriptor.permissions.read);
        return true;
      } catch {
        return false;
      }
    });

  const detailFor = async (doc: DocumentRecord): Promise<DocumentDetail> => ({
    document: { ...doc, links: visibleLinks(doc) },
    candidates: await candidatesFor(doc),
    proposal: proposalFor(doc),
  });

  const handlers: SecureHandlerDef[] = [
    {
      channel: IpcChannel.DocumentCapabilities,
      schema: EmptyRequest,
      requireAuth: true,
      handler: (): DocumentCapabilities => {
        deps.authorize('data:read');
        return CAPABILITIES;
      },
    },
    {
      channel: IpcChannel.DocumentList,
      schema: DocumentListRequest,
      requireAuth: true,
      handler: async (p): Promise<DocumentSummary[]> => {
        const req = p as DocumentListRequestType;
        deps.authorize('data:read');
        await store.load();
        const needle = req.search?.trim().toLowerCase() ?? '';
        return store
          .all()
          .filter((d) => (req.kind === undefined ? true : d.kind === req.kind))
          .filter((d) => (req.status === undefined ? true : d.status === req.status))
          .filter((d) => {
            if (needle === '') return true;
            // Filename, type and the extracted VALUES — the three things a
            // person actually remembers about a document.
            // Deliberately WITHOUT link titles: they name records in modules
            // this reader may not be able to open, and a search box that
            // confirms a guessed name is a read of that record.
            const hay = [
              d.filename,
              DOCUMENT_KIND_LABEL[d.kind],
              ...d.fields.map((f) => textOf(f.value)),
            ]
              .join(' ')
              .toLowerCase();
            return hay.includes(needle);
          })
          .slice(0, req.limit ?? 100)
          // The link COUNT is filtered too — "3 linked" against a list the
          // reader cannot see is an answer about records they cannot read.
          .map((d) => summarize({ ...d, links: visibleLinks(d) }));
      },
    },
    {
      channel: IpcChannel.DocumentDetail,
      schema: DocumentDetailRequest,
      requireAuth: true,
      handler: async (p): Promise<DocumentDetail | null> => {
        const req = p as DocumentDetailRequestType;
        deps.authorize('data:read');
        await store.load();
        const doc = store.get(req.documentId);
        return doc ? detailFor(doc) : null;
      },
    },
    {
      /**
       * Store a file and read what can honestly be read out of it.
       *
       * `data:import` and not `data:read`: this brings data in, which is the
       * same right the Data Plane's import surface requires.
       */
      channel: IpcChannel.DocumentUpload,
      schema: DocumentUploadRequest,
      requireAuth: true,
      audit: true,
      timeoutMs: 120_000,
      handler: async (p): Promise<DocumentUploadResult> => {
        const req = p as DocumentUploadRequestType;
        deps.authorize('data:import');
        await store.load();

        const buf = Buffer.from(req.contentBase64, 'base64');
        if (buf.length === 0) throw new Error('That file is empty.');
        if (buf.length > MAX_DOCUMENT_BYTES) {
          throw new Error(
            `That file is ${(buf.length / (1024 * 1024)).toFixed(1)} MB. Documents are accepted up to ${MAX_DOCUMENT_BYTES / (1024 * 1024)} MB.`,
          );
        }

        /**
         * The same bytes twice is ONE document.
         *
         * Content-addressed, so this is exact rather than a filename heuristic
         * — renaming a file does not make it a different document, and the
         * existing record (with its links and corrections) is returned rather
         * than a fresh one that has lost them.
         */
        const existing = store.existingByHash(sha256Of(buf));
        if (existing) {
          return { document: summarize(existing), duplicate: true };
        }

        const understood = understand(req.filename, buf);
        const doc = await store.put(buf, {
          ...understood,
          filename: req.filename,
          mimeType: req.mimeType ?? 'application/octet-stream',
          uploadedAt: deps.now(),
          uploadedBy: deps.actor() ?? 'unknown',
          corrections: [],
          links: [],
        });

        deps.audit({
          action: 'documents.upload',
          target: doc.id,
          summary:
            `Stored “${doc.filename}” (${doc.format}, ${doc.sizeBytes} bytes) as ` +
            `${DOCUMENT_KIND_LABEL[doc.kind].toLowerCase()}` +
            `${doc.status === 'unsupported' ? ` — not read: ${doc.unsupportedReason ?? ''}` : ` with ${doc.fields.length} extracted field(s)`}.`,
        });
        log.info('Document stored', {
          id: doc.id,
          format: doc.format,
          kind: doc.kind,
          fields: doc.fields.length,
          status: doc.status,
        });

        return { document: summarize(doc), duplicate: false };
      },
    },
    {
      /** Correct what a document IS. Re-runs extraction from the stored bytes. */
      channel: IpcChannel.DocumentReclassify,
      schema: DocumentReclassifyRequest,
      requireAuth: true,
      audit: true,
      handler: async (p): Promise<DocumentDetail> => {
        const req = p as DocumentReclassifyRequestType;
        deps.authorize('data:import');
        await store.load();
        const doc = store.get(req.documentId);
        if (!doc) throw new Error('That document no longer exists.');
        if (doc.status === 'unsupported') {
          throw new Error(
            `“${doc.filename}” could not be read at all (${doc.unsupportedReason ?? 'unsupported format'}), so re-classifying it would change nothing.`,
          );
        }

        const bytes = await store.bytes(doc.id);
        if (!bytes) throw new Error('The stored file for this document is missing.');

        /**
         * Re-extract from the ORIGINAL BYTES with the corrected type, rather
         * than reinterpreting the previous extraction. The old fields were
         * produced by a different extractor asking different questions;
         * carrying them forward is how an override becomes worse than none.
         */
        const parsed = parseFile(doc.filename, bytes);
        const tableText = parsed.tables
          .flatMap((t) => [t.name, ...t.rows.slice(0, 500).map((r) => r.map((c) => textOf(c)).join('  '))])
          .join('\n');
        const text = [parsed.text ?? '', tableText].filter((s) => s.length > 0).join('\n');

        const extraction =
          req.kind === 'invoice'
            ? extractInvoiceFields(text, parsed.tables)
            : { fields: [] as DocumentField[], issues: [] as DocumentIssue[] };

        /**
         * Corrections survive a reclassify where the field still exists.
         *
         * Replacing `fields` wholesale reverted a reviewer's typed-in total to
         * whatever the new extractor read, leaving the correction visible only
         * in the history — a value a person had explicitly fixed, silently
         * un-fixed by a classification change.
         */
        const correctedByKey = new Map(
          doc.fields.filter((f) => f.corrected).map((f) => [f.key, f] as const),
        );
        const merged = extraction.fields.map((f) => correctedByKey.get(f.key) ?? f);
        const reissues = req.kind === 'invoice' ? validateInvoice(merged) : extraction.issues;

        const updated = store.update(doc.id, {
          kind: req.kind,
          // A person's answer is certain about the TYPE. It says nothing about
          // whether the extraction then succeeded, which is why the status
          // below still depends on the issues.
          kindConfidence: 1,
          kindMethod: 'reviewer',
          kindReasons: [
            `${deps.actor() ?? 'A reviewer'} said this is ${DOCUMENT_KIND_LABEL[req.kind].toLowerCase()}${req.reason ? ` — ${req.reason}` : ''}.`,
            `Previously read as ${DOCUMENT_KIND_LABEL[doc.kind].toLowerCase()}.`,
          ],
          fields: merged,
          issues: reissues,
          extractionStatus:
            req.kind === 'invoice'
              ? merged.length === 0
                ? 'failed'
                : reissues.some((i) => i.severity === 'error')
                  ? 'partial'
                  : 'extracted'
              : 'not_attempted',
          // A kind with no extractor read nothing, and "read, and fine" is not
          // the honest word for that.
          status:
            reissues.some((i) => i.severity === 'error') || req.kind !== 'invoice'
              ? 'needs_review'
              : 'extracted',
        });
        if (!updated) throw new Error('That document no longer exists.');

        deps.audit({
          action: 'documents.reclassify',
          target: doc.id,
          summary: `Reclassified “${doc.filename}” from ${doc.kind} to ${req.kind}${req.reason ? ` — ${req.reason}` : ''}.`,
        });
        return detailFor(updated);
      },
    },
    {
      /**
       * Override an extracted value.
       *
       * The original is never overwritten: the correction chain keeps what was
       * extracted, what it became, who changed it and why. "The system said
       * ₹1,000 and a person said ₹10,000" is the fact worth keeping.
       */
      channel: IpcChannel.DocumentCorrect,
      schema: DocumentCorrectRequest,
      requireAuth: true,
      audit: true,
      handler: async (p): Promise<DocumentDetail> => {
        const req = p as DocumentCorrectRequestType;
        deps.authorize('data:import');
        await store.load();
        const doc = store.get(req.documentId);
        if (!doc) throw new Error('That document no longer exists.');

        const index = doc.fields.findIndex((f) => f.key === req.fieldKey);
        if (index < 0) throw new Error(`This document has no “${req.fieldKey}” field to correct.`);
        const before = doc.fields[index] as DocumentField;

        /**
         * The corrected value must be the same KIND of thing.
         *
         * Correcting `total` to the string "1180" made `validateInvoice`'s
         * `typeof v === 'number'` guard fail, which switched off the
         * arithmetic check AND the "could not be checked" warning — so an
         * invoice that had raised "the arithmetic does not agree" came back
         * clean and became an approvable proposal. Laundering, by accident.
         */
        const value = coerceCorrection(before, req.value);

        const corrected: DocumentField = {
          ...before,
          value,
          evidence: {
            method: 'user_correction',
            snippet: `${deps.actor() ?? 'A reviewer'}: ${req.reason}`,
            line: before.evidence.line,
            table: before.evidence.table,
          },
          ...CORRECTION_CONFIDENCE,
          corrected: true,
        };

        const correction: DocumentCorrection = {
          at: deps.now(),
          by: deps.actor() ?? 'unknown',
          fieldKey: before.key,
          fieldLabel: before.label,
          from: before.value,
          to: value,
          reason: req.reason,
        };

        const fields = [...doc.fields];
        fields[index] = corrected;
        // Validation is re-run, because a correction can fix the arithmetic —
        // or break it. Leaving the old issues would let a corrected document
        // keep an error it no longer has, or lose one it just acquired.
        const issues = doc.kind === 'invoice' ? validateInvoice(fields) : doc.issues;

        const updated = store.update(doc.id, {
          fields,
          issues,
          corrections: [...doc.corrections, correction],
          status: issues.some((i) => i.severity === 'error') ? 'needs_review' : 'extracted',
        });
        if (!updated) throw new Error('That document no longer exists.');

        deps.audit({
          action: 'documents.correct',
          target: doc.id,
          summary: `Corrected ${before.label} on “${doc.filename}” from ${String(before.value ?? '(none)')} to ${String(value ?? '(none)')} — ${req.reason}.`,
        });
        return detailFor(updated);
      },
    },
    {
      /**
       * Confirm a link between a document and a business record.
       *
       * Double-gated exactly as import is: `data:import` to act, plus the
       * target module's own WRITE permission, because a link is an assertion
       * ABOUT that record. Read access to a customer is not authority to
       * attach an invoice to them.
       */
      channel: IpcChannel.DocumentLink,
      schema: DocumentLinkRequest,
      requireAuth: true,
      audit: true,
      handler: async (p): Promise<DocumentDetail> => {
        const req = p as DocumentLinkRequestType;
        deps.authorize('data:import');
        await store.load();
        const doc = store.get(req.documentId);
        if (!doc) throw new Error('That document no longer exists.');

        const descriptor = descriptorFor(req.moduleId);
        if (!descriptor) throw new Error(`Unknown module "${req.moduleId}".`);
        deps.authorize(descriptor.permissions.read);
        deps.authorize(descriptor.permissions.write);

        const recordStore = deps.storeFor(req.moduleId);
        if (!recordStore) throw new Error(`"${descriptor.title}" is not available in this build.`);
        await recordStore.load();
        const record = recordStore.get(req.recordId);
        if (!record || record.status === 'deleted') {
          throw new Error('That record no longer exists.');
        }

        if (doc.links.some((l) => l.moduleId === req.moduleId && l.recordId === req.recordId)) {
          return detailFor(doc);
        }

        const link: DocumentLink = {
          moduleId: req.moduleId,
          moduleTitle: descriptor.title,
          recordId: record.id,
          recordTitle: record.title,
          relationship: req.relationship,
          method: 'confirmed_by_person',
          by: deps.actor() ?? 'unknown',
          at: deps.now(),
          basis: req.basis,
        };
        const updated = store.update(doc.id, { links: [...doc.links, link] });
        if (!updated) throw new Error('That document no longer exists.');

        deps.audit({
          action: 'documents.link',
          target: doc.id,
          summary: `Linked “${doc.filename}” to ${descriptor.singular} “${record.title}” — ${req.basis}`,
        });
        return detailFor(updated);
      },
    },
    {
      channel: IpcChannel.DocumentDelete,
      schema: DocumentDeleteRequest,
      requireAuth: true,
      audit: true,
      handler: async (p): Promise<{ removed: boolean }> => {
        const req = p as DocumentDeleteRequestType;
        deps.authorize('data:import');
        await store.load();
        const doc = store.get(req.documentId);
        if (!doc) return { removed: false };
        /**
         * A document that something depends on is not removable here.
         *
         * Deleting the evidence under a link would leave a business record
         * citing a source that no longer exists — the exact failure the store
         * was built to prevent.
         */
        if (doc.links.length > 0) {
          throw new Error(
            `“${doc.filename}” is linked to ${doc.links.length} record${doc.links.length === 1 ? '' : 's'}. Remove the links first — deleting the evidence under a record is not something this does quietly.`,
          );
        }
        const removed = await store.remove(req.documentId);
        if (removed) {
          deps.audit({
            action: 'documents.delete',
            target: req.documentId,
            summary: `Deleted document “${doc.filename}”.`,
          });
        }
        return { removed };
      },
    },
  ];

  log.info('Documents ready', {
    channels: handlers.length,
    readable: CAPABILITIES.readableFormats.length,
    ocr: CAPABILITIES.ocr.available,
  });

  return { handlers, store };
}
