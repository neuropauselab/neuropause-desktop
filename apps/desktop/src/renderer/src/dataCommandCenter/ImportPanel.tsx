/**
 * Import Center — the full lifecycle: choose → identify → analyze → review the
 * mapping → approve → import → results.
 *
 * Every decision this panel makes is delegated to `dataCommandCenterModel`,
 * which is tested. What lives here is only wiring: file bytes, IPC calls, and
 * which block is on screen. In particular:
 *   - Nothing is written until the user presses the import button, and the
 *     button is disabled with a stated reason until the plan is actually ready.
 *   - Progress is the engine's real STAGE. There is no percentage, because the
 *     backend cannot report one and inventing it would be a lie.
 *   - A group requiring approval starts unchecked; a blocked group cannot be
 *     checked at all.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  DataPlaneOntologyEntity,
  DataPlanePlanSummary,
  DataPlaneSavedMapping,
} from '@neuropause/shared';
import { cn } from '@renderer/lib/cn';
import { ipc } from '@renderer/lib/ipc';
import { createLogger } from '@renderer/lib/logger';
import { Button } from '@renderer/components/ui/Button';
import { Card } from '@renderer/components/ui/Card';
import { Icon } from '@renderer/components/ui/Icon';
import { Textarea } from '@renderer/components/ui/Input';
import { Spinner } from '@renderer/components/Spinner';
import {
  IMPORT_STAGE_LABEL,
  PREVIEW_PAGE_SIZE,
  SUPPORTED_FORMAT_LABEL,
  approvalDefaults,
  buildInspection,
  buildMappingRows,
  buildPlan,
  buildPreview,
  buildResult,
  bytesToBase64,
  clearRowDecisions,
  friendlyError,
  importReadiness,
  isBusyStage,
  mergeApprovals,
  setRowDecision,
  toApprovals,
  tooLargeMessage,
  undecidedRows,
  type ImportStage,
  type InspectionModel,
  type PlanEffects,
  type PlanModel,
  type PreviewModel,
  type PreviewRowModel,
  type ResultModel,
  type RowDecisions,
} from './dataCommandCenterModel';
import { EntityCorrection, INITIAL_ROW_REVIEW, RowReview, type RowReviewState } from './RowReview';
import {
  Confidence,
  DataTable,
  ErrorBlock,
  NoticeBlock,
  Section,
  StatusPill,
  Td,
  Th,
} from './primitives';

const log = createLogger('data-import');

interface PanelError {
  title: string;
  detail: string;
  canRetry: boolean;
}

export function ImportPanel({ onImported }: { onImported: () => void }): JSX.Element {
  const [stage, setStage] = useState<ImportStage>('idle');
  const [inspection, setInspection] = useState<InspectionModel | null>(null);
  const [raw, setRaw] = useState<DataPlanePlanSummary | null>(null);
  const [plan, setPlan] = useState<PlanModel | null>(null);
  const [approvals, setApprovals] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<ResultModel | null>(null);
  const [error, setError] = useState<PanelError | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [remembered, setRemembered] = useState<Record<string, DataPlaneSavedMapping | null>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  /** Row review, per table. Absent until the reviewer opens that table. */
  const [entities, setEntities] = useState<DataPlaneOntologyEntity[]>([]);
  const [openRows, setOpenRows] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState<string | null>(null);
  const [reclassifying, setReclassifying] = useState(false);
  const [rowState, setRowState] = useState<Record<string, RowReviewState>>({});
  const [previews, setPreviews] = useState<Record<string, PreviewModel | null>>({});
  const [previewLoading, setPreviewLoading] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<Record<string, string | null>>({});
  const [decisions, setDecisions] = useState<RowDecisions>({});

  const reset = useCallback((): void => {
    setInspection(null);
    setRaw(null);
    setPlan(null);
    setApprovals({});
    setReason('');
    setResult(null);
    setError(null);
    setExpanded(null);
    setRemembered({});
    setOpenRows(null);
    setCorrecting(null);
    setRowState({});
    setPreviews({});
    setPreviewError({});
    setDecisions({});
  }, []);

  // The entity list is needed both to offer a correction and to name what a
  // table was corrected FROM. Fetched once; a failure is not fatal — it only
  // means the correction control cannot be offered.
  useEffect(() => {
    let live = true;
    void ipc.data
      .ontology()
      .then((o) => {
        if (live) setEntities(o.entities);
      })
      .catch((err: unknown) => {
        log.warn('Ontology unavailable', { message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      live = false;
    };
  }, []);

  const startOver = useCallback((): void => {
    reset();
    setStage('idle');
    if (fileRef.current) fileRef.current.value = '';
  }, [reset]);

  const handleFile = useCallback(
    async (file: File): Promise<void> => {
      reset();

      // Size is checked BEFORE reading, so an oversized file is never pulled
      // into renderer memory just to be rejected.
      const tooLarge = tooLargeMessage(file.size);
      if (tooLarge !== null) {
        setError({ title: 'That file is too large', detail: tooLarge, canRetry: false });
        setStage('error');
        return;
      }

      try {
        setStage('reading');
        const bytes = new Uint8Array(await file.arrayBuffer());
        const contentBase64 = bytesToBase64(bytes);

        setStage('inspecting');
        const inspected = await ipc.data.inspect(file.name, contentBase64);
        const inspectionModel = buildInspection(inspected);
        setInspection(inspectionModel);

        if (!inspectionModel.supported) {
          setError({
            title: 'This file cannot be read',
            detail: inspectionModel.reason ?? 'The format is not supported in this build.',
            canRetry: false,
          });
          setStage('error');
          return;
        }

        setStage('analyzing');
        const summary = await ipc.data.analyze(file.name, contentBase64);
        const planModel = buildPlan(summary, entities);
        setRaw(summary);
        setPlan(planModel);
        setApprovals(approvalDefaults(planModel));

        // Which of these shapes has this tenant already confirmed? Looked up per
        // table so the "remembered" badge reflects the real store, not a guess.
        const found = await Promise.all(
          summary.tables.map(async (t) => {
            const list = await ipc.data.mappings(t.signature).catch(() => []);
            return [t.tableName, list[0] ?? null] as const;
          }),
        );
        setRemembered(Object.fromEntries(found));
        setStage('review');
      } catch (err) {
        log.warn('Import analysis failed', { message: err instanceof Error ? err.message : String(err) });
        setError(friendlyError(err));
        setStage('error');
      }
    },
    [entities, reset],
  );

  /**
   * Fetch the open table's rows whenever the reviewer changes filter, search
   * or page. Deliberately not cached across those changes: the counts and the
   * identity matches are recomputed against the destination as it is NOW, and
   * a stale "this is new" is exactly how a duplicate gets created.
   */
  useEffect(() => {
    const table = openRows;
    if (table === null || plan === null) return;
    const view = rowState[table] ?? INITIAL_ROW_REVIEW;
    let live = true;
    setPreviewLoading(table);
    void ipc.data
      .preview(plan.planId, table, {
        mode: view.filter,
        offset: view.offset,
        limit: PREVIEW_PAGE_SIZE,
        ...(view.search.trim() === '' ? {} : { search: view.search.trim() }),
      })
      .then((p) => {
        if (!live) return;
        setPreviews((prev) => ({ ...prev, [table]: p === null ? null : buildPreview(p) }));
        setPreviewError((prev) => ({ ...prev, [table]: null }));
      })
      .catch((err: unknown) => {
        if (!live) return;
        // A reviewer may hold `data:import` without the destination module's
        // read scope. That is a real refusal, not a blank pane.
        setPreviewError((prev) => ({ ...prev, [table]: friendlyError(err).detail }));
        setPreviews((prev) => ({ ...prev, [table]: null }));
      })
      .finally(() => {
        if (live) setPreviewLoading((cur) => (cur === table ? null : cur));
      });
    return () => {
      live = false;
    };
  }, [openRows, plan, rowState]);

  const correctEntity = useCallback(
    async (tableName: string, entityId: string, why: string): Promise<void> => {
      if (!plan) return;
      setReclassifying(true);
      try {
        const summary = await ipc.data.reclassify(plan.planId, tableName, entityId, why);
        const next = buildPlan(summary, entities);
        setRaw(summary);
        setPlan(next);
        // Ticks on OTHER tables survive; the corrected one resets to its new
        // default, which for an overridden table is always unticked.
        setApprovals((prev) => mergeApprovals(prev, next, tableName));
        // Everything derived from the old reading is now wrong, so it goes.
        setDecisions((prev) => clearRowDecisions(prev, tableName));
        setPreviews((prev) => ({ ...prev, [tableName]: null }));
        // A refusal recorded against the OLD entity says nothing about the new
        // one, and leaving it would render "the rows could not be shown" over
        // a table that can now be read perfectly well.
        setPreviewError((prev) => ({ ...prev, [tableName]: null }));
        setRowState((prev) => ({ ...prev, [tableName]: INITIAL_ROW_REVIEW }));
        setRemembered((prev) => ({ ...prev, [tableName]: null }));
        setCorrecting(null);
        setExpanded(null);
      } catch (err) {
        log.warn('Reclassify failed', { message: err instanceof Error ? err.message : String(err) });
        setError(friendlyError(err));
      } finally {
        setReclassifying(false);
      }
    },
    [entities, plan],
  );

  const decideRow = useCallback(
    (tableName: string, row: PreviewRowModel, action: 'create' | 'update' | 'skip'): void => {
      setDecisions((prev) => setRowDecision(prev, tableName, row, action));
    },
    [],
  );

  const runImport = useCallback(async (): Promise<void> => {
    if (!plan) return;
    setStage('importing');
    setError(null);
    try {
      const trimmed = reason.trim();
      const run = await ipc.data.import(
        plan.planId,
        toApprovals(approvals, plan, decisions),
        trimmed.length > 0 ? trimmed : undefined,
      );
      setResult(buildResult(run));
      setStage('done');
      onImported();
    } catch (err) {
      log.warn('Import failed', { message: err instanceof Error ? err.message : String(err) });
      /**
       * Back to REVIEW, not to the error stage.
       *
       * The error stage renders only an error card, whose every button calls
       * `startOver` and wipes the plan. The designed failure mode here is the
       * stale-match guard — "the matching record changed since you reviewed
       * this row" — so the reviewer most likely to hit it is the one who has
       * just paged through hundreds of rows, answered the ambiguous ones and
       * written an approval reason. Throwing all of that away is a worse
       * outcome than the error it is reporting.
       */
      setError(friendlyError(err));
      setStage('review');
    }
  }, [approvals, decisions, onImported, plan, reason]);

  const rememberMapping = useCallback(
    async (tableName: string): Promise<void> => {
      const table = raw?.tables.find((t) => t.tableName === tableName);
      if (!table) return;
      const columns = table.mappings
        .filter((m) => m.fieldKey !== null)
        .map((m) => ({ header: m.header, fieldKey: m.fieldKey as string }));
      if (columns.length === 0) return;
      setSaving(tableName);
      try {
        const saved = await ipc.data.saveMapping(table.signature, table.entityId, columns);
        setRemembered((prev) => ({ ...prev, [tableName]: saved }));
      } catch (err) {
        setError(friendlyError(err));
      } finally {
        setSaving(null);
      }
    },
    [raw],
  );

  const forgetMapping = useCallback(
    async (tableName: string): Promise<void> => {
      const table = raw?.tables.find((t) => t.tableName === tableName);
      if (!table) return;
      setSaving(tableName);
      try {
        await ipc.data.forgetMapping(table.signature);
        setRemembered((prev) => ({ ...prev, [tableName]: null }));
      } catch (err) {
        setError(friendlyError(err));
      } finally {
        setSaving(null);
      }
    },
    [raw],
  );

  /**
   * Real action counts, and only for tables actually looked at.
   *
   * An unpreviewed table contributes nothing rather than a guess, which is
   * what keeps the sentence next to the button from claiming a breakdown
   * nobody computed.
   */
  const effects: PlanEffects = {};
  for (const [name, p] of Object.entries(previews)) {
    if (p !== null) effects[name] = p.plan;
  }
  const readiness = plan ? importReadiness(plan, approvals, reason, effects, decisions) : null;
  const busy = isBusyStage(stage);

  return (
    <div>
      <StageBar stage={stage} />

      {stage === 'idle' && (
        <DropZone
          dragging={dragging}
          onDragState={setDragging}
          onPick={() => fileRef.current?.click()}
          onFile={(f) => void handleFile(f)}
        />
      )}

      <input
        ref={fileRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
      />

      {inspection && stage !== 'idle' && <InspectionCard inspection={inspection} />}

      {busy && (
        <Card variant="flat" className="mt-4 flex items-center gap-3">
          <Spinner size={16} />
          <span className="text-sm text-muted">{IMPORT_STAGE_LABEL[stage]}…</span>
        </Card>
      )}

      {error && (
        <div className="mt-4">
          {/*
           * In the review stage the plan is still underneath this card, so
           * "try again" means DISMISS and press Import again — not start over.
           * Wiring it to `startOver` here threw away the reviewer's row
           * decisions and approval reason on the one error they are most
           * likely to see, the stale-match refusal.
           */}
          <ErrorBlock
            title={error.title}
            detail={error.detail}
            onRetry={
              stage === 'review' ? () => setError(null) : error.canRetry ? startOver : undefined
            }
          />
          {stage !== 'review' && !error.canRetry && (
            <Button size="sm" icon="undo" className="mt-3" onClick={startOver}>
              Choose a different file
            </Button>
          )}
        </div>
      )}

      {stage === 'review' && plan && raw && (
        <ReviewStep
          plan={plan}
          raw={raw}
          approvals={approvals}
          onToggle={(name, next) => setApprovals((prev) => ({ ...prev, [name]: next }))}
          expanded={expanded}
          onExpand={(name) => setExpanded((prev) => (prev === name ? null : name))}
          remembered={remembered}
          saving={saving}
          onRemember={(name) => void rememberMapping(name)}
          onForget={(name) => void forgetMapping(name)}
          reason={reason}
          onReason={setReason}
          readiness={readiness}
          onImport={() => void runImport()}
          onCancel={startOver}
          entities={entities}
          openRows={openRows}
          onOpenRows={(name) => {
            setOpenRows((prev) => (prev === name ? null : name));
            setCorrecting(null);
          }}
          correcting={correcting}
          onCorrect={(name) => {
            setCorrecting((prev) => (prev === name ? null : name));
            setOpenRows(null);
          }}
          reclassifying={reclassifying}
          onApplyCorrection={(name, entityId, why) => void correctEntity(name, entityId, why)}
          previews={previews}
          previewLoading={previewLoading}
          previewError={previewError}
          rowState={rowState}
          onRowState={(name, next) => setRowState((prev) => ({ ...prev, [name]: next }))}
          decisions={decisions}
          onDecide={decideRow}
          onClearDecisions={(name) => setDecisions((prev) => clearRowDecisions(prev, name))}
        />
      )}

      {stage === 'done' && result && <ResultStep result={result} onAgain={startOver} />}
    </div>
  );
}

// ── stages ─────────────────────────────────────────────────────────────────

const STAGE_ORDER: ImportStage[] = ['idle', 'inspecting', 'analyzing', 'review', 'importing', 'done'];

/**
 * The real pipeline position. Named stages only — the engine reports which step
 * it is on, never how far through it is, so neither does this.
 */
function StageBar({ stage }: { stage: ImportStage }): JSX.Element {
  const effective: ImportStage = stage === 'reading' ? 'inspecting' : stage;
  const index = STAGE_ORDER.indexOf(effective);
  return (
    <ol className="mb-5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm">
      {STAGE_ORDER.map((s, i) => {
        const done = index > i && stage !== 'error';
        const current = index === i && stage !== 'error';
        return (
          <li key={s} className="flex items-center gap-2">
            <span
              className={cn(
                'flex h-5 w-5 items-center justify-center rounded-full text-2xs font-semibold',
                done && 'bg-sysgreen/15 text-sysgreen',
                current && 'bg-accent/15 text-accent',
                !done && !current && '[background:var(--fill-2)] text-faint',
              )}
            >
              {done ? <Icon name="check" size={11} /> : i + 1}
            </span>
            <span className={cn(current ? 'font-medium text-ink' : 'text-faint')}>
              {IMPORT_STAGE_LABEL[s]}
            </span>
            {i < STAGE_ORDER.length - 1 && <Icon name="chevron-right" size={12} className="text-faint" />}
          </li>
        );
      })}
    </ol>
  );
}

function DropZone({
  dragging,
  onDragState,
  onPick,
  onFile,
}: {
  dragging: boolean;
  onDragState: (v: boolean) => void;
  onPick: () => void;
  onFile: (f: File) => void;
}): JSX.Element {
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        onDragState(true);
      }}
      onDragLeave={() => onDragState(false)}
      onDrop={(e) => {
        e.preventDefault();
        onDragState(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
      className={cn(
        'flex flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-14 text-center transition',
        dragging ? 'border-accent [background:var(--fill-1)]' : 'border-[var(--hairline-strong)]',
      )}
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl [background:var(--fill-2)] text-faint">
        <Icon name="upload" size={22} />
      </span>
      <h3 className="mt-4 text-base font-semibold">Drop a file here</h3>
      <p className="mt-1 max-w-[380px] text-sm text-faint">
        {SUPPORTED_FORMAT_LABEL}. Nothing is written until you review what was found and approve it.
      </p>
      <Button variant="primary" icon="upload" className="mt-4" onClick={onPick}>
        Choose a file
      </Button>
    </div>
  );
}

function InspectionCard({ inspection }: { inspection: InspectionModel }): JSX.Element {
  return (
    <Card variant="flat" className="mt-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className="flex items-center gap-2 font-medium">
          <Icon name="doc" size={15} className="text-faint" />
          {inspection.filename}
        </span>
        <span className="text-sm text-muted">{inspection.format}</span>
        <span className="text-sm text-muted">{inspection.sizeLabel}</span>
        {inspection.supported && (
          <>
            <span className="text-sm text-muted">
              {inspection.sheets.length} {inspection.sheets.length === 1 ? 'table' : 'tables'}
            </span>
            <span className="text-sm text-muted">{inspection.rows.toLocaleString()} rows</span>
          </>
        )}
      </div>
    </Card>
  );
}

// ── review ─────────────────────────────────────────────────────────────────

function ReviewStep({
  plan,
  raw,
  approvals,
  onToggle,
  expanded,
  onExpand,
  remembered,
  saving,
  onRemember,
  onForget,
  reason,
  onReason,
  readiness,
  onImport,
  onCancel,
  entities,
  openRows,
  onOpenRows,
  correcting,
  onCorrect,
  reclassifying,
  onApplyCorrection,
  previews,
  previewLoading,
  previewError,
  rowState,
  onRowState,
  decisions,
  onDecide,
  onClearDecisions,
}: {
  plan: PlanModel;
  raw: DataPlanePlanSummary;
  approvals: Record<string, boolean>;
  onToggle: (tableName: string, next: boolean) => void;
  expanded: string | null;
  onExpand: (tableName: string) => void;
  remembered: Record<string, DataPlaneSavedMapping | null>;
  saving: string | null;
  onRemember: (tableName: string) => void;
  onForget: (tableName: string) => void;
  reason: string;
  onReason: (v: string) => void;
  readiness: ReturnType<typeof importReadiness> | null;
  onImport: () => void;
  onCancel: () => void;
  entities: readonly DataPlaneOntologyEntity[];
  openRows: string | null;
  onOpenRows: (tableName: string) => void;
  correcting: string | null;
  onCorrect: (tableName: string) => void;
  reclassifying: boolean;
  onApplyCorrection: (tableName: string, entityId: string, reason: string) => void;
  previews: Record<string, PreviewModel | null>;
  previewLoading: string | null;
  previewError: Record<string, string | null>;
  rowState: Record<string, RowReviewState>;
  onRowState: (tableName: string, next: RowReviewState) => void;
  decisions: RowDecisions;
  onDecide: (tableName: string, row: PreviewRowModel, action: 'create' | 'update' | 'skip') => void;
  onClearDecisions: (tableName: string) => void;
}): JSX.Element {
  const needsReason = readiness !== null && plan.tables.some((t) => t.requiresApproval && !t.blocked && approvals[t.tableName] === true);

  return (
    <div className="mt-5">
      {plan.unsupported && (
        <div className="mb-4">
          <NoticeBlock>{plan.unsupported}</NoticeBlock>
        </div>
      )}

      {plan.nothingToImport && (
        <Card variant="flat" className="mb-4">
          <h3 className="text-base font-semibold">Nothing in this file can be imported</h3>
          <p className="mt-1.5 text-sm text-muted">
            {plan.tables.length === 0
              ? 'No table in this file matched a known business entity.'
              : 'Every row failed validation. The reasons are listed per group below.'}
          </p>
          <Button size="sm" icon="undo" className="mt-3" onClick={onCancel}>
            Choose a different file
          </Button>
        </Card>
      )}

      {plan.tables.length > 0 && (
        <Section
          title="What was found"
          subtitle="Review each group before anything is written. Tick what you want to import."
        >
          <div className="space-y-3">
            {plan.tables.map((t) => {
              const table = raw.tables.find((r) => r.tableName === t.tableName);
              const rows = table ? buildMappingRows(table.mappings, remembered[t.tableName] ?? null) : [];
              const isOpen = expanded === t.tableName;
              const saved = remembered[t.tableName] ?? null;
              const rowsOpen = openRows === t.tableName;
              const isCorrecting = correcting === t.tableName;
              const preview = previews[t.tableName] ?? null;
              const view = rowState[t.tableName] ?? INITIAL_ROW_REVIEW;
              // Only claimed once the rows have actually been read. Before
              // that the honest answer is nothing, not zero.
              const outstanding = preview === null ? 0 : undecidedRows(preview, decisions[t.tableName]);
              return (
                <Card key={t.tableName} variant="flat" flush className="overflow-hidden">
                  <div className="flex items-start gap-3 p-4">
                    <input
                      type="checkbox"
                      id={`approve-${t.tableName}`}
                      className="mt-1 h-4 w-4 accent-[var(--accent)] disabled:opacity-40"
                      checked={approvals[t.tableName] === true}
                      disabled={t.blocked}
                      onChange={(e) => onToggle(t.tableName, e.target.checked)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <label htmlFor={`approve-${t.tableName}`} className="text-base font-semibold">
                          {t.tableName}
                        </label>
                        <Icon name="arrow-right" size={13} className="text-faint" />
                        <span className="text-base">{t.destination}</span>
                        {t.requiresApproval && !t.blocked && <StatusPill tone="warn">Approval</StatusPill>}
                        {t.blocked && <StatusPill tone="bad">Blocked</StatusPill>}
                        {saved && <StatusPill tone="neutral">Remembered</StatusPill>}
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted">
                        <span className="tabular-nums">{t.records.toLocaleString()} records ready</span>
                        <Confidence pct={t.confidencePct} band={t.band} />
                        {t.issues > 0 && <span className="text-sysorange">{t.issues} need review</span>}
                        {t.duplicates > 0 && <span className="text-sysorange">{t.duplicates} possible duplicates</span>}
                        <span className="uppercase tracking-wider text-faint">{t.risk} risk</span>
                      </div>

                      {t.correction && (
                        <p className="mt-2 text-sm text-muted">
                          You corrected this from <span className="font-medium">{t.correction.fromLabel}</span>.
                          {t.correction.reason && <> “{t.correction.reason}”</>} Everything below was recomputed.
                        </p>
                      )}

                      {t.holdReason && (
                        <p className={cn('mt-2 text-sm', t.blocked ? 'text-syspink' : 'text-sysorange')}>
                          {t.holdReason}
                        </p>
                      )}

                      {outstanding > 0 && (
                        <p className="mt-2 text-sm text-sysorange">
                          {outstanding} {outstanding === 1 ? 'row needs' : 'rows need'} a decision. Rows left
                          undecided are skipped, not guessed.
                        </p>
                      )}

                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Button size="sm" icon={isOpen ? 'chevron-down' : 'chevron-right'} onClick={() => onExpand(t.tableName)}>
                          {isOpen ? 'Hide column mapping' : `Review ${rows.length} columns`}
                        </Button>
                        <Button
                          size="sm"
                          icon={rowsOpen ? 'chevron-down' : 'list'}
                          onClick={() => onOpenRows(t.tableName)}
                        >
                          {rowsOpen ? 'Hide the rows' : 'Look at the rows'}
                        </Button>
                        {entities.length === 0 ? (
                          <span className="text-xs text-faint">
                            Correction unavailable — the entity list could not be loaded.
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => onCorrect(t.tableName)}
                          >
                            {/*
                             * Deliberately not "Not a {entity}?" — that reads
                             * well for "Not a Customer?" and badly for "Not a
                             * Employee?", and an article rule is not worth the
                             * bug surface on a control this important.
                             */}
                            {isCorrecting ? 'Cancel correction' : 'Change what this is'}
                          </Button>
                        )}
                        {saved ? (
                          <Button size="sm" variant="ghost" loading={saving === t.tableName} onClick={() => onForget(t.tableName)}>
                            Forget this mapping
                          </Button>
                        ) : (
                          <Button size="sm" variant="ghost" loading={saving === t.tableName} onClick={() => onRemember(t.tableName)}>
                            Remember this mapping
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>

                  {isCorrecting && (
                    <EntityCorrection
                      currentEntityId={t.entityId}
                      entities={entities}
                      busy={reclassifying}
                      onApply={(entityId, why) => onApplyCorrection(t.tableName, entityId, why)}
                      onCancel={() => onCorrect(t.tableName)}
                    />
                  )}

                  {rowsOpen && (
                    <RowReview
                      preview={preview}
                      state={view}
                      onState={(next) => onRowState(t.tableName, next)}
                      loading={previewLoading === t.tableName}
                      error={previewError[t.tableName] ?? null}
                      decisions={decisions[t.tableName]}
                      pageSize={PREVIEW_PAGE_SIZE}
                      onDecide={(row, action) => onDecide(t.tableName, row, action)}
                      onClearDecisions={() => onClearDecisions(t.tableName)}
                    />
                  )}

                  {isOpen && (
                    <div className="border-t border-[var(--hairline)]">
                      <table className="w-full text-left text-sm">
                        <thead className="text-xs uppercase tracking-wider text-faint">
                          <tr>
                            <Th>Column in your file</Th>
                            <Th>Mapped to</Th>
                            <Th>Confidence</Th>
                            <Th>Status</Th>
                            <Th>Why</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r) => (
                            <tr key={r.columnIndex}>
                              <Td className="font-medium">{r.source}</Td>
                              <Td>{r.targetLabel}</Td>
                              <Td>
                                <Confidence pct={r.confidencePct} band={r.band} />
                              </Td>
                              <Td>
                                <StatusPill tone={r.status === 'Matched' ? 'good' : r.status === 'Needs review' ? 'warn' : 'neutral'}>
                                  {r.status}
                                </StatusPill>
                              </Td>
                              <Td className="text-muted">{r.reason}</Td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </Section>
      )}

      {plan.unclassified.length > 0 && (
        <Section
          title="Not recognised"
          subtitle="These tables did not match any business entity. Nothing here is imported unless you say what it is."
        >
          <div className="space-y-3">
            {plan.unclassified.map((u) => (
              <Card key={u.tableName} variant="flat" flush className="overflow-hidden">
                <div className="p-4">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="text-base font-semibold">{u.tableName}</span>
                    <span className="text-sm tabular-nums text-muted">
                      {u.rowCount.toLocaleString()} rows
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted">{u.reason}</p>
                  {entities.length === 0 ? (
                    <p className="mt-3 text-sm text-sysorange">
                      The entity list could not be loaded, so this table cannot be identified in this
                      session. Reopen the Data Command Center to try again.
                    </p>
                  ) : (
                    <Button size="sm" className="mt-3" onClick={() => onCorrect(u.tableName)}>
                      {correcting === u.tableName ? 'Cancel' : 'Tell us what this is'}
                    </Button>
                  )}
                </div>
                {correcting === u.tableName && (
                  <EntityCorrection
                    currentEntityId={null}
                    entities={entities}
                    busy={reclassifying}
                    onApply={(entityId, why) => onApplyCorrection(u.tableName, entityId, why)}
                    onCancel={() => onCorrect(u.tableName)}
                  />
                )}
              </Card>
            ))}
          </div>
        </Section>
      )}

      {plan.warnings.length > 0 && (
        <div className="mb-6 space-y-2">
          {plan.warnings.map((w) => (
            <NoticeBlock key={w}>{w}</NoticeBlock>
          ))}
        </div>
      )}

      {!plan.nothingToImport && (
        <Card variant="flat">
          {needsReason && (
            <div className="mb-4">
              <label htmlFor="approval-reason" className="text-sm font-medium">
                Why are you approving this?
              </label>
              <p className="mb-2 mt-1 text-sm text-muted">
                A selected group touches money, payroll or master data. This note is written to the audit log
                alongside your name.
              </p>
              <Textarea
                id="approval-reason"
                rows={2}
                value={reason}
                onChange={(e) => onReason(e.target.value)}
                placeholder="e.g. Checked against the signed supplier register."
              />
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-muted">
              {readiness && readiness.ready ? readiness.summary : readiness?.blockedBecause}
              {/*
               * Outside the ready branch on purpose. Nested inside it, this
               * warning appeared only once the reviewer had typed an approval
               * reason — hidden at precisely the moment they were deciding
               * whether they still had work to do.
               */}
              {readiness && readiness.undecided > 0 && (
                <>
                  {' '}
                  <span className="text-sysorange">
                    {readiness.undecided} {readiness.undecided === 1 ? 'row is' : 'rows are'} still
                    awaiting a decision and will be skipped.
                  </span>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={onCancel}>Cancel</Button>
              <Button variant="primary" icon="check" disabled={!readiness?.ready} onClick={onImport}>
                Import
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

// ── result ─────────────────────────────────────────────────────────────────

function ResultStep({ result, onAgain }: { result: ResultModel; onAgain: () => void }): JSX.Element {
  return (
    <div className="mt-5">
      <Card variant="flat">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <StatusPill tone={result.tone}>{result.statusLabel}</StatusPill>
            </div>
            <p className="mt-2 text-base">{result.summary}</p>
          </div>
          <Button icon="upload" onClick={onAgain}>
            Import another file
          </Button>
        </div>
      </Card>

      <div className="mt-4">
        <DataTable
          head={
            <tr>
              <Th>Group</Th>
              <Th>Result</Th>
              <Th>Imported</Th>
              <Th>Note</Th>
            </tr>
          }
        >
          {result.tables.map((t) => (
            <tr key={t.tableName}>
              <Td className="font-medium">{t.tableName}</Td>
              <Td>
                <StatusPill tone={t.tone}>{t.statusLabel}</StatusPill>
              </Td>
              <Td className="tabular-nums">{t.imported.toLocaleString()}</Td>
              <Td className="text-muted">
                {t.rolledBack && <span className="mr-2 font-medium text-syspink">Rolled back.</span>}
                {t.note}
              </Td>
            </tr>
          ))}
        </DataTable>
      </div>

      {result.errors.length > 0 && (
        <div className="mt-6">
          <Section title="Rows that could not be imported" subtitle="Fix these in the source and import again.">
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
