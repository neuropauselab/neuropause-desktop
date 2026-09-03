/**
 * EnterpriseModuleScreen — the generic list + detail + form for ONE ERP module.
 * Fully descriptor-driven: given a module summary (fetched over IPC) it renders
 * the record table (with formatting, status badges, filter chips, pagination),
 * the create/edit form, and the detail view — plus an AI Summary panel when the
 * module exposes one — purely from `module.fields`. Finance, CRM, Sales, … all
 * reuse this exact screen with zero module-specific UI code.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type {
  ActionAssessment,
  EnterpriseEntity,
  EnterpriseFieldDef,
  EnterpriseFieldValue,
  EnterpriseModuleSummary,
  EnterpriseRecordInput,
  EnterpriseRecordSummary,
} from '@neuropause/shared';
import {
  validateEnterpriseRecordInput,
  CREDIT_NOTES_MODULE_ID,
  DEBIT_NOTES_MODULE_ID,
  FINANCE_MODULE_ID,
  GOODS_RECEIPTS_MODULE_ID,
  ORDERS_MODULE_ID,
  PAYMENTS_MODULE_ID,
  PURCHASE_REQUESTS_MODULE_ID,
  QUOTES_MODULE_ID,
  SHIPPING_MODULE_ID,
  VENDOR_BILLS_MODULE_ID,
  VENDOR_PAYMENTS_MODULE_ID,
} from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';

/** The governed record-command union — derived from the ONE ipc helper, never duplicated. */
type GovernedRecordOp = Parameters<typeof ipc.platform.dispatchRecordCommand>[0];
import { dialogVariants, overlayVariants } from '@renderer/lib/motion';
import { cn } from '@renderer/lib/cn';
import { useFocusTrap } from '@renderer/lib/useFocusTrap';
import { Button } from '@renderer/components/ui/Button';
import { Badge } from '@renderer/components/ui/controls';
import { Toggle } from '@renderer/components/ui/controls';
import { Chip, ChipRow } from '@renderer/components/ui/pillTabs';
import { Modal } from '@renderer/components/ui/Modal';
import { Field } from '@renderer/components/ui/Field';
import { Input, Textarea, Select } from '@renderer/components/ui/Input';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { Skeleton } from '@renderer/components/ui/Skeleton';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { DocumentPanel } from './DocumentPanel';
import { RelatedRecordsPanel } from './RelatedRecordsPanel';
import { LinesEditor, linesEditorFor } from './LinesEditor';
import { ReferenceField, referenceFieldFor } from './ReferenceField';

type BadgeTone = 'neutral' | 'accent' | 'blue' | 'green' | 'orange' | 'purple' | 'teal' | 'pink';
const BADGE_TONES = new Set<BadgeTone>([
  'neutral',
  'accent',
  'blue',
  'green',
  'orange',
  'purple',
  'teal',
  'pink',
]);
function toTone(tone: string | undefined): BadgeTone {
  return tone && BADGE_TONES.has(tone as BadgeTone) ? (tone as BadgeTone) : 'neutral';
}

const PAGE_SIZE = 20;

type FormState = Record<string, string | boolean>;

function toFormState(fields: EnterpriseFieldDef[], record?: EnterpriseEntity): FormState {
  const out: FormState = {};
  for (const f of fields) {
    const raw = record ? record.fields[f.key] : f.default;
    if (f.type === 'boolean') out[f.key] = raw === true;
    else out[f.key] = raw === null || raw === undefined ? '' : String(raw);
  }
  return out;
}

function formToInput(fields: EnterpriseFieldDef[], state: FormState): EnterpriseRecordInput {
  const values: Record<string, EnterpriseFieldValue> = {};
  // S45 — readOnly fields are NOT rendered, so their form-state value is a snapshot frozen at
  // form-open. Sending that snapshot back is stale data: a lifecycle action (or payment
  // reconciliation) landing while an edit modal is open would make the save carry — and the
  // machine-owned-status guard rightly refuse — a value the user never touched. Omit them; the
  // update door merges the CURRENT stored value and creates fill declared defaults.
  for (const f of fields) {
    if (f.readOnly) continue;
    values[f.key] = f.type === 'boolean' ? Boolean(state[f.key]) : (state[f.key] as string);
  }
  return { fields: values };
}

