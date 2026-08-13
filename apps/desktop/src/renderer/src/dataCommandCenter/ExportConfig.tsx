/**
 * Configure an export before it happens.
 *
 * The screen this replaces offered a format and a checkbox, and answered none
 * of the questions a person should have to answer before business data leaves
 * the building: how much, which columns, and what is being held back.
 *
 * Every number here comes from `dp:export.plan`, which is computed by the same
 * functions that perform the export. Nothing on this screen is counted in the
 * renderer — a UI that counts rows itself eventually disagrees with the
 * exporter, and the disagreement is silent.
 *
 * The refusals are stated, not hidden:
 *   - a secret field is listed as permanently excluded, never merely absent;
 *   - a restricted field is visible but off, and unavailable entirely to
 *     someone who cannot administer the module;
 *   - PDF is named as unsupported with the reason, rather than quietly missing
 *     from the format row.
 */
import { useCallback, useEffect, useState } from 'react';
import type { DataPlaneExportPlan, DataPlaneExportResult } from '@neuropause/shared';
import { cn } from '@renderer/lib/cn';
import { ipc, type ExportScopeArg } from '@renderer/lib/ipc';
import { Button } from '@renderer/components/ui/Button';
import { Card } from '@renderer/components/ui/Card';
import { Icon } from '@renderer/components/ui/Icon';
import { Input } from '@renderer/components/ui/Input';
import { Spinner } from '@renderer/components/Spinner';
import {
  EXPORT_FORMATS,
  describeExport,
  friendlyError,
  type ExportFormatId,
} from './dataCommandCenterModel';
import { ErrorBlock, NoticeBlock, StatusPill } from './primitives';

