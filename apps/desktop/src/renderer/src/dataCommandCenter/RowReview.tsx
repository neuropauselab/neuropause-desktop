/**
 * The two review surfaces Program 7 left on the wire but never rendered:
 * correcting what a file IS, and deciding what happens to each row.
 *
 * Both are deliberately unglamorous. The reviewer is about to write to a
 * business system, so every control states its consequence, and the engine's
 * refusals are shown as refusals rather than quietly omitted:
 *   - `EntityCorrection` requires a written reason. The correction is audited
 *     under the reviewer's name, and an audit line reading "because" is worse
 *     than no audit line.
 *   - `RowReview` never pre-selects an answer for a row the engine declined to
 *     guess. An unanswered row is skipped, and the count of them is on screen
 *     next to the import button rather than discovered afterwards.
 *   - A row that failed validation offers no actions at all.
 */
import { useEffect, useRef, useState } from 'react';
import type { DataPlaneOntologyEntity } from '@neuropause/shared';
import { cn } from '@renderer/lib/cn';
import { Button } from '@renderer/components/ui/Button';
import { Icon } from '@renderer/components/ui/Icon';
import { Input, Select, Textarea } from '@renderer/components/ui/Input';
import { Spinner } from '@renderer/components/Spinner';
import {
  PREVIEW_FILTERS,
  applyDecisions,
  type PreviewFilter,
  type PreviewModel,
  type PreviewRowModel,
  type RowDecision,
} from './dataCommandCenterModel';
import { ErrorBlock, NoticeBlock, StatusPill } from './primitives';

/* ── entity correction ─────────────────────────────────────────────────── */

