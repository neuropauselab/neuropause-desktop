/**
 * Documents — upload, review, correct, link.
 *
 * Lives inside the Data Command Center rather than in a screen of its own: it
 * is the same lifecycle the Import tab already runs — bring something in,
 * understand it, check it, connect it — with the file kept as evidence instead
 * of discarded after parsing.
 *
 * What this screen refuses to do:
 *   - imply a PDF or an image was read. Both are stored, and the reason they
 *     were not read is on the card, verbatim;
 *   - show a value without the text it came from. Every field can be expanded
 *     to its source line;
 *   - hide a disagreement. An invoice whose arithmetic does not add up says so
 *     at the top, in the words the engine used;
 *   - link anything by itself. Candidates are offered with their basis; a
 *     person confirms, and their name goes on it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  DocumentCapabilities,
  DocumentDetail,
  DocumentField,
  DocumentSummary,
} from '@neuropause/shared';
import { DOCUMENT_KIND_LABEL } from '@neuropause/shared';
import { cn } from '@renderer/lib/cn';
import { ipc } from '@renderer/lib/ipc';
import { createLogger } from '@renderer/lib/logger';
import { Button } from '@renderer/components/ui/Button';
import { Card } from '@renderer/components/ui/Card';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { Icon } from '@renderer/components/ui/Icon';
import { Input, Select, Textarea } from '@renderer/components/ui/Input';
import { Loading } from '@renderer/components/ui/Loading';
import { Spinner } from '@renderer/components/Spinner';
import { bytesToBase64, formatBytes, friendlyError } from './dataCommandCenterModel';
import { ErrorBlock, NoticeBlock, Section, StatusPill, type Tone } from './primitives';

const log = createLogger('documents-ui');

const STATUS_TONE: Record<DocumentSummary['status'], Tone> = {
  stored: 'neutral',
  extracted: 'good',
  needs_review: 'warn',
  unsupported: 'bad',
};

const STATUS_LABEL: Record<DocumentSummary['status'], string> = {
  stored: 'Stored',
  extracted: 'Read',
  needs_review: 'Needs review',
  unsupported: 'Not readable',
};

/** The kinds a reviewer may choose. `unknown` is absent — see the contract. */
const CHOOSABLE_KINDS = [
  'invoice',
  'purchase_order',
  'receipt',
  'quote',
  'contract',
  'statement',
  'report',
  'other',
] as const;

