/**
 * Documents → Registry — document management on the Enterprise Module
 * Framework (W5.2), opening the Documents family. CRUD, RBAC
 * (`operations:read` / `operations:manage` — the established reuse
 * precedent), audit, timeline, search, offline persistence, and the UI are
 * all inherited.
 *
 * A document REGISTERS content living elsewhere (path/URL/drive ref) —
 * local-first, no embedded binaries. `Check In` is the only history
 * mutation: it snapshots the draft ref + notes as version N+1 into the
 * read-only, append-only history and clears the draft. Archived documents
 * are immutable (the W1 marker pattern). OCR and e-signatures remain the
 * approved report's deferred items — named, not faked.
 *
 * Electron-free (store paths injected), so it unit-tests without the app runtime.
 */
import type {
  EnterpriseModuleDescriptor,
  EnterpriseRecordInput,
  EnterpriseRecordSummary,
  EnterpriseRecordValidation,
} from '@neuropause/shared';
import {
  DOCUMENTS_MODULE_ID,
  DOCUMENT_KIND,
  appendDocumentVersion,
  documentFromRecord,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';

/** The descriptor action keys the Documents module surfaces. */
export const CHECK_IN_ACTION = 'checkIn';
export const ARCHIVE_DOCUMENT_ACTION = 'archive';

/** The declarative description of a document — drives store, CRUD, and the UI. */
export const DOCUMENT_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: DOCUMENTS_MODULE_ID,
  title: 'Documents',
  singular: 'Document',
  plural: 'Documents',
  icon: 'file',
  description:
    'The document registry — content lives elsewhere, versions are append-only check-in snapshots, archives are immutable.',
  group: 'Documents',
  titleField: 'title',
  // Reuses the certified operations scopes (the established precedent).
  permissions: { read: 'operations:read', write: 'operations:manage' },
  actions: [
    { key: CHECK_IN_ACTION, label: 'Check In', icon: 'check' },
    { key: ARCHIVE_DOCUMENT_ACTION, label: 'Archive', icon: 'close' },
  ],
  fields: [
    { key: 'documentNumber', label: 'Document #', type: 'text', required: true, placeholder: 'DOC-0001' },
    { key: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Pilot deployment SOP' },
    { key: 'category', label: 'Category', type: 'text', filterable: true },
    { key: 'owner', label: 'Owner', type: 'text' },
    { key: 'currentVersion', label: 'Version', type: 'number', readOnly: true, default: 0 },
    { key: 'draftRef', label: 'Draft Ref', type: 'text', column: false, placeholder: 'Path / URL of the next version' },
    { key: 'draftNotes', label: 'Draft Notes', type: 'text', column: false, placeholder: 'What changed in this version' },
    { key: 'versionsJson', label: 'History', type: 'textarea', readOnly: true, column: false },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      readOnly: true,
      default: 'active',
      badge: true,
      filterable: true,
      options: [
        { value: 'active', label: 'Active', tone: 'green' },
        { value: 'archived', label: 'Archived', tone: 'neutral' },
      ],
    },
    { key: 'archivedAt', label: 'Archived At', type: 'text', readOnly: true, column: false },
    { key: 'notes', label: 'Notes', type: 'textarea', column: false, placeholder: 'Optional notes…' },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/** Build the Documents module — the registry behind append-only versioning. */
export function createDocumentModule(storePath: string): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, DOCUMENTS_MODULE_ID, DOCUMENT_KIND);
  return defineEnterpriseModule({
    descriptor: DOCUMENT_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(DOCUMENT_DESCRIPTOR, input);
        if (!result.ok) return result;
        if (str(input.fields?.archivedAt)) {
          return {
            ok: false,
            errors: { status: 'This document is archived — archived documents are immutable history.' },
            values: result.values,
          };
        }
        result.values.status = 'active';
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const doc = documentFromRecord(record);
        const latest = doc.versions[doc.versions.length - 1];
        return {
          moduleId: DOCUMENTS_MODULE_ID,
          recordId: record.id,
          headline: `${doc.documentNumber} · v${doc.currentVersion} · ${doc.archivedAt ? 'archived' : 'active'}`,
          summary:
            `${doc.title}${doc.category ? ` (${doc.category})` : ''} — ${doc.versions.length} version(s)` +
            (latest ? `; latest v${latest.version} at ${latest.at}${latest.notes ? ` — ${latest.notes}` : ''}` : '; nothing checked in yet') +
            (doc.draftRef ? '. A draft is staged for the next check-in.' : '.'),
          risk: doc.currentVersion === 0 && !doc.archivedAt ? 'medium' : 'low',
          riskReason:
            doc.currentVersion === 0 && !doc.archivedAt
              ? 'Registered but never checked in — the registry entry points at nothing yet.'
              : 'Version history is append-only and audit-backed.',
          executiveExplanation:
            'Documents register content that lives elsewhere; every check-in is an immutable version snapshot. OCR and e-signatures are the approved deferred items.',
          grounded: false,
          model: 'none',
        };
      },
      runAction: async (action, record, actionCtx) => {
        const doc = documentFromRecord(record);
        if (doc.archivedAt) return { ok: false, error: 'This document is archived — archived documents are immutable.' };
        if (action === CHECK_IN_ACTION) {
          if (!doc.draftRef) {
            return { ok: false, error: 'Nothing to check in — set the draft ref (path/URL) first.' };
          }
          const appended = appendDocumentVersion(doc.versions, {
            ref: doc.draftRef,
            notes: doc.draftNotes,
            at: actionCtx.now(),
            by: actionCtx.actor() ?? '',
          });
          store.update(record.id, {
            fields: {
              versionsJson: JSON.stringify(appended.versions),
              currentVersion: appended.version,
              draftRef: '',
              draftNotes: '',
            },
            actor: actionCtx.actor(),
            now: actionCtx.now(),
          });
          return { ok: true, message: `Checked in as v${appended.version} — history is append-only.` };
        }
        if (action === ARCHIVE_DOCUMENT_ACTION) {
          store.update(record.id, {
            fields: { archivedAt: actionCtx.now(), status: 'archived' },
            actor: actionCtx.actor(),
            now: actionCtx.now(),
          });
          return { ok: true, message: `Archived at v${doc.currentVersion} — the history freezes with it.` };
        }
        return { ok: false, error: `Unknown action "${action}".` };
      },
    },
  });
}
