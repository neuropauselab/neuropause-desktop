/**
 * Data Command Center — the non-import panels.
 *
 * Overview, History, Mappings, Provenance and Data Quality. Every figure comes
 * from a real import run held in the provenance store; there is no seeded or
 * illustrative data anywhere in this file. When there is nothing to show, these
 * say so plainly rather than rendering an empty chart.
 */
import { useCallback, useEffect, useState } from 'react';
import type {
  DataPlaneExportableModule,
  DataPlaneOntologyView,
  DataPlaneRunResult,
  DataPlaneSavedMapping,
} from '@neuropause/shared';
import { cn } from '@renderer/lib/cn';
import { ipc } from '@renderer/lib/ipc';
import { Button } from '@renderer/components/ui/Button';
import { Card } from '@renderer/components/ui/Card';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { Icon } from '@renderer/components/ui/Icon';
import { Input } from '@renderer/components/ui/Input';
import { Loading } from '@renderer/components/ui/Loading';
import {
  EXPORT_FORMATS,
  SUPPORTED_FORMAT_LABEL,
  buildExportRows,
  buildOverview,
  buildProvenance,
  buildQualityIssues,
  buildResult,
  describeExport,
  friendlyError,
  type ExportFormatId,
  type ProvenanceModel,
} from './dataCommandCenterModel';
import {
  Confidence,
  DataTable,
  DetailRow,
  ErrorBlock,
  MetricTile,
  NoticeBlock,
  Section,
  StatusPill,
  Td,
  Th,
  type Tone,
} from './primitives';

function whenLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

// ── Overview ───────────────────────────────────────────────────────────────

export function OverviewPanel({
  history,
  onImport,
  onOpenRun,
}: {
  history: DataPlaneRunResult[];
  onImport: () => void;
  onOpenRun: (planId: string) => void;
}): JSX.Element {
  const model = buildOverview(history);

  if (model.empty) {
    return (
      <Card variant="flat">
        <EmptyState
          icon="database"
          title="No enterprise data imported yet"
          description={`Bring in ${SUPPORTED_FORMAT_LABEL}. NeuroPause identifies what each table is, shows you where every column would go, and writes nothing until you approve it.`}
          action={
            <Button variant="primary" icon="upload" onClick={onImport}>
              Import your first file
            </Button>
          }
        />
      </Card>
    );
  }

  return (
    <div>
      <p className="mb-5 text-base">{model.headline}</p>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {model.metrics.map((m) => (
          <MetricTile key={m.key} label={m.label} value={m.value} tone={m.tone} {...(m.hint ? { hint: m.hint } : {})} />
        ))}
      </div>

      <Section
        title="Recent imports"
        right={
          <Button size="sm" icon="upload" onClick={onImport}>
            Import a file
          </Button>
        }
      >
        <DataTable
          head={
            <tr>
              <Th>File</Th>
              <Th>When</Th>
              <Th>Result</Th>
              <Th>Records</Th>
              <Th />
            </tr>
          }
        >
          {model.recent.map((r) => (
            <tr key={r.planId}>
              <Td className="font-medium">{r.file}</Td>
              <Td className="text-muted">{whenLabel(r.at)}</Td>
              <Td>
                <StatusPill tone={r.tone}>{r.statusLabel}</StatusPill>
              </Td>
              <Td className="tabular-nums">{r.imported.toLocaleString()}</Td>
              <Td className="text-right">
                <Button size="sm" variant="ghost" onClick={() => onOpenRun(r.planId)}>
                  Details
                </Button>
              </Td>
            </tr>
          ))}
        </DataTable>
      </Section>
    </div>
  );
}

// ── History ────────────────────────────────────────────────────────────────