export function EntityCorrection({
  currentEntityId,
  entities,
  busy,
  onApply,
  onCancel,
}: {
  currentEntityId: string | null;
  entities: readonly DataPlaneOntologyEntity[];
  busy: boolean;
  onApply: (entityId: string, reason: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const [entityId, setEntityId] = useState('');
  const [reason, setReason] = useState('');
  const trimmed = reason.trim();
  const chosen = entities.find((e) => e.id === entityId) ?? null;

  const problem =
    entityId === ''
      ? 'Choose what this table actually contains.'
      : trimmed.length < 4
        ? 'Say why. This is written to the audit log under your name.'
        : null;

  return (
    <div className="border-t border-[var(--hairline)] p-4">
      <h4 className="text-sm font-semibold">Correct what this table is</h4>
      <p className="mt-1 text-sm text-muted">
        Everything is recomputed from the original file — column mapping, validation, duplicates and the
        match against existing records. Nothing from the previous reading is carried over.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="correct-entity" className="text-sm font-medium">
            This table contains
          </label>
          <Select
            id="correct-entity"
            className="mt-1.5"
            placeholder="Choose…"
            value={entityId}
            disabled={busy}
            onChange={(e) => setEntityId(e.target.value)}
            options={entities
              .filter((e) => e.id !== currentEntityId)
              .map((e) => ({ value: e.id, label: `${e.plural} · ${titleCase(e.domain)}` }))}
          />
          {chosen && (
            <p className="mt-1.5 text-xs text-faint">
              {chosen.risk === 'high'
                ? 'High risk — this will always need explicit approval.'
                : 'Every corrected table needs explicit approval before it is written.'}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="correct-reason" className="text-sm font-medium">
            Why
          </label>
          <Textarea
            id="correct-reason"
            className="mt-1.5"
            rows={2}
            value={reason}
            disabled={busy}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. These are staff records exported from the payroll system."
          />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          variant="primary"
          icon="check"
          loading={busy}
          disabled={problem !== null}
          onClick={() => onApply(entityId, trimmed)}
        >
          Re-analyze as this
        </Button>
        <Button size="sm" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        {problem && <span className="text-sm text-muted">{problem}</span>}
      </div>
    </div>
  );
}

/* ── row review ────────────────────────────────────────────────────────── */

export interface RowReviewState {
  filter: PreviewFilter;
  search: string;
  offset: number;
}

export const INITIAL_ROW_REVIEW: RowReviewState = { filter: 'all', search: '', offset: 0 };

export function RowReview({
  preview,
  state,
  onState,
  loading,
  error,
  decisions,
  pageSize,
  onDecide,
  onClearDecisions,
}: {
  preview: PreviewModel | null;
  state: RowReviewState;
  onState: (next: RowReviewState) => void;
  loading: boolean;
  error: string | null;
  decisions: Record<number, RowDecision> | undefined;
  pageSize: number;
  onDecide: (row: PreviewRowModel, action: 'create' | 'update' | 'skip') => void;
  onClearDecisions: () => void;
}): JSX.Element {
  // Local so typing is not a round-trip per keystroke; pushed up on a pause.
  const [draft, setDraft] = useState(state.search);
  const onStateRef = useRef(onState);
  onStateRef.current = onState;
  /**
   * The last value this component pushed upward.
   *
   * Without it, a search reset from OUTSIDE (a parent putting the row state
   * back to its initial value) is indistinguishable from a value this
   * component is mid-way through debouncing — so the stale draft gets pushed
   * back 250 ms later and quietly undoes the reset.
   */
  const pushed = useRef(state.search);

  useEffect(() => {
    if (draft === state.search) return;
    // Adopt an external reset rather than fighting it.
    if (state.search !== pushed.current) {
      setDraft(state.search);
      pushed.current = state.search;
      return;
    }
    const id = setTimeout(() => {
      pushed.current = draft;
      onStateRef.current({ ...state, search: draft, offset: 0 });
    }, 250);
    return () => clearTimeout(id);
  }, [draft, state]);

  const decidedCount = Object.keys(decisions ?? {}).length;
  const effective =
    preview === null
      ? { create: 0, update: 0, skip: 0, review: 0 }
      : applyDecisions(preview.plan, decisions, preview.defaults);

  if (error !== null) {
    return (
      <div className="border-t border-[var(--hairline)] p-4">
        <ErrorBlock title="The rows could not be shown" detail={error} />
      </div>
    );
  }

  return (
    <div className="border-t border-[var(--hairline)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--hairline)] p-3">
        {PREVIEW_FILTERS.map((f) => {
          const n = preview?.counts[f.id];
          const active = state.filter === f.id;
          return (
            <button
              key={f.id}
              type="button"
              aria-pressed={active}
              disabled={n === 0 && !active}
              onClick={() => {
                // Re-selecting the active chip would refetch, and a refetch
                // re-scans the whole destination module. Nothing changed, so
                // nothing is asked for.
                if (active) return;
                onState({ ...state, filter: f.id, offset: 0 });
              }}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium transition disabled:opacity-35',
                active ? 'bg-accent/15 text-accent' : '[background:var(--fill-2)] text-muted',
              )}
            >
              {f.label}
              {n !== undefined && <span className="ml-1.5 tabular-nums opacity-70">{n}</span>}
            </button>
          );
        })}
        <div className="ml-auto flex items-center gap-2">
          {decidedCount > 0 && (
            <Button size="sm" variant="ghost" onClick={onClearDecisions}>
              Reset {decidedCount} {decidedCount === 1 ? 'choice' : 'choices'}
            </Button>
          )}
          <Input
            className="h-8 w-52"
            placeholder="Search these rows"
            aria-label="Search rows"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </div>
      </div>

      {loading && preview === null ? (
        <div className="flex items-center gap-3 p-5 text-sm text-muted">
          <Spinner size={16} /> Reading rows…
        </div>
      ) : preview === null ? (
        <div className="p-5 text-sm text-muted">No rows to show.</div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-xs text-faint">
            <span className="tabular-nums">{preview.rangeLabel}</span>
            <span aria-hidden>·</span>
            {/*
             * The engine's plan WITH the reviewer's answers folded in. Showing
             * the raw plan here left three numbers on one screen disagreeing:
             * this line still counted answered rows as awaiting a decision
             * while the card above and the button below had both moved on.
             */}
            <span>
              Across the whole group: {effective.create} new, {effective.update} updates,{' '}
              {effective.skip} skipped, {effective.review} awaiting a decision
            </span>
            {loading && <Spinner size={12} />}
          </div>

          {preview.rows.length === 0 ? (
            <div className="p-5 text-sm text-muted">
              No rows match this filter{state.search.trim() !== '' ? ' and search' : ''}.
            </div>
          ) : (
            <ul className="divide-y divide-[var(--hairline)]">
              {preview.rows.map((row) => (
                <RowCard
                  key={row.rowIndex}
                  row={row}
                  decision={decisions?.[row.rowIndex]}
                  onDecide={(action) => onDecide(row, action)}
                />
              ))}
            </ul>
          )}

          {(preview.hasPrev || preview.hasNext) && (
            <div className="flex items-center justify-between gap-3 border-t border-[var(--hairline)] p-3">
              <Button
                size="sm"
                icon="chevron-left"
                disabled={!preview.hasPrev || loading}
                onClick={() => onState({ ...state, offset: Math.max(0, state.offset - pageSize) })}
              >
                Previous
              </Button>
              <span className="text-xs tabular-nums text-faint">{preview.rangeLabel}</span>
              <Button
                size="sm"
                icon="chevron-right"
                disabled={!preview.hasNext || loading}
                onClick={() => onState({ ...state, offset: state.offset + pageSize })}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function RowCard({
  row,
  decision,
  onDecide,
}: {
  row: PreviewRowModel;
  decision: RowDecision | undefined;
  onDecide: (action: 'create' | 'update' | 'skip') => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  // A row the engine declined to guess for has NO selection until a person
  // makes one. Showing `defaultAction` highlighted would be presenting a
  // refusal as an answer.
  const selected = decision?.action ?? (row.needsDecision ? null : row.defaultAction);

  return (
    <li className="p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-xs tabular-nums text-faint">Row {row.sourceRow}</span>
        <span className="font-medium">{row.title}</span>
        <StatusPill tone={row.verdictTone}>{row.verdictLabel}</StatusPill>
        {row.needsDecision && decision === undefined && <StatusPill tone="warn">Needs a decision</StatusPill>}
        {decision !== undefined && <StatusPill tone="neutral">You chose: {decision.action}</StatusPill>}
        <button
          type="button"
          className="ml-auto text-xs text-muted underline-offset-2 hover:underline"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Hide values' : 'Show values'}
        </button>
      </div>

      {row.existing !== null && (
        <p className="mt-2 text-sm text-muted">
          <Icon name="layers" size={12} className="mr-1.5 inline text-faint" />
          {row.existing.certain ? 'Matches' : 'Looks like'}{' '}
          <span className="font-medium text-ink">{row.existing.title}</span> — {row.existing.basis}.
          {!row.existing.certain && ' They match only after normalising, so this needs a person.'}
        </p>
      )}

      {row.repeatOfRow !== null && (
        <p className="mt-2 text-sm text-sysorange">
          Repeats row {row.repeatOfRow} of this same file.
        </p>
      )}

      {row.unimportableReason !== null && (
        <p className="mt-2 text-sm text-syspink">{row.unimportableReason}</p>
      )}

      {open && (
        <div className="mt-3 space-y-3">
          <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
            {row.fields.map((f) => (
              <div key={f.key} className="flex items-baseline justify-between gap-3 border-b border-[var(--hairline)] pb-1">
                <dt className="shrink-0 text-muted">{f.label}</dt>
                <dd className={cn('min-w-0 break-words text-right', f.redacted && 'text-faint')}>
                  {f.redacted ? (
                    <span title="This field is marked sensitive, so its value is never sent to the screen">
                      {f.value} <span className="text-2xs uppercase tracking-wider">hidden</span>
                    </span>
                  ) : (
                    (f.value || <span className="text-faint">empty</span>)
                  )}
                </dd>
              </div>
            ))}
          </dl>

          {row.issues.length > 0 && (
            <ul className="space-y-1 text-sm text-sysorange">
              {row.issues.map((i, n) => (
                <li key={`${i.field}-${n}`}>{i.message}</li>
              ))}
            </ul>
          )}

          {row.transformations.length > 0 && (
            <div className="text-xs text-faint">
              <span className="font-medium">Adjusted on the way in: </span>
              {row.transformations.join(' · ')}
            </div>
          )}

          {row.existing !== null && row.existing.differs.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-medium uppercase tracking-wider text-faint">
                What updating would change
              </div>
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wider text-faint">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Field</th>
                    <th className="py-1 pr-3 font-medium">Now</th>
                    <th className="py-1 font-medium">After</th>
                  </tr>
                </thead>
                <tbody>
                  {row.existing.differs.map((d) => (
                    <tr key={d.field} className="border-t border-[var(--hairline)]">
                      <td className="py-1 pr-3 text-muted">{d.label}</td>
                      <td className="py-1 pr-3 line-through decoration-faint">{d.existing || '—'}</td>
                      <td className="py-1 font-medium">{d.incoming || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {row.existing !== null && row.existing.differs.length === 0 && (
            <NoticeBlock>
              No mapped value differs from the record already stored, so updating would change nothing
              visible.
            </NoticeBlock>
          )}
        </div>
      )}

      {row.choices.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {row.choices.map((c) => (
            <button
              key={c.action}
              type="button"
              title={c.detail}
              aria-pressed={selected === c.action}
              onClick={() => onDecide(c.action)}
              className={cn(
                'rounded-lg border px-2.5 py-1 text-xs font-medium transition',
                selected === c.action
                  ? 'border-accent/40 bg-accent/12 text-accent'
                  : 'border-[var(--hairline)] text-muted hover:text-ink',
              )}
            >
              {c.label}
            </button>
          ))}
          <span className="text-xs text-faint">
            {row.choices.find((c) => c.action === selected)?.detail ?? 'Choose what happens to this row.'}
          </span>
        </div>
      )}
    </li>
  );
}

function titleCase(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}