export function DocumentsPanel(): JSX.Element {
  const [caps, setCaps] = useState<DocumentCapabilities | null>(null);
  const [list, setList] = useState<DocumentSummary[] | null>(null);
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<{ title: string; detail: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(
    async (needle: string): Promise<void> => {
      try {
        setList(await ipc.data.documents.list(needle.trim() === '' ? {} : { search: needle.trim() }));
        setError(null);
      } catch (err) {
        setError(friendlyError(err));
        setList([]);
      }
    },
    [],
  );

  useEffect(() => {
    void ipc.data.documents
      .capabilities()
      .then(setCaps)
      .catch((err: unknown) => log.warn('Document capabilities unavailable', { message: String(err) }));
  }, []);

  useEffect(() => {
    const id = setTimeout(() => void load(search), 200);
    return () => clearTimeout(id);
  }, [load, search]);

  const openDocument = useCallback(async (documentId: string): Promise<void> => {
    setOpenId(documentId);
    setDetail(null);
    try {
      setDetail(await ipc.data.documents.detail(documentId));
    } catch (err) {
      setError(friendlyError(err));
    }
  }, []);

  const handleFile = useCallback(
    async (file: File): Promise<void> => {
      if (caps && file.size > caps.maxBytes) {
        setError({
          title: 'That file is too large',
          detail: `${formatBytes(file.size)} — documents are accepted up to ${formatBytes(caps.maxBytes)}.`,
        });
        return;
      }
      setBusy(true);
      setError(null);
      setMessage(null);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const result = await ipc.data.documents.upload(file.name, bytesToBase64(bytes), file.type);
        setMessage(
          result.duplicate
            ? `“${file.name}” is byte-for-byte identical to a document already stored, so the existing one was opened.`
            : result.document.status === 'unsupported'
              ? `Stored “${file.name}”, but it could not be read: ${result.document.unsupportedReason ?? ''}`
              : `Stored “${file.name}” and read ${result.document.fieldCount} field${result.document.fieldCount === 1 ? '' : 's'}.`,
        );
        await load(search);
        await openDocument(result.document.id);
      } catch (err) {
        setError(friendlyError(err));
      } finally {
        setBusy(false);
        if (fileRef.current) fileRef.current.value = '';
      }
    },
    [caps, load, openDocument, search],
  );

  return (
    <div>
      <Section
        title="Documents"
        subtitle="Files kept as evidence. What can be read is read; what cannot is stored and said so."
      >
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void handleFile(f);
          }}
          className={cn(
            'flex flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-8 text-center transition',
            dragging ? 'border-accent [background:var(--fill-1)]' : 'border-[var(--hairline-strong)]',
          )}
        >
          <Icon name="doc" size={20} className="text-faint" />
          <h3 className="mt-2 text-sm font-semibold">Drop a document here</h3>
          {caps && (
            <p className="mt-1 max-w-[520px] text-xs text-faint">
              Readable: {caps.readableFormats.join(', ')}. {caps.ocr.reason}
            </p>
          )}
          <Button size="sm" icon="upload" className="mt-3" loading={busy} onClick={() => fileRef.current?.click()}>
            Choose a file
          </Button>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
            }}
          />
        </div>

        {message && (
          <div className="mt-4">
            <NoticeBlock icon="check">{message}</NoticeBlock>
          </div>
        )}
        {error && (
          <div className="mt-4">
            <ErrorBlock title={error.title} detail={error.detail} />
          </div>
        )}

        <div className="mt-4 flex items-center gap-2">
          <Input
            className="h-8 w-64"
            aria-label="Search documents"
            placeholder="Search by name, type or a value in the document"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </Section>

      {list === null ? (
        <Loading kind="table" rows={4} />
      ) : list.length === 0 ? (
        <Card variant="flat">
          <EmptyState
            icon="doc"
            title={search.trim() === '' ? 'No documents yet' : 'Nothing matches that search'}
            description={
              search.trim() === ''
                ? 'Drop an invoice, a contract or a spreadsheet above. The file is kept, so every value read out of it can be traced back to the line it came from.'
                : 'Try the file name, the document type, or a value you know is inside it.'
            }
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {list.map((doc) => (
            <Card key={doc.id} variant="flat" flush className="overflow-hidden">
              <div className="flex flex-wrap items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{doc.filename}</span>
                    <StatusPill tone={STATUS_TONE[doc.status]}>{STATUS_LABEL[doc.status]}</StatusPill>
                    <StatusPill tone="neutral">{DOCUMENT_KIND_LABEL[doc.kind]}</StatusPill>
                    {doc.issueCount > 0 && <StatusPill tone="warn">{doc.issueCount} to check</StatusPill>}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
                    <span className="uppercase tracking-wider text-faint">{doc.format}</span>
                    <span className="tabular-nums">{formatBytes(doc.sizeBytes)}</span>
                    <span>{doc.fieldCount} fields read</span>
                    {doc.linkCount > 0 && <span>{doc.linkCount} linked</span>}
                    {doc.kind !== 'unknown' && (
                      <span className="tabular-nums">{Math.round(doc.kindConfidence * 100)}% confident</span>
                    )}
                  </div>
                  {doc.unsupportedReason && (
                    <p className="mt-1.5 text-sm text-syspink">{doc.unsupportedReason}</p>
                  )}
                </div>
                <Button
                  size="sm"
                  icon={openId === doc.id ? 'chevron-down' : 'chevron-right'}
                  onClick={() => {
                    if (openId === doc.id) {
                      setOpenId(null);
                      setDetail(null);
                    } else void openDocument(doc.id);
                  }}
                >
                  {openId === doc.id ? 'Close' : 'Open'}
                </Button>
              </div>

              {openId === doc.id && (
                <DocumentDetailView
                  detail={detail}
                  onChanged={(next) => {
                    setDetail(next);
                    void load(search);
                  }}
                  onError={setError}
                />
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function DocumentDetailView({
  detail,
  onChanged,
  onError,
}: {
  detail: DocumentDetail | null;
  onChanged: (next: DocumentDetail) => void;
  onError: (e: { title: string; detail: string }) => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [correcting, setCorrecting] = useState<string | null>(null);
  const [reclassifyTo, setReclassifyTo] = useState('');
  const [reclassifyWhy, setReclassifyWhy] = useState('');

  if (detail === null) {
    return (
      <div className="flex items-center gap-3 border-t border-[var(--hairline)] p-4 text-sm text-muted">
        <Spinner size={16} /> Reading the document…
      </div>
    );
  }

  const doc = detail.document;
  const act = async (fn: () => Promise<DocumentDetail>): Promise<void> => {
    setBusy(true);
    try {
      onChanged(await fn());
      setCorrecting(null);
      setReclassifyTo('');
      setReclassifyWhy('');
    } catch (err) {
      onError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5 border-t border-[var(--hairline)] p-4">
      {doc.issues.length > 0 && (
        <div className="space-y-2">
          {doc.issues.map((issue, i) => (
            <p
              key={`${issue.fieldKey}-${i}`}
              className={cn('text-sm', issue.severity === 'error' ? 'text-syspink' : 'text-sysorange')}
            >
              {issue.message}
            </p>
          ))}
        </div>
      )}

      {/* ── what it is ─────────────────────────────────────────────────── */}
      <section>
        <h4 className="text-sm font-semibold">What this is</h4>
        <p className="mt-1 text-sm text-muted">
          {DOCUMENT_KIND_LABEL[doc.kind]}
          {doc.kindMethod === 'reviewer' ? ' — you said so.' : ` — ${Math.round(doc.kindConfidence * 100)}% confident.`}
        </p>
        <ul className="mt-1 space-y-0.5 text-xs text-faint">
          {doc.kindReasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        {doc.status !== 'unsupported' && (
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <div>
              <label htmlFor={`kind-${doc.id}`} className="text-xs text-muted">
                Change it to
              </label>
              <Select
                id={`kind-${doc.id}`}
                className="mt-1 h-8 w-52"
                placeholder="Choose…"
                value={reclassifyTo}
                onChange={(e) => setReclassifyTo(e.target.value)}
                options={CHOOSABLE_KINDS.filter((k) => k !== doc.kind).map((k) => ({
                  value: k,
                  label: DOCUMENT_KIND_LABEL[k],
                }))}
              />
            </div>
            <Input
              className="h-8 w-64"
              aria-label="Why the type is being changed"
              placeholder="Why (optional)"
              value={reclassifyWhy}
              onChange={(e) => setReclassifyWhy(e.target.value)}
            />
            <Button
              size="sm"
              disabled={reclassifyTo === '' || busy}
              loading={busy}
              onClick={() =>
                void act(() => ipc.data.documents.reclassify(doc.id, reclassifyTo, reclassifyWhy || undefined))
              }
            >
              Re-read as this
            </Button>
          </div>
        )}
      </section>

      {/* ── what was read ──────────────────────────────────────────────── */}
      <section>
        <h4 className="text-sm font-semibold">What was read out of it</h4>
        {doc.fields.length === 0 ? (
          <p className="mt-1 text-sm text-muted">
            {doc.status === 'unsupported'
              ? `Nothing — ${doc.unsupportedReason ?? 'this format cannot be read'}.`
              : 'No named values were found. Say what kind of document this is and it will be read again.'}
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-[var(--hairline)]">
            {doc.fields.map((f) => (
              <FieldRow
                key={f.key}
                field={f}
                editing={correcting === f.key}
                busy={busy}
                onEdit={() => setCorrecting((prev) => (prev === f.key ? null : f.key))}
                onCorrect={(value, reason) =>
                  void act(() => ipc.data.documents.correct(doc.id, f.key, value, reason))
                }
              />
            ))}
          </ul>
        )}
      </section>

      {/* ── corrections ────────────────────────────────────────────────── */}
      {doc.corrections.length > 0 && (
        <section>
          <h4 className="text-sm font-semibold">Corrections</h4>
          <ul className="mt-1 space-y-1 text-sm text-muted">
            {doc.corrections.map((c, i) => (
              <li key={`${c.fieldKey}-${i}`}>
                <span className="font-medium text-ink">{c.fieldLabel}</span>:{' '}
                <span className="line-through decoration-faint">{String(c.from ?? '—')}</span> →{' '}
                <span className="font-medium">{String(c.to ?? '—')}</span> · {c.by} · {c.reason}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── related records ────────────────────────────────────────────── */}
      <section>
        <h4 className="text-sm font-semibold">Related records</h4>
        {doc.links.length === 0 ? (
          <p className="mt-1 text-sm text-muted">Not linked to anything yet.</p>
        ) : (
          <ul className="mt-1 space-y-1 text-sm">
            {doc.links.map((l) => (
              <li key={`${l.moduleId}:${l.recordId}`}>
                <span className="font-medium">{l.recordTitle}</span>{' '}
                <span className="text-muted">
                  ({l.moduleTitle}) — {l.relationship}. Confirmed by {l.by}. {l.basis}
                </span>
              </li>
            ))}
          </ul>
        )}

        {detail.candidates.length > 0 && (
          <div className="mt-3 space-y-2">
            <p className="text-xs text-faint">
              Offered, not linked. Confirming writes your name against the connection.
            </p>
            {detail.candidates.map((c) => (
              <div
                key={`${c.moduleId}:${c.recordId}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--hairline)] px-3 py-2"
              >
                <div className="min-w-0 text-sm">
                  <span className="font-medium">{c.recordTitle}</span>{' '}
                  <span className="text-muted">({c.moduleTitle})</span>
                  <span className="block text-xs text-faint">
                    {c.match === 'exact' ? 'Exact match. ' : 'Matches only after normalising. '}
                    {c.basis}
                  </span>
                </div>
                <Button
                  size="sm"
                  loading={busy}
                  onClick={() =>
                    void act(() =>
                      ipc.data.documents.link(doc.id, c.moduleId, c.recordId, c.relationship, c.basis),
                    )
                  }
                >
                  Confirm link
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── proposal ───────────────────────────────────────────────────── */}
      {detail.proposal && (
        <section>
          <h4 className="text-sm font-semibold">What this could become</h4>
          <p className="mt-1 text-sm text-muted">
            A {detail.proposal.moduleTitle.toLowerCase().replace(/s$/, '')} record. {detail.proposal.basis}
          </p>
          <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {detail.proposal.fields.map((f) => (
              <div key={f.key} className="flex justify-between gap-3 border-b border-[var(--hairline)] pb-1">
                <dt className="text-muted">{f.label}</dt>
                <dd className="font-medium">{String(f.value ?? '—')}</dd>
              </div>
            ))}
          </dl>
          {detail.proposal.blockedReasons.length > 0 ? (
            <ul className="mt-2 space-y-0.5 text-sm text-sysorange">
              {detail.proposal.blockedReasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : (
            <NoticeBlock icon="info">
              Nothing is created from a document automatically. Creating this record is a separate,
              approved action in {detail.proposal.moduleTitle} — the person who approves it is the person
              accountable for it.
            </NoticeBlock>
          )}
        </section>
      )}

      <p className="text-xs text-faint">
        Stored {doc.uploadedAt} by {doc.uploadedBy} · SHA-256 {doc.sha256.slice(0, 16)}…
      </p>
    </div>
  );
}

function FieldRow({
  field,
  editing,
  busy,
  onEdit,
  onCorrect,
}: {
  field: DocumentField;
  editing: boolean;
  busy: boolean;
  onEdit: () => void;
  onCorrect: (value: string | number | null, reason: string) => void;
}): JSX.Element {
  const [draft, setDraft] = useState(String(field.value ?? ''));
  const [reason, setReason] = useState('');
  const [showEvidence, setShowEvidence] = useState(false);

  return (
    <li className="py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm text-muted">{field.label}</span>
        <span className="flex items-center gap-2">
          <span className="text-sm font-medium">{String(field.value ?? '—')}</span>
          {field.corrected && <StatusPill tone="neutral">corrected</StatusPill>}
          <span className="text-2xs tabular-nums text-faint">{Math.round(field.confidence * 100)}%</span>
          <button
            type="button"
            className="text-xs text-muted underline-offset-2 hover:underline"
            onClick={() => setShowEvidence((v) => !v)}
          >
            {showEvidence ? 'Hide source' : 'Source'}
          </button>
          <button type="button" className="text-xs text-muted underline-offset-2 hover:underline" onClick={onEdit}>
            {editing ? 'Cancel' : 'Correct'}
          </button>
        </span>
      </div>

      {showEvidence && (
        <div className="mt-1 rounded-lg [background:var(--fill-1)] px-3 py-2 text-xs">
          <div className="text-faint">
            {field.confidenceBasis}
            {field.evidence.line !== null && ` Line ${field.evidence.line}.`}
          </div>
          <div className="mt-1 font-mono text-ink">{field.evidence.snippet}</div>
        </div>
      )}

      {editing && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <Input
            className="h-8 w-40"
            aria-label={`New value for ${field.label}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <Textarea
            className="w-72"
            rows={1}
            aria-label={`Why ${field.label} is being corrected`}
            placeholder="Why (required — kept alongside the original)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <Button
            size="sm"
            variant="primary"
            loading={busy}
            disabled={reason.trim().length < 3}
            onClick={() => {
              // A numeric field stays numeric. Sending "1180" as a string
              // where a number was extracted would make the arithmetic check
              // silently stop working.
              const next =
                typeof field.value === 'number' && draft.trim() !== '' && !Number.isNaN(Number(draft))
                  ? Number(draft)
                  : draft.trim() === ''
                    ? null
                    : draft;
              onCorrect(next, reason.trim());
            }}
          >
            Save correction
          </Button>
        </div>
      )}
    </li>
  );
}
