/**
 * EnterpriseModuleScreen — the generic list + detail + form for ONE ERP module.
 * Fully descriptor-driven: given a module summary (fetched over IPC) it renders
 * the record table (with formatting, status badges, filter chips, pagination),
 * the create/edit form, and the detail view — plus an AI Summary panel when the
 * module exposes one — purely from `module.fields`. Finance, CRM, Sales, … all
 * reuse this exact screen with zero module-specific UI code.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  EnterpriseEntity,
  EnterpriseFieldDef,
  EnterpriseFieldValue,
  EnterpriseModuleSummary,
  EnterpriseRecordInput,
  EnterpriseRecordSummary,
} from '@neuropause/shared';
import { validateEnterpriseRecordInput } from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/cn';
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
  for (const f of fields)
    values[f.key] = f.type === 'boolean' ? Boolean(state[f.key]) : (state[f.key] as string);
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
      const res =
        mode === 'create'
          ? await ipc.enterpriseModules.create(module.id, input)
          : await ipc.enterpriseModules.update(module.id, record!.id, input);
      if (!res.ok) {
        setErrors(res.errors ?? { _: 'Could not save.' });
        return;
      }
      onSaved();
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
              {f.type === 'textarea' ? (
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

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    try {
      await fn();
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  // Custom record actions (e.g. Convert Lead → Customer). The list is refreshed
  // behind the modal, which stays open to show the deterministic result message.
  const runAction = async (key: string): Promise<void> => {
    setBusy(true);
    setActionMsg(null);
    try {
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
          <Button
            variant="danger"
            onClick={() => void act(() => ipc.enterpriseModules.remove(module.id, record.id))}
            disabled={busy}
          >
            Delete
          </Button>
          <Button variant="primary" icon="check" onClick={onEdit} disabled={busy}>
            Edit
          </Button>
        </>
      }
    >
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