export function ExportConfig({
  moduleId,
  moduleName,
  onDone,
  onCancel,
}: {
  moduleId: string;
  moduleName: string;
  onDone: (message: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const [plan, setPlan] = useState<DataPlaneExportPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ title: string; detail: string } | null>(null);

  const [format, setFormat] = useState<ExportFormatId>('xlsx');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({});
  // `null` means "the engine's defaults" — distinct from "the user unticked
  // everything", which is a real state the export refuses.
  const [selected, setSelected] = useState<string[] | null>(null);
  const [includeRestricted, setIncludeRestricted] = useState(false);
  const [includeProvenance, setIncludeProvenance] = useState(false);
  const [withManifest, setWithManifest] = useState(true);
  const [busy, setBusy] = useState(false);

  const scope: ExportScopeArg = {
    ...(search.trim() === '' ? {} : { search: search.trim() }),
    ...(Object.keys(filters).length === 0
      ? {}
      : { filters: Object.entries(filters).map(([field, value]) => ({ field, value })) }),
  };
  const scopeKey = JSON.stringify(scope);
  const selectedKey = selected === null ? '*' : selected.join(',');

  /**
   * Re-plan whenever the request changes.
   *
   * The plan is the only source of the record count, the withheld list and the
   * blocked reason, so it has to follow every control on this screen. It reads
   * nothing and writes nothing.
   */
  useEffect(() => {
    let live = true;
    setLoading(true);
    void ipc.data
      .exportPlan(moduleId, {
        ...(Object.keys(scope).length > 0 ? { scope } : {}),
        ...(selected === null ? {} : { fields: selected }),
        includeRestricted,
      })
      .then((p) => {
        if (live) {
          setPlan(p);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (live) {
          setError(friendlyError(err));
          setPlan(null);
        }
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
    // `scopeKey`/`selectedKey` are the stable identities of the two object
    // inputs; depending on the objects themselves would re-plan every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleId, scopeKey, selectedKey, includeRestricted]);

  const effectiveSelection = (p: DataPlaneExportPlan): string[] =>
    selected ?? p.fields.filter((f) => f.defaultSelected).map((f) => f.key);

  const toggleField = useCallback(
    (key: string): void => {
      setSelected((prev) => {
        const base = prev ?? plan?.fields.filter((f) => f.defaultSelected).map((f) => f.key) ?? [];
        return base.includes(key) ? base.filter((k) => k !== key) : [...base, key];
      });
    },
    [plan],
  );

  const run = useCallback(async (): Promise<void> => {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const result: DataPlaneExportResult = await ipc.data.export(moduleId, format, {
        includeProvenance,
        includeRestricted,
        withManifest,
        ...(Object.keys(scope).length > 0 ? { scope } : {}),
        ...(selected === null ? {} : { fields: selected }),
      });
      onDone(describeExport(result, moduleName));
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [format, includeProvenance, includeRestricted, moduleId, moduleName, onDone, plan, scopeKey, selectedKey, withManifest]);

  if (plan === null && loading) {
    return (
      <Card variant="flat" className="mt-3 flex items-center gap-3">
        <Spinner size={16} />
        <span className="text-sm text-muted">Working out what this would cover…</span>
      </Card>
    );
  }

  if (plan === null) {
    return (
      <div className="mt-3">
        <ErrorBlock
          title={error?.title ?? 'This export cannot be configured'}
          detail={error?.detail ?? 'The plan could not be computed.'}
        />
        <Button size="sm" className="mt-3" onClick={onCancel}>
          Close
        </Button>
      </div>
    );
  }

  const chosen = effectiveSelection(plan);
  const filterable = plan.fields.filter((f) => f.filterOptions !== null && f.selectable);
  const restricted = plan.fields.filter((f) => f.sensitivity === 'restricted');
  const secrets = plan.fields.filter((f) => f.sensitivity === 'secret');
  const blocked = plan.blockedReason ?? plan.tooLargeReason;

  return (
    <div className="mt-3 space-y-4 border-t border-[var(--hairline)] pt-4">
      {/* ── scope ─────────────────────────────────────────────────────── */}
      <section>
        <h4 className="text-sm font-semibold">What to export</h4>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Input
            className="h-8 w-56"
            aria-label="Search records"
            placeholder={`Search ${plan.plural.toLowerCase()}`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {filterable.map((f) => (
            <select
              key={f.key}
              aria-label={`Filter by ${f.label}`}
              className="h-8 rounded-lg border border-[var(--hairline)] [background:var(--fill-1)] px-2 text-sm"
              value={filters[f.key] ?? ''}
              onChange={(e) =>
                setFilters((prev) => {
                  const next = { ...prev };
                  if (e.target.value === '') delete next[f.key];
                  else next[f.key] = e.target.value;
                  return next;
                })
              }
            >
              <option value="">Any {f.label.toLowerCase()}</option>
              {(f.filterOptions ?? []).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ))}
          {loading && <Spinner size={14} />}
        </div>
        <p className="mt-2 text-sm text-muted">
          <span className="font-semibold text-ink tabular-nums">{plan.records.toLocaleString()}</span> of{' '}
          {plan.totalRecords.toLocaleString()} {plan.plural.toLowerCase()} — {plan.scopeLabel}.
        </p>
      </section>

      {/* ── fields ────────────────────────────────────────────────────── */}
      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="text-sm font-semibold">Columns</h4>
          <div className="flex gap-3 text-xs">
            <button
              type="button"
              className="text-muted underline-offset-2 hover:underline"
              onClick={() => setSelected(plan.fields.filter((f) => f.selectable && f.sensitivity === 'normal').map((f) => f.key))}
            >
              Select all allowed
            </button>
            <button
              type="button"
              className="text-muted underline-offset-2 hover:underline"
              onClick={() => setSelected([])}
            >
              Clear
            </button>
          </div>
        </div>
        <div className="mt-2 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
          {plan.fields
            .filter((f) => f.sensitivity !== 'secret')
            .map((f) => {
              const disabled = !f.selectable || (f.sensitivity === 'restricted' && !includeRestricted);
              return (
                <label
                  key={f.key}
                  className={cn('flex items-start gap-2 text-sm', disabled && 'opacity-60')}
                  title={f.reason}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 h-3.5 w-3.5 accent-[var(--accent)]"
                    checked={chosen.includes(f.key) && !disabled}
                    disabled={disabled}
                    onChange={() => toggleField(f.key)}
                  />
                  <span className="min-w-0">
                    {f.label}
                    {f.sensitivity === 'restricted' && (
                      <span className="ml-1.5 text-2xs uppercase tracking-wider text-sysorange">restricted</span>
                    )}
                  </span>
                </label>
              );
            })}
        </div>

        {restricted.length > 0 && (
          <div className="mt-3">
            {plan.mayIncludeRestricted ? (
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 h-3.5 w-3.5 accent-[var(--accent)]"
                  checked={includeRestricted}
                  onChange={(e) => {
                    setIncludeRestricted(e.target.checked);
                    // Unticking must actually drop them from the request, not
                    // just grey the boxes — the request is what the exporter
                    // reads.
                    if (!e.target.checked) {
                      setSelected((prev) =>
                        prev === null ? null : prev.filter((k) => !restricted.some((r) => r.key === k)),
                      );
                    }
                  }}
                />
                <span>
                  Include personal and financial identifiers (
                  {restricted.map((f) => f.label).join(', ')}).
                  <span className="block text-xs text-muted">
                    Recorded in the audit log and named in the manifest under your name.
                  </span>
                </span>
              </label>
            ) : (
              <NoticeBlock icon="lock">
                {restricted.length} field{restricted.length === 1 ? '' : 's'} (
                {restricted.map((f) => f.label).join(', ')}) hold personal or financial identifiers. Only
                someone who can edit {plan.plural.toLowerCase()} may export them.
              </NoticeBlock>
            )}
          </div>
        )}

        {secrets.length > 0 && (
          <p className="mt-2 text-xs text-faint">
            <Icon name="lock" size={11} className="mr-1 inline" />
            {secrets.map((f) => f.label).join(', ')} can never be exported — authentication material.
          </p>
        )}
      </section>

      {/* ── format ────────────────────────────────────────────────────── */}
      <section>
        <h4 className="text-sm font-semibold">Format</h4>
        <div className="mt-2 flex flex-wrap gap-2">
          {EXPORT_FORMATS.filter((f) => plan.formats.supported.includes(f.id)).map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={format === f.id}
              onClick={() => setFormat(f.id)}
              className={cn(
                'rounded-lg border px-3 py-1.5 text-left text-sm transition',
                format === f.id
                  ? 'border-accent/40 bg-accent/12 text-accent'
                  : 'border-[var(--hairline)] text-muted hover:text-ink',
              )}
            >
              <span className="font-medium">{f.label}</span>
              <span className="block text-xs opacity-80">{f.detail}</span>
            </button>
          ))}
        </div>
        {plan.formats.unavailable.map((u) => (
          <p key={u.format} className="mt-2 text-xs text-faint">
            {u.format.toUpperCase()} — export format unavailable. {u.reason}
          </p>
        ))}

        <div className="mt-3 space-y-1.5">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-3.5 w-3.5 accent-[var(--accent)]"
              checked={withManifest}
              onChange={(e) => setWithManifest(e.target.checked)}
            />
            <span>
              Package with a manifest (.zip)
              <span className="block text-xs text-muted">
                Adds manifest.json recording who exported what, the filters, the field list and a
                SHA-256 of the data file. It carries no business values.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-3.5 w-3.5 accent-[var(--accent)]"
              checked={includeProvenance}
              onChange={(e) => setIncludeProvenance(e.target.checked)}
            />
            <span>
              Include source columns
              <span className="block text-xs text-muted">
                Where each record came from. Records entered by hand leave these cells empty.
              </span>
            </span>
          </label>
        </div>
      </section>

      {/* ── what is being withheld ────────────────────────────────────── */}
      {plan.excluded.length > 0 && (
        <NoticeBlock icon="info">
          <span className="font-medium">Withheld from this export:</span>
          <ul className="mt-1 space-y-0.5">
            {plan.excluded.map((e) => (
              <li key={e.key}>
                {e.label} — {e.reason}
              </li>
            ))}
          </ul>
        </NoticeBlock>
      )}

      {error && <ErrorBlock title={error.title} detail={error.detail} />}

      {/* ── act ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--hairline)] pt-3">
        <div className="text-sm text-muted">
          {blocked !== null ? (
            <span className="text-sysorange">{blocked}</span>
          ) : (
            <>
              {plan.records.toLocaleString()} {plan.records === 1 ? 'record' : 'records'} ·{' '}
              {chosen.length} {chosen.length === 1 ? 'column' : 'columns'} · {format.toUpperCase()}
              {withManifest && ' + manifest'}
              {chosen.some((k) => restricted.some((r) => r.key === k)) && (
                <StatusPill tone="warn">includes restricted data</StatusPill>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon="download"
            loading={busy}
            disabled={blocked !== null || chosen.length === 0}
            onClick={() => void run()}
          >
            Export
          </Button>
        </div>
      </div>
    </div>
  );
}
