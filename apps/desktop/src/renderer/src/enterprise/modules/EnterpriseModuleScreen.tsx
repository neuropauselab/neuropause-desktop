/**
 * EnterpriseModuleScreen — the generic list + detail + form for ONE ERP module.
 * It is fully descriptor-driven: given a module summary (fetched over IPC) it
 * renders the record table, the create/edit form, and the detail view purely
 * from `module.fields` — so Finance, CRM, Sales, … all reuse this exact screen
 * with zero module-specific UI code.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  EnterpriseEntity,
  EnterpriseFieldDef,
  EnterpriseFieldValue,
  EnterpriseModuleSummary,
  EnterpriseRecordInput,
} from '@neuropause/shared';
import { validateEnterpriseRecordInput } from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/cn';
import { Button } from '@renderer/components/ui/Button';
import { Badge } from '@renderer/components/ui/controls';
import { Toggle } from '@renderer/components/ui/controls';
import { Modal } from '@renderer/components/ui/Modal';
import { Field } from '@renderer/components/ui/Field';
import { Input, Textarea, Select } from '@renderer/components/ui/Input';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { Skeleton } from '@renderer/components/ui/Skeleton';
import { Icon, type IconName } from '@renderer/components/ui/Icon';

type FormState = Record<string, string | boolean>;

function toFormState(fields: EnterpriseFieldDef[], record?: EnterpriseEntity): FormState {
  const out: FormState = {};
  for (const f of fields) {
    const v = record?.fields[f.key];
    if (f.type === 'boolean') out[f.key] = v === true;
    else out[f.key] = v === null || v === undefined ? '' : String(v);
  }
  return out;
}

function formToInput(fields: EnterpriseFieldDef[], state: FormState): EnterpriseRecordInput {
  const values: Record<string, EnterpriseFieldValue> = {};
  for (const f of fields)
    values[f.key] = f.type === 'boolean' ? Boolean(state[f.key]) : (state[f.key] as string);
  return { fields: values };
}

function displayValue(field: EnterpriseFieldDef, value: EnterpriseFieldValue): string {
  if (value === null || value === '') return '—';
  if (field.type === 'boolean') return value ? 'Yes' : 'No';
  if (field.type === 'select')
    return field.options?.find((o) => o.value === value)?.label ?? String(value);
  return String(value);
}

export function EnterpriseModuleScreen({
  module,
}: {
  module: EnterpriseModuleSummary;
}): JSX.Element {
  const [records, setRecords] = useState<EnterpriseEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [form, setForm] = useState<{ mode: 'create' | 'edit'; record?: EnterpriseEntity } | null>(
    null,
  );
  const [detail, setDetail] = useState<EnterpriseEntity | null>(null);

  const columns = useMemo(() => module.fields.filter((f) => f.column !== false), [module.fields]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setRecords(await ipc.enterpriseModules.records(module.id, { search: query || undefined }));
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

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : records.length === 0 ? (
        <EmptyState
          icon={(module.icon || 'grid') as IconName}
          title={`No ${module.plural.toLowerCase()} yet`}
          description={`Create your first ${module.singular.toLowerCase()} to get started.`}
          action={
            <Button variant="primary" icon="plus" onClick={() => setForm({ mode: 'create' })}>
              New {module.singular}
            </Button>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[var(--hairline)] [background:var(--fill-1)]">
          <table className="w-full text-left text-md">
            <thead>
              <tr className="border-b border-[var(--hairline)] text-xs uppercase tracking-wider text-faint">
                {columns.map((c) => (
                  <th key={c.key} className="px-4 py-2.5 font-semibold">
                    {c.label}
                  </th>
                ))}
                <th className="px-4 py-2.5 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => setDetail(r)}
                  className="cursor-pointer border-b border-[var(--hairline)] last:border-0 transition fill-hover"
                >
                  {columns.map((c, i) => (
                    <td
                      key={c.key}
                      className={cn('px-4 py-3', i === 0 ? 'font-medium text-ink' : 'text-muted')}
                    >
                      {displayValue(c, r.fields[c.key])}
                    </td>
                  ))}
                  <td className="px-4 py-3">
                    <Badge tone={r.status === 'active' ? 'green' : 'orange'}>{r.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
        {module.fields.map((f) => (
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

function RecordDetail({
  module,
  record,
  onClose,
  onEdit,
  onChanged,
}: {
  module: EnterpriseModuleSummary;
  record: EnterpriseEntity;
  onClose: () => void;
  onEdit: () => void;
  onChanged: () => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    try {
      await fn();
      onChanged();
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
      <dl className="space-y-3">
        {module.fields.map((f) => (
          <div key={f.key} className="flex items-start justify-between gap-6">
            <dt className="text-sm text-muted">{f.label}</dt>
            <dd className="text-md text-ink text-right">{displayValue(f, record.fields[f.key])}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