export function HistoryPanel({
  history,
  selected,
  onSelect,
}: {
  history: DataPlaneRunResult[];
  selected: string | null;
  onSelect: (planId: string | null) => void;
}): JSX.Element {
  if (history.length === 0) {
    return (
      <Card variant="flat">
        <EmptyState icon="clock" title="No imports yet" description="Every import is recorded here with its full result — including the ones that failed." />
      </Card>
    );
  }

  const run = history.find((r) => r.planId === selected) ?? null;
  if (run) {
    const result = buildResult(run);
    return (
      <div>
        <Button size="sm" icon="chevron-left" className="mb-4" onClick={() => onSelect(null)}>
          All imports
        </Button>
        <Card variant="flat" className="mb-4">
          <div className="flex flex-wrap items-center gap-3">
            <StatusPill tone={result.tone}>{result.statusLabel}</StatusPill>
            <span className="font-medium">{run.sourceFile}</span>
            <span className="text-sm text-muted">{whenLabel(run.importedAt)}</span>
            {run.actor && <span className="text-sm text-muted">by {run.actor}</span>}
          </div>
          <p className="mt-2 text-sm text-muted">{result.summary}</p>
        </Card>

        <DataTable
          head={
            <tr>
              <Th>Group</Th>
              <Th>Destination</Th>
              <Th>Result</Th>
              <Th>Imported</Th>
              <Th>Skipped</Th>
              <Th>Failed</Th>
              <Th>Note</Th>
            </tr>
          }
        >
          {run.tables.map((t) => (
            <tr key={t.tableName}>
              <Td className="font-medium">{t.tableName}</Td>
              <Td className="text-muted">{t.moduleId}</Td>
              <Td>
                <StatusPill tone={(result.tables.find((x) => x.tableName === t.tableName)?.tone ?? 'neutral') as Tone}>
                  {result.tables.find((x) => x.tableName === t.tableName)?.statusLabel ?? t.status}
                </StatusPill>
              </Td>
              <Td className="tabular-nums">{t.imported.toLocaleString()}</Td>
              <Td className="tabular-nums">{t.skipped.toLocaleString()}</Td>
              <Td className="tabular-nums">{t.failed.toLocaleString()}</Td>
              <Td className="text-muted">
                {t.rolledBack && <span className="mr-2 font-medium text-syspink">Rolled back.</span>}
                {t.note}
              </Td>
            </tr>
          ))}
        </DataTable>

        {result.errors.length > 0 && (
          <div className="mt-6">
            <Section title="Errors">
              <DataTable
                head={
                  <tr>
                    <Th>Source row</Th>
                    <Th>Problem</Th>
                  </tr>
                }
              >
                {result.errors.map((e, i) => (
                  <tr key={`${e.sourceRow}-${i}`}>
                    <Td className="tabular-nums">{e.sourceRow}</Td>
                    <Td className="text-muted">{e.message}</Td>
                  </tr>
                ))}
              </DataTable>
            </Section>
          </div>
        )}
      </div>
    );
  }

  return (
    <DataTable
      head={
        <tr>
          <Th>File</Th>
          <Th>When</Th>
          <Th>By</Th>
          <Th>Result</Th>
          <Th>Imported</Th>
          <Th>Failed</Th>
          <Th />
        </tr>
      }
    >
      {history.map((r) => {
        const result = buildResult(r);
        return (
          <tr key={r.planId}>
            <Td className="font-medium">{r.sourceFile}</Td>
            <Td className="text-muted">{whenLabel(r.importedAt)}</Td>
            <Td className="text-muted">{r.actor ?? '—'}</Td>
            <Td>
              <StatusPill tone={result.tone}>{result.statusLabel}</StatusPill>
            </Td>
            <Td className="tabular-nums">{r.totals.imported.toLocaleString()}</Td>
            <Td className="tabular-nums">{r.totals.failed.toLocaleString()}</Td>
            <Td className="text-right">
              <Button size="sm" variant="ghost" onClick={() => onSelect(r.planId)}>
                Open
              </Button>
            </Td>
          </tr>
        );
      })}
    </DataTable>
  );
}

// ── Data quality ───────────────────────────────────────────────────────────

const SEVERITY_TONE: Record<'high' | 'medium' | 'low', Tone> = {
  high: 'bad',
  medium: 'warn',
  low: 'neutral',
};