function formatValue(field: EnterpriseFieldDef, value: EnterpriseFieldValue): string {
  if (value === null || value === '') return '—';
  if (field.type === 'boolean') return value ? 'Yes' : 'No';
  if (field.format === 'currency' && typeof value === 'number') {
    return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (field.format === 'date') {
    const ms = Date.parse(String(value));
    if (Number.isFinite(ms)) return new Date(ms).toLocaleDateString();
  }
  if (field.type === 'select') {
    return field.options?.find((o) => o.value === value)?.label ?? String(value);
  }
  return String(value);
}

function renderCell(field: EnterpriseFieldDef, value: EnterpriseFieldValue): ReactNode {
  if (field.type === 'select' && field.badge && value !== null && value !== '') {
    const opt = field.options?.find((o) => o.value === value);
    return <Badge tone={toTone(opt?.tone)}>{opt?.label ?? String(value)}</Badge>;
  }
  return formatValue(field, value);
}

export function EnterpriseModuleScreen({
  module,
  initialCreate = false,
  initialQuery = '',
}: {
  module: EnterpriseModuleSummary;
  /** Open the create form on mount (the Business Workspace "New …" quick action drives the REAL create flow). */
  initialCreate?: boolean;
  /** Seed the record search box (the Business Workspace search lands pre-filtered). */
  initialQuery?: string;
}): JSX.Element {
  const [records, setRecords] = useState<EnterpriseEntity[]>([]);
  const [loading, setLoading] = useState(true);
  /**
   * A FAILED/denied record read is named, never shown as "No … yet". The empty
   * state invites the user to create a first record; rendering it over a
   * permission denial or a backend fault tells them their data is gone and asks
   * them to recreate it. Distinct from `records.length === 0`, which is honest
   * emptiness.
   */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState(initialQuery);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(0);
  const [form, setForm] = useState<{ mode: 'create' | 'edit'; record?: EnterpriseEntity } | null>(
    null,
  );
  const [detail, setDetail] = useState<EnterpriseEntity | null>(null);

  const columns = useMemo(() => module.fields.filter((f) => f.column !== false), [module.fields]);
  const filterFields = useMemo(
    () => module.fields.filter((f) => f.type === 'select' && f.filterable),
    [module.fields],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setRecords(
        await ipc.enterpriseModules.records(module.id, { search: query || undefined, limit: 1000 }),
      );
      setLoadError(null);
    } catch (err) {
      // A denied or failed read is surfaced, not swallowed into emptiness.
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [module.id, query]);

  useEffect(() => {
    void refresh();
    const off = ipc.enterpriseModules.onEvent((e) => {
      if (e.moduleId === module.id) void refresh();
    });
    return off;
  }, [refresh, module.id]);

  // One-shot: open the create form when mounted with create intent (Business Workspace "New …").
  useEffect(() => {
    if (initialCreate) setForm({ mode: 'create' });
    // Intentionally mount-only: the parent remounts (via key) for each new create intent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Client-side field filters (over the fetched, searched set).
  const filtered = useMemo(() => {
    const active = Object.entries(filters).filter(([, v]) => v);
    if (active.length === 0) return records;
    return records.filter((r) => active.every(([k, v]) => String(r.fields[k] ?? '') === v));
  }, [records, filters]);

  useEffect(() => setPage(0), [filters, query]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageStart = page * PAGE_SIZE;
  const pageRows = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  const setFilter = (key: string, value: string): void =>
    setFilters((f) => ({ ...f, [key]: f[key] === value ? '' : value }));

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="relative w-64 max-w-full">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint">
            <Icon name="search" size={15} />
          </span>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${module.plural.toLowerCase()}…`}
            className="pl-8"
          />
        </div>
        <Button variant="primary" icon="plus" onClick={() => setForm({ mode: 'create' })}>
          New {module.singular}
        </Button>
      </div>

      {filterFields.map((f) => (
        <div key={f.key} className="mb-3">
          <ChipRow>
            <Chip label="All" active={!filters[f.key]} onClick={() => setFilter(f.key, '')} />
            {f.options?.map((o) => (
              <Chip
                key={o.value}
                label={o.label}
                active={filters[f.key] === o.value}
                onClick={() => setFilter(f.key, o.value)}
              />
            ))}
          </ChipRow>
        </div>
      ))}

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : loadError !== null ? (
        <div role="alert" className="rounded-2xl border border-danger/40 bg-danger/10 p-4 text-sm text-danger">
          <div className="font-semibold">{module.plural} could not be loaded.</div>
          <p className="mt-1 text-xs leading-relaxed">
            {loadError} — you may lack read permission for this module. Nothing was created; retry when the
            problem is resolved.
          </p>
          <button
            type="button"
            onClick={() => void refresh()}
            className="mt-3 rounded-lg border border-danger/40 px-3 py-1.5 text-xs font-semibold hover:bg-danger/10"
          >
            Retry
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={(module.icon || 'grid') as IconName}
          title={records.length === 0 ? `No ${module.plural.toLowerCase()} yet` : 'No matches'}
          description={
            records.length === 0
              ? `Create your first ${module.singular.toLowerCase()} to get started.`
              : 'Try clearing a filter or search.'
          }
          action={
            records.length === 0 ? (
              <Button variant="primary" icon="plus" onClick={() => setForm({ mode: 'create' })}>
                New {module.singular}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="overflow-hidden rounded-2xl border border-[var(--hairline)] [background:var(--fill-1)]">
            <table className="w-full text-left text-md">
              <thead>
                <tr className="border-b border-[var(--hairline)] text-xs uppercase tracking-wider text-faint">
                  {columns.map((c) => (
                    <th key={c.key} className="px-4 py-2.5 font-semibold">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => setDetail(r)}
                    className="cursor-pointer border-b border-[var(--hairline)] transition last:border-0 fill-hover"
                  >
                    {columns.map((c, i) => (
                      <td
                        key={c.key}
                        className={cn('px-4 py-3', i === 0 ? 'font-medium text-ink' : 'text-muted')}
                      >
                        {renderCell(c, r.fields[c.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center justify-between text-sm text-faint">
            <span>
              Showing {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, filtered.length)} of{' '}
              {filtered.length}
            </span>
            {pageCount > 1 && (
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  icon="chevron-left"
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  Prev
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={page >= pageCount - 1}
                  onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                >
                  Next
                </Button>
              </div>
            )}
          </div>
        </>
      )}

      {form && (
        <ModuleForm
          module={module}
          mode={form.mode}
          record={form.record}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            void refresh();
          }}
        />
      )}

      {detail && (
        <RecordDetail
          module={module}
          record={detail}
          onClose={() => setDetail(null)}
          onEdit={() => {
            setForm({ mode: 'edit', record: detail });
            setDetail(null);
          }}
          onChanged={() => {
            setDetail(null);
            void refresh();
          }}
          onRefresh={() => void refresh()}
        />
      )}
    </div>
  );
}

function ModuleForm({
  module,
  mode,
  record,
  onClose,
  onSaved,
}: {
  module: EnterpriseModuleSummary;
  mode: 'create' | 'edit';
  record?: EnterpriseEntity;
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const [state, setState] = useState<FormState>(() => toFormState(module.fields, record));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // S43 — a STABLE idempotency key for a governed create, minted ONCE per form instance. A retry of
  // the SAME create (a transport failure the user resubmits, a double-submit) reuses this key and
  // REPLAYS to exactly one durable record; a fresh create (a new form mount) mints a new key.
  // S45 — shared by the governed Sales Order AND customer receipt creates (a form instance only
  // ever creates one record, so one key per mount stays one key per submission).
  const governedKey = useRef<string>(`gov-create-${crypto.randomUUID()}`);

  const set = (key: string, value: string | boolean): void =>
    setState((s) => ({ ...s, [key]: value }));

  const submit = async (): Promise<void> => {
    const input = formToInput(module.fields, state);
    const check = validateEnterpriseRecordInput(module, input);
    if (!check.ok) {
      setErrors(check.errors);
      return;
    }
    setSaving(true);
    try {
      // S43 — a Sales Order CREATE is routed through the GOVERNED command spine, not the
      // non-governed module CRUD door. This is the ONE ERP write the production UI drives through
      // `platform:command.dispatch` → Application Boundary → command bus → `sales:manage` RBAC →
      // durable intent/journal → Sales Order persistence → domain event → outbox → governance audit.
      // Every OTHER module (and every Sales Order EDIT) keeps the existing CRUD path unchanged, so
      // this governed create can NEVER double-write through `enterprise:module.create`.
      if (mode === 'create' && module.id === ORDERS_MODULE_ID) {
        const gov = await ipc.platform.createSalesOrder(input.fields ?? {}, governedKey.current);
        if (!gov.ok) {
          setErrors({ _: gov.error?.message ?? 'Could not create the sales order.' });
          return;
        }
        onSaved();
        return;
      }
      // S45 — a CLEARED customer receipt books real Dr Cash / Cr AR, so it is created through the
      // governed `ReceiveCustomerPayment` command (status force-set 'cleared' server-side, same
      // journal/idempotency/event/outbox/audit spine as the S43 create). Pending/void records keep
      // the CRUD path — they carry no GL effect at creation (recorded policy, not narrowed here).
      if (
        mode === 'create' &&
        module.id === PAYMENTS_MODULE_ID &&
        String((input.fields ?? {}).status ?? 'cleared') === 'cleared'
      ) {
        const gov = await ipc.platform.receiveCustomerPayment(input.fields ?? {}, governedKey.current);
        if (!gov.ok) {
          setErrors({ _: gov.error?.message ?? 'Could not record the receipt.' });
          return;
        }
        onSaved();
        return;
      }
      // S49 — the buy-side governed creates, exactly the S43/S45 pattern:
      // a Purchase Request is born `draft` through the governed command; a CLEARED vendor
      // payment (Dr AP / Cr Cash) goes through PaySupplierInvoice. Pending/void vendor
      // payments keep the CRUD path — no GL at creation.
      if (mode === 'create' && module.id === PURCHASE_REQUESTS_MODULE_ID) {
        const gov = await ipc.platform.createPurchaseRequest(input.fields ?? {}, governedKey.current);
        if (!gov.ok) {
          setErrors({ _: gov.error?.message ?? 'Could not create the purchase request.' });
          return;
        }
        onSaved();
        return;
      }
      if (
        mode === 'create' &&
        module.id === VENDOR_PAYMENTS_MODULE_ID &&
        String((input.fields ?? {}).status ?? 'cleared') === 'cleared'
      ) {
        const gov = await ipc.platform.paySupplierInvoice(input.fields ?? {}, governedKey.current);
        if (!gov.ok) {
          setErrors({ _: gov.error?.message ?? 'Could not record the payment.' });
          return;
        }
        onSaved();
        return;
      }
      const res =
        mode === 'create'
          ? await ipc.enterpriseModules.create(module.id, input)
          : await ipc.enterpriseModules.update(module.id, record!.id, input);
      if (!res.ok) {
        // S45 — an error keyed to a field this form does not RENDER (e.g. the machine-owned
        // `status` refusal from a non-form caller's write racing this edit) would otherwise be
        // invisible: the modal stayed open with no message. Fold unrendered-key errors into the
        // form-level slot so every refusal is seen.
        const raw = res.errors ?? { _: 'Could not save.' };
        const rendered = new Set(module.fields.filter((f) => !f.readOnly).map((f) => f.key));
        const errs: Record<string, string> = {};
        const hidden: string[] = [];
        for (const [k, v] of Object.entries(raw)) {
          if (k === '_' || rendered.has(k)) errs[k] = v;
          else hidden.push(v);
        }
        if (hidden.length) errs._ = [errs._, ...hidden].filter(Boolean).join(' ');
        setErrors(errs);
        return;
      }
      onSaved();
    } catch (err) {
      // A thrown save — a permission denial that rejects, or an IPC/transport
      // failure — used to escape uncaught: the modal stayed open with no reason
      // shown. Surface it in the form's own error slot.
      setErrors({ _: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === 'create' ? `New ${module.singular}` : `Edit ${module.singular}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} onClick={() => void submit()}>
            {mode === 'create' ? 'Create' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {errors._ && <p className="text-sm text-syspink">{errors._}</p>}
        {/* S47 pilot fence (visibility, not policy): editing an ISSUED-family invoice's economic
            fields books real GL ADJUSTMENT entries — deliberate glPosting drift-correction
            behavior whose governance is the OPEN reversal-policy memo. The fence makes the
            defined behavior VISIBLE before the user saves; it blocks nothing. */}
        {mode === 'edit' &&
          module.id === FINANCE_MODULE_ID &&
          ['issued', 'partially_paid', 'paid'].includes(String(record?.fields.status ?? '')) && (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
              This invoice is issued. Changing its amounts books general-ledger adjustment
              entries.
            </p>
          )}
        {module.fields
          .filter((f) => !f.readOnly)
          .map((f) => (
            <Field
              key={f.key}
              label={f.label}
              htmlFor={`f-${f.key}`}
              required={f.required}
              help={f.help}
              error={errors[f.key]}
            >
              {/* S50 — census-registered procurement fields get structured editors in place
                  of raw JSON / free-text ids. Both serialize into the SAME form-state key,
                  so the submitted payload shape is unchanged (renderer-only retirement). */}
              {linesEditorFor(module.id, f.key) ? (
                <LinesEditor
                  id={`f-${f.key}`}
                  config={linesEditorFor(module.id, f.key)!}
                  value={String(state[f.key] ?? '')}
                  onChange={(v) => set(f.key, v)}
                />
              ) : referenceFieldFor(module.id, f.key) ? (
                <ReferenceField
                  id={`f-${f.key}`}
                  config={referenceFieldFor(module.id, f.key)!}
                  value={String(state[f.key] ?? '')}
                  placeholder={f.placeholder}
                  onChange={(v) => set(f.key, v)}
                />
              ) : f.type === 'textarea' ? (
                <Textarea
                  id={`f-${f.key}`}
                  value={String(state[f.key] ?? '')}
                  placeholder={f.placeholder}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              ) : f.type === 'select' ? (
                <Select
                  id={`f-${f.key}`}
                  value={String(state[f.key] ?? '')}
                  placeholder="Select…"
                  options={f.options ?? []}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              ) : f.type === 'boolean' ? (
                <Toggle
                  checked={Boolean(state[f.key])}
                  onChange={(v) => set(f.key, v)}
                  label={f.label}
                />
              ) : (
                <Input
                  id={`f-${f.key}`}
                  type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                  value={String(state[f.key] ?? '')}
                  placeholder={f.placeholder}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              )}
            </Field>
          ))}
      </div>
    </Modal>
  );
}

/**
 * D-7b — the message for a mutation the boundary REFUSED BY RESOLVING.
 *
 * `EnterpriseModuleMutationResult.errors` is `field key -> message`, with `_`
 * documented as the record-level key. This reads that structure; it never
 * inspects English prose, so it cannot drift into classifying refusals by
 * regex -- the defect D-6 exists to prevent.
 */
function describeMutationFailure(
  result: { errors?: Record<string, string> },
  fallback: string,
): string {
  const errors = result.errors;
  if (!errors) return fallback;
  return errors._ ?? Object.values(errors)[0] ?? fallback;
}

const RISK_TONE: Record<string, BadgeTone> = { low: 'green', medium: 'orange', high: 'pink' };

function AiSummarySection({
  module,
  recordId,
}: {
  module: EnterpriseModuleSummary;
  recordId: string;
}): JSX.Element {
  const [summary, setSummary] = useState<EnterpriseRecordSummary | null>(null);
  const [loading, setLoading] = useState(false);

  const generate = async (): Promise<void> => {
    setLoading(true);
    try {
      setSummary(await ipc.enterpriseModules.summarize(module.id, recordId));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mb-4 rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] p-3.5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <Icon name="sparkles" size={14} />
          AI Summary
        </span>
        {summary && <Badge tone={RISK_TONE[summary.risk] ?? 'neutral'}>{summary.risk} risk</Badge>}
      </div>
      {summary ? (
        <div className="mt-2.5 space-y-2">
          <p className="text-md text-ink">{summary.summary}</p>
          {summary.executiveExplanation && (
            <p className="text-sm text-muted">{summary.executiveExplanation}</p>
          )}
          <p className="text-xs text-faint">
            {summary.riskReason} ·{' '}
            {summary.grounded ? `Model: ${summary.model}` : 'Deterministic (no model configured)'}
          </p>
        </div>
      ) : (
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="text-sm text-muted">
            Generate an AI risk assessment and executive explanation for this{' '}
            {module.singular.toLowerCase()}.
          </p>
          <Button
            variant="secondary"
            size="sm"
            icon="sparkles"
            loading={loading}
            onClick={() => void generate()}
          >
            Generate
          </Button>
        </div>
      )}
    </div>
  );
}

function RecordDetail({
  module,
  record,
  onClose,
  onEdit,
  onChanged,
  onRefresh,
}: {
  module: EnterpriseModuleSummary;
  record: EnterpriseEntity;
  onClose: () => void;
  onEdit: () => void;
  onChanged: () => void;
  onRefresh?: () => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  /**
   * D-7b — the DELETE/ARCHIVE failure channel, deliberately separate from
   * `actionMsg`: `runAction` clears that slot on every custom action, so a hold
   * notice parked there would be erased by an unrelated click.
   */
  const [actionError, setActionError] = useState<string | null>(null);

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    try {
      await fn();
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  // Governed delete: the main process assesses the record's REAL relationship
  // links BEFORE anything mutates. A refused delete returns the assessment,
  // which renders here — evidence, recommendation and the safe alternative —
  // and only an explicit "Delete anyway" resends with force.
  const [deleteAssessment, setDeleteAssessment] = useState<ActionAssessment | null>(null);
  /**
   * Round 36 — Gate 12: the DESTRUCTIVE dialog is the one place a leaked Tab
   * or a missing Escape is most dangerous. Focus is trapped while it is open,
   * returns to the opener on close, and Escape cancels (never confirms).
   */
  const deleteDialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(deleteDialogRef, deleteAssessment !== null);
  useEffect(() => {
    if (deleteAssessment === null) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setDeleteAssessment(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deleteAssessment]);
  // The refusal raises a durable HOLD in the main process. Holding onto its id
  // is what lets the safer route actually close the hold — otherwise archiving
  // would leave an open hold describing a problem the user already solved.
  const [holdId, setHoldId] = useState<string | null>(null);
  const requestDelete = async (force: boolean): Promise<void> => {
    setBusy(true);
    setActionError(null);
    try {
      const result = await ipc.enterpriseModules.remove(module.id, record.id, force);
      if (!result.ok && result.assessment) {
        setDeleteAssessment(result.assessment);
        setHoldId(result.holdId ?? null);
        return;
      }
      // A refusal WITHOUT an assessment used to fall straight through to
      // `onChanged()` — the modal closed and the row looked deleted when the
      // delete had been refused. The channel refuses by RESOLVING `{ok:false}`,
      // so no catch ever saw it.
      if (!result.ok) {
        setActionError(describeMutationFailure(result, 'The record could not be deleted.'));
        return;
      }
      setDeleteAssessment(null);
      setHoldId(null);
      onChanged();
    } catch (err) {
      // The permission gate for this channel is enforced in the handler and
      // THROWS. Rendered verbatim: re-wording a refusal here would mean
      // classifying it by regex on English prose.
      setActionError(err instanceof Error && err.message ? err.message : 'The request failed.');
    } finally {
      setBusy(false);
    }
  };

  /** Archive instead — then close the hold that recommended exactly this. */
  const takeAlternative = async (): Promise<void> => {
    setBusy(true);
    setActionError(null);
    try {
      const archived = await ipc.enterpriseModules.setStatus(module.id, record.id, 'archived');
      // THE ARCHIVE IS NOT ASSUMED. This channel refuses by RESOLVING
      // `{ok:false}`, and the result used to be discarded — so a refused archive
      // still closed the hold with the note "Archived instead of deleting",
      // which would have been a false statement written into governance
      // evidence. Nothing is claimed about the hold until the archive is real.
      if (!archived.ok) {
        setActionError(describeMutationFailure(archived, 'The record could not be archived.'));
        return;
      }
      if (holdId) {
        const closed = await ipc.holds
          .resolve(
            holdId,
            'took_alternative',
            'Archived instead of deleting; every link keeps resolving.',
          )
          // A hold that cannot be closed must still never fail the archive that
          // already happened — that part of the original reasoning stands. What
          // changed is that the outcome is no longer discarded: `hold:resolve`
          // answers `HoldRecord | null`, and an unknown, already-resolved or
          // out-of-scope hold RESOLVES with null, so the catch never ran for the
          // most likely failure. Both shapes collapse to "not closed" here.
          .catch(() => null);
        if (!closed) {
          // The archive DID happen; only the hold is still open. `onRefresh`
          // updates the list WITHOUT unmounting this component, so the message
          // survives to be read — `onChanged()` would call `setDetail(null)` and
          // render it zero frames.
          setActionError(
            'Archived. The related hold could not be closed and is still open — closing it needs governance permission.',
          );
          onRefresh?.();
          return;
        }
      }
      setDeleteAssessment(null);
      setHoldId(null);
      onChanged();
    } catch (err) {
      setActionError(err instanceof Error && err.message ? err.message : 'The request failed.');
    } finally {
      setBusy(false);
    }
  };

  // Custom record actions (e.g. Convert Lead → Customer). The list is refreshed
  // behind the modal, which stays open to show the deterministic result message.
  //
  // S45 — the CONSEQUENTIAL O2C lifecycle actions are routed through the GOVERNED command spine
  // (`platform:command.dispatch` → Application Boundary → per-command RBAC → durable journal →
  // domain event → outbox → governance audit) instead of the legacy `enterprise:module.action`
  // door. The command routes wrap the SAME module actions, so behavior is identical — what changes
  // is that the write is journaled, idempotent, and crash-recoverable. Every OTHER module action
  // (reserve stock, pick list, convert lead, fulfill/close/cancel, …) keeps the existing path.
  const runAction = async (key: string): Promise<void> => {
    // S45 (O2C) + S49 (procurement): the (module, action) → governed-command routing table.
    // Every entry wraps the SAME module action the legacy door ran — behavior identical, but the
    // write is journaled, idempotent, event-emitting, and crash-recoverable. Actions absent from
    // this table keep the existing legacy path unchanged.
    const GOVERNED: Record<string, Record<string, GovernedRecordOp>> = {
      [ORDERS_MODULE_ID]: { ship: 'ShipSalesOrder', convertToInvoice: 'InvoiceSalesOrder' },
      [FINANCE_MODULE_ID]: { issue: 'IssueCustomerInvoice', cancel: 'CancelCustomerInvoice' },
      [QUOTES_MODULE_ID]: { convertToOrder: 'ConvertQuoteToSalesOrder' },
      // ERP Session 57 — the reversal/settlement promotion set (existing semantics, new spine).
      [CREDIT_NOTES_MODULE_ID]: { issue: 'IssueCreditNote', cancel: 'CancelCreditNote' },
      [DEBIT_NOTES_MODULE_ID]: { issue: 'IssueDebitNote', cancel: 'CancelDebitNote' },
      [PAYMENTS_MODULE_ID]: { clear: 'ClearCustomerPayment' },
      [VENDOR_PAYMENTS_MODULE_ID]: { clear: 'ClearVendorPayment' },
      [SHIPPING_MODULE_ID]: { ship: 'ShipShipmentDocument' },
      [PURCHASE_REQUESTS_MODULE_ID]: {
        submit: 'SubmitPurchaseRequest',
        approve: 'ApprovePurchaseRequest',
        reject: 'RejectPurchaseRequest',
        createPurchaseOrder: 'ConvertPurchaseRequestToPO',
      },
      [GOODS_RECEIPTS_MODULE_ID]: { post: 'PostGoodsReceipt' },
      [VENDOR_BILLS_MODULE_ID]: { approve: 'ApproveSupplierInvoice' },
    };
    const governedOp = GOVERNED[module.id]?.[key] ?? null;
    setBusy(true);
    setActionMsg(null);
    try {
      if (governedOp) {
        // One key per user gesture: a double-click is blocked by `busy`, a crash mid-flight is
        // recovered by the journal's intent HOLD, and a deliberate LATER retry is a NEW gesture
        // (new key) answered truthfully by the module status machine ("already shipped"), never
        // masked by a stale replayed success.
        const gov = await ipc.platform.dispatchRecordCommand(
          governedOp,
          record.id,
          `${governedOp}-${record.id}-${crypto.randomUUID()}`,
        );
        const done: Record<string, string> = {
          ShipSalesOrder: 'Order shipped.',
          InvoiceSalesOrder: 'Invoice generated.',
          IssueCustomerInvoice: 'Invoice issued.',
          ConvertQuoteToSalesOrder: 'Quote converted to a sales order.',
          SubmitPurchaseRequest: 'Request submitted.',
          ApprovePurchaseRequest: 'Request approved.',
          RejectPurchaseRequest: 'Request rejected.',
          ConvertPurchaseRequestToPO: 'Purchase order created.',
          PostGoodsReceipt: 'Receipt posted — stock received.',
          ApproveSupplierInvoice: 'Supplier invoice approved.',
          CancelCustomerInvoice: 'Invoice cancelled — the ledger reversal is booked.',
          IssueCreditNote: 'Credit note issued.',
          CancelCreditNote: 'Credit note cancelled.',
          IssueDebitNote: 'Debit note issued.',
          CancelDebitNote: 'Debit note cancelled.',
          ClearCustomerPayment: 'Payment cleared — cash booked and the invoice reconciled.',
          ClearVendorPayment: 'Payment cleared — the bill reconciled and cash booked.',
          ShipShipmentDocument: 'Shipment shipped — stock issued.',
        };
        setActionMsg(
          gov.ok
            ? { tone: 'ok', text: done[governedOp] ?? 'Done.' }
            : { tone: 'error', text: gov.error?.message ?? 'Action failed.' },
        );
        onRefresh?.();
        return;
      }
      const res = await ipc.enterpriseModules.action(module.id, record.id, key);
      setActionMsg(
        res.ok
          ? { tone: 'ok', text: res.message ?? 'Done.' }
          : { tone: 'error', text: res.error ?? res.message ?? 'Action failed.' },
      );
      onRefresh?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={record.title}
      subtitle={`${module.singular} · ${record.status}`}
      footer={
        <>
          {record.status === 'active' &&
            module.actions.map((a) => (
              <Button
                key={a.key}
                variant="secondary"
                icon={a.icon as IconName | undefined}
                onClick={() => void runAction(a.key)}
                disabled={busy}
              >
                {a.label}
              </Button>
            ))}
          {record.status === 'active' ? (
            <Button
              variant="ghost"
              onClick={() =>
                void act(() => ipc.enterpriseModules.setStatus(module.id, record.id, 'archived'))
              }
              disabled={busy}
            >
              Archive
            </Button>
          ) : (
            <Button
              variant="ghost"
              onClick={() =>
                void act(() => ipc.enterpriseModules.setStatus(module.id, record.id, 'active'))
              }
              disabled={busy}
            >
              Restore
            </Button>
          )}
          <Button variant="danger" onClick={() => void requestDelete(false)} disabled={busy}>
            Delete
          </Button>
          <AnimatePresence>
            {deleteAssessment && (
              // The scrim fades and the dialog scales in together. A dialog
              // that simply exists on the next frame reads as a page change;
              // scaling up from behind the scrim reads as "in front of what
              // you were doing", which is what a blocking assessment IS.
              <motion.div
                ref={deleteDialogRef}
                role="alertdialog"
                aria-modal="true"
                aria-label="High-risk delete"
                variants={overlayVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-6"
              >
                {/* `glass-panel` is the app's opaque floating-UI material. A
                    translucent surface token would let the record list show
                    through the evidence a person is being asked to act on. */}
                <motion.div
                  variants={dialogVariants}
                  className="glass-panel w-full max-w-[560px] rounded-2xl p-5 shadow-xl"
                >
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full border border-sysorange/40 px-2 py-0.5 text-[11px] font-medium text-sysorange">
                      On hold
                    </span>
                    <h3 className="text-base font-semibold text-syspink">
                      {deleteAssessment.risk === 'high_risk'
                        ? 'High risk'
                        : 'Review before proceeding'}
                    </h3>
                  </div>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted">
                    {deleteAssessment.recommendation}
                  </p>
                  <div className="mt-3">
                    <div className="text-xs uppercase tracking-wider text-faint">What I know</div>
                    <ul className="mt-1 space-y-1.5">
                      {deleteAssessment.evidence.map((e, i) => (
                        <li key={i} className="text-sm text-muted">
                          <span className="font-medium text-ink">{e.label}:</span> {e.detail}
                        </li>
                      ))}
                    </ul>
                  </div>
                  {deleteAssessment.alternative && (
                    <div className="mt-3 rounded-xl border border-[var(--hairline)] px-3.5 py-2.5">
                      <div className="text-xs uppercase tracking-wider text-faint">
                        What would resolve this
                      </div>
                      <p className="mt-1 text-sm text-muted">{deleteAssessment.alternative}</p>
                    </div>
                  )}
                  <div className="mt-2 rounded-xl border border-syspink/30 px-3.5 py-2.5">
                    <div className="text-xs uppercase tracking-wider text-syspink">
                      If you proceed anyway
                    </div>
                    <p className="mt-1 text-sm text-muted">
                      The dependent records keep their reference but it stops resolving. Nothing is
                      destroyed — the record is soft-deleted and recoverable — but traces that walk
                      this link will show a gap until it is restored.
                    </p>
                  </div>
                  {actionError !== null && (
                    <div
                      role="alert"
                      className="mt-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
                    >
                      {actionError}
                    </div>
                  )}
                  <div className="mt-4 flex flex-wrap justify-end gap-2">
                    <Button size="sm" onClick={() => setDeleteAssessment(null)} disabled={busy}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void takeAlternative()}
                      disabled={busy}
                    >
                      Archive instead
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => void requestDelete(true)}
                      disabled={busy}
                    >
                      Delete anyway
                    </Button>
                  </div>
                  <p className="mt-2.5 text-right text-xs text-faint">
                    This hold stays open in Holds until it is resolved.
                  </p>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
          <Button variant="primary" icon="check" onClick={onEdit} disabled={busy}>
            Edit
          </Button>
        </>
      }
    >
      {deleteAssessment === null && actionError !== null && (
        <div
          role="alert"
          className="mb-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {actionError}
        </div>
      )}
      {actionMsg && (
        <div
          className={`mb-3 rounded-md px-3 py-2 text-sm ${
            actionMsg.tone === 'ok'
              ? 'bg-emerald-500/10 text-emerald-300'
              : 'bg-rose-500/10 text-rose-300'
          }`}
        >
          {actionMsg.text}
        </div>
      )}
      {/* Line items + approval. Renders nothing for a module with no document
          spec, so the 90-odd master-data modules are unaffected. */}
      <DocumentPanel moduleId={module.id} recordId={record.id} onChanged={onChanged} />
      {/*
        Cross-domain connections for this record (Program 6). Loaded with the
        detail, not the list, so opening a module does not traverse every row.
      */}
      <RelatedRecordsPanel
        recordId={record.id}
        moduleId={module.id}
        revision={`${record.id}|${record.rev}`}
      />
      {module.aiSummary && <AiSummarySection module={module} recordId={record.id} />}
      <dl className="space-y-3">
        {module.fields.map((f) => (
          <div key={f.key} className="flex items-start justify-between gap-6">
            <dt className="text-sm text-muted">{f.label}</dt>
            <dd className="text-right text-md text-ink">{renderCell(f, record.fields[f.key])}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