export function QualityPanel({ history }: { history: DataPlaneRunResult[] }): JSX.Element {
  if (history.length === 0) {
    return (
      <Card variant="flat">
        <EmptyState
          icon="shield"
          title="Nothing to assess yet"
          description="Data quality is measured from real imports. Import a file and every issue found will be listed here."
        />
      </Card>
    );
  }

  const issues = buildQualityIssues(history);
  if (issues.length === 0) {
    return (
      <Card variant="flat">
        <EmptyState
          icon="verified"
          title="No outstanding data issues"
          description="Every import so far completed with no failed rows, no rows held for review, and no duplicate candidates."
        />
      </Card>
    );
  }

  return (
    <div>
      <DataTable
        head={
          <tr>
            <Th>Issue</Th>
            <Th>Severity</Th>
            <Th>Affected</Th>
            <Th>What to do</Th>
          </tr>
        }
      >
        {issues.map((i) => (
          <tr key={i.issue}>
            <Td className="font-medium">{i.issue}</Td>
            <Td>
              <StatusPill tone={SEVERITY_TONE[i.severity]}>{i.severity}</StatusPill>
            </Td>
            <Td className="tabular-nums">{i.affected.toLocaleString()}</Td>
            <Td className="text-muted">{i.action}</Td>
          </tr>
        ))}
      </DataTable>

      <div className="mt-4">
        <NoticeBlock icon="info">
          Duplicate candidates are reported, never merged. NeuroPause does not silently combine two records that
          might be the same organisation or person.
        </NoticeBlock>
      </div>
    </div>
  );
}

// ── Mappings ───────────────────────────────────────────────────────────────

export function MappingsPanel(): JSX.Element {
  const [mappings, setMappings] = useState<DataPlaneSavedMapping[] | null>(null);
  const [error, setError] = useState<{ title: string; detail: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setError(null);
      setMappings(await ipc.data.mappings());
    } catch (err) {
      setError(friendlyError(err));
      setMappings([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const forget = useCallback(
    async (signature: string): Promise<void> => {
      setBusy(signature);
      try {
        await ipc.data.forgetMapping(signature);
        await load();
      } catch (err) {
        setError(friendlyError(err));
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  if (mappings === null) return <Loading kind="table" rows={5} />;

  return (
    <div>
      {error && (
        <div className="mb-4">
          <ErrorBlock title={error.title} detail={error.detail} onRetry={() => void load()} />
        </div>
      )}

      {mappings.length === 0 ? (
        <Card variant="flat">
          <EmptyState
            icon="memory"
            title="No remembered mappings"
            description="When you confirm how a file's columns map to a business entity, choose “Remember this mapping” and the same file shape will map itself next time."
          />
        </Card>
      ) : (
        <DataTable
          head={
            <tr>
              <Th>Entity</Th>
              <Th>Columns</Th>
              <Th>Used</Th>
              <Th>Version</Th>
              <Th>Updated</Th>
              <Th />
            </tr>
          }
        >
          {mappings.map((m) => (
            <tr key={m.signature}>
              <Td className="font-medium">{m.entityId}</Td>
              <Td className="text-muted">{m.columns.map((c) => c.header).join(', ')}</Td>
              <Td className="tabular-nums">{m.useCount.toLocaleString()}</Td>
              <Td className="tabular-nums">v{m.version}</Td>
              <Td className="text-muted">{whenLabel(m.updatedAt)}</Td>
              <Td className="text-right">
                <Button size="sm" variant="ghost" loading={busy === m.signature} onClick={() => void forget(m.signature)}>
                  Forget
                </Button>
              </Td>
            </tr>
          ))}
        </DataTable>
      )}
    </div>
  );
}

// ── Provenance ─────────────────────────────────────────────────────────────

export function ProvenancePanel({ history }: { history: DataPlaneRunResult[] }): JSX.Element {
  const [recordId, setRecordId] = useState('');
  const [model, setModel] = useState<ProvenanceModel | null>(null);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ title: string; detail: string } | null>(null);

  const lookup = useCallback(async (id: string): Promise<void> => {
    const trimmed = id.trim();
    if (trimmed.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const found = await ipc.data.provenance(trimmed);
      setModel(found ? buildProvenance(found) : null);
      setSearched(true);
    } catch (err) {
      setError(friendlyError(err));
      setModel(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Real examples to click, taken from actual imports — never invented ids.
  const examples = history
    .flatMap((r) => r.tables.flatMap((t) => t.createdRecordIds.slice(0, 3).map((id) => ({ id, file: r.sourceFile }))))
    .slice(0, 6);

  return (
    <div>
      <Section
        title="Where did this record come from?"
        subtitle="Every imported record keeps its source file, sheet, row and the original value of each field."
      >
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="w-[320px]"
            placeholder="Record id"
            value={recordId}
            onChange={(e) => setRecordId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void lookup(recordId);
            }}
          />
          <Button variant="primary" icon="search" loading={loading} onClick={() => void lookup(recordId)}>
            Trace
          </Button>
        </div>

        {examples.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted">
            <span>From your imports:</span>
            {examples.map((e) => (
              <button
                key={e.id}
                type="button"
                className="rounded-lg [background:var(--fill-1)] px-2 py-1 font-mono text-xs hover:[background:var(--fill-2)]"
                onClick={() => {
                  setRecordId(e.id);
                  void lookup(e.id);
                }}
              >
                {e.id}
              </button>
            ))}
          </div>
        )}
      </Section>

      {error && <ErrorBlock title={error.title} detail={error.detail} />}

      {!error && searched && model === null && (
        <Card variant="flat">
          <EmptyState
            icon="search"
            title="No import provenance for that record"
            description="Either the id does not exist, or the record was not created by an import — records created by hand or by a connector have their own history."
            compact
          />
        </Card>
      )}

      {model && (
        <div>
          <Card variant="flat" className="mb-4">
            <DetailRow label="Record" value={<span className="font-mono text-xs">{model.recordId}</span>} />
            <DetailRow label="Source" value={model.location} />
            <DetailRow label="Imported" value={whenLabel(model.importedAt)} />
            <DetailRow label="Classification confidence" value={<Confidence pct={model.confidencePct} band={model.confidencePct >= 85 ? 'high' : model.confidencePct >= 60 ? 'medium' : 'low'} />} />
            <DetailRow label="Approved by" value={model.approvedBy ?? 'Not required'} />
          </Card>

          <Section title="Field by field" subtitle="The original value from your file, and any transformation applied.">
            <DataTable
              head={
                <tr>
                  <Th>Field</Th>
                  <Th>Column in your file</Th>
                  <Th>Original value</Th>
                  <Th>Transformation</Th>
                </tr>
              }
            >
              {model.fields.map((f) => (
                <tr key={f.field}>
                  <Td className="font-medium">{f.field}</Td>
                  <Td className="text-muted">{f.column}</Td>
                  <Td className="font-mono text-xs">{f.original}</Td>
                  <Td className="text-muted">{f.transformation ?? 'Stored as-is'}</Td>
                </tr>
              ))}
            </DataTable>
          </Section>
        </div>
      )}
    </div>
  );
}

// ── Coverage (what the engine can classify) ────────────────────────────────

export function CoveragePanel({ ontology }: { ontology: DataPlaneOntologyView | null }): JSX.Element {
  if (ontology === null) return <Loading kind="table" rows={5} />;

  return (
    <div>
      <Section
        title="What NeuroPause can recognise"
        subtitle="A file is matched against these business entities. Anything else is reported as unrecognised rather than guessed at."
      >
        <DataTable
          head={
            <tr>
              <Th>Entity</Th>
              <Th>Area</Th>
              <Th>Fields</Th>
              <Th>Risk</Th>
              <Th>Approval</Th>
            </tr>
          }
        >
          {ontology.entities.map((e) => (
            <tr key={e.id}>
              <Td className="font-medium">{e.plural}</Td>
              <Td className="text-muted">{e.domain}</Td>
              <Td className="text-muted">{e.fields.map((f) => f.label).join(', ')}</Td>
              <Td>
                <StatusPill tone={e.risk === 'high' ? 'bad' : e.risk === 'medium' ? 'warn' : 'neutral'}>{e.risk}</StatusPill>
              </Td>
              <Td className="text-muted">{e.requiresApproval ? 'Always required' : 'Only when confidence is low'}</Td>
            </tr>
          ))}
        </DataTable>
      </Section>

      <Section title="Formats" subtitle="What this build reads, and what it deliberately does not.">
        <div className="mb-3 flex flex-wrap gap-2">
          {ontology.supportedFormats.map((f) => (
            <span key={f} className="rounded-lg bg-sysgreen/10 px-2.5 py-1 text-sm font-medium uppercase text-sysgreen">
              {f}
            </span>
          ))}
        </div>
        <div className="space-y-2">
          {ontology.unsupportedFormats.map((f) => (
            <NoticeBlock key={f.format} icon="info">
              <span className="font-medium uppercase">{f.format}</span> — {f.reason}
            </NoticeBlock>
          ))}
        </div>
      </Section>

      <NoticeBlock icon="lock">
        Imports are governed. Loading data needs the <span className="font-medium">data:import</span> right; approving
        anything touching money, payroll or master data needs <span className="font-medium">data:approve</span> as
        well, so the person who loads a file is not automatically the person who signs it off.
      </NoticeBlock>
    </div>
  );
}

/** Shared refresh affordance for the header. */
export function RefreshButton({ onClick, busy }: { onClick: () => void; busy: boolean }): JSX.Element {
  return (
    <button
      type="button"
      aria-label="Refresh"
      title="Refresh"
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-muted fill-hover hover:text-ink"
    >
      <Icon name="refresh" size={16} className={busy ? 'animate-spin' : undefined} />
    </button>
  );
}

// ── Export ─────────────────────────────────────────────────────────────────

export function ExportPanel(): JSX.Element {
  const [modules, setModules] = useState<DataPlaneExportableModule[] | null>(null);
  const [format, setFormat] = useState<ExportFormatId>('xlsx');
  const [includeProvenance, setIncludeProvenance] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<{ title: string; detail: string } | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setError(null);
      setModules(await ipc.data.exportable());
    } catch (err) {
      setError(friendlyError(err));
      setModules([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(
    async (moduleId: string, name: string): Promise<void> => {
      setBusy(moduleId);
      setMessage(null);
      setError(null);
      try {
        const result = await ipc.data.export(moduleId, format, includeProvenance);
        setMessage(describeExport(result, name));
      } catch (err) {
        setError(friendlyError(err));
      } finally {
        setBusy(null);
      }
    },
    [format, includeProvenance],
  );

  if (modules === null) return <Loading kind="table" rows={5} />;

  const rows = buildExportRows(modules);

  return (
    <div>
      <Section
        title="Export your data"
        subtitle="Take records out of NeuroPause in a format you can open, hand to an accountant, or load into another system."
      >
        <Card variant="flat">
          <div className="flex flex-wrap items-center gap-2">
            {EXPORT_FORMATS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFormat(f.id)}
                className={cn(
                  'rounded-xl border px-3.5 py-2 text-left transition',
                  format === f.id
                    ? 'border-accent [background:var(--fill-1)]'
                    : 'border-[var(--hairline)] hover:[background:var(--fill-1)]',
                )}
              >
                <div className="text-sm font-semibold">{f.label}</div>
                <div className="text-xs text-faint">{f.detail}</div>
              </button>
            ))}
          </div>

          <label className="mt-4 flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
              checked={includeProvenance}
              onChange={(e) => setIncludeProvenance(e.target.checked)}
            />
            <span>
              Include source columns
              <span className="block text-xs text-faint">
                Adds the file, sheet and row each record was imported from. Records created by hand leave these
                cells empty.
              </span>
            </span>
          </label>
        </Card>
      </Section>

      {message && (
        <div className="mb-5">
          <NoticeBlock icon="check">{message}</NoticeBlock>
        </div>
      )}
      {error && (
        <div className="mb-5">
          <ErrorBlock title={error.title} detail={error.detail} onRetry={() => void load()} />
        </div>
      )}

      {rows.length === 0 ? (
        <Card variant="flat">
          <EmptyState
            icon="download"
            title="Nothing to export yet"
            description="Only modules that hold records are listed here. Import a file, or create records in the business modules, and they will appear."
          />
        </Card>
      ) : (
        <DataTable
          head={
            <tr>
              <Th>Data</Th>
              <Th>Area</Th>
              <Th>Records</Th>
              <Th>Traceability</Th>
              <Th />
            </tr>
          }
        >
          {rows.map((r) => (
            <tr key={r.moduleId}>
              <Td className="font-medium">{r.name}</Td>
              <Td className="text-muted">{r.group}</Td>
              <Td className="tabular-nums">{r.records.toLocaleString()}</Td>
              <Td className="text-muted">{r.provenanceNote}</Td>
              <Td className="text-right">
                <Button
                  size="sm"
                  icon="download"
                  loading={busy === r.moduleId}
                  onClick={() => void run(r.moduleId, r.name)}
                >
                  Export
                </Button>
              </Td>
            </tr>
          ))}
        </DataTable>
      )}
    </div>
  );
}
