/**
 * Line items and approval for one business document.
 *
 * This panel is the reason four engines are no longer dead code. The line
 * store, the totals derivation, the approval policy engine with its four
 * segregation-of-duties rules, and the posting rules that need costed lines
 * (GRNI, COGS, material issue, production completion) were all registered and
 * all unreachable — there was no way for a person to enter a line, so every
 * derived total was 0 and every one of those rules refused for want of input.
 *
 * Two rules shape what is shown:
 *
 *  - **Totals are never editable.** They are derived from the lines on every
 *    read. A total you can type is a total that can disagree with its own
 *    arithmetic, and in an accounting document that is not a display bug.
 *  - **A refusal explains itself.** "Approve" disabled with no reason reads as
 *    broken; disabled with "you raised this request" reads as governance. The
 *    engine's own words are shown verbatim rather than paraphrased.
 */
import { useCallback, useEffect, useState } from 'react';
import type {
  DocumentApprovalView,
  DocumentLineInput,
  DocumentLinesView,
} from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { createLogger } from '@renderer/lib/logger';
import { Button } from '@renderer/components/ui/Button';
import { Icon } from '@renderer/components/ui/Icon';
import { NoticeBlock } from '@renderer/dataCommandCenter/primitives';
import { SkeletonCards, SkeletonRegion } from '@renderer/components/ui/Skeleton';
import { AFFORDANCE, CSS_TRANSITION } from '@renderer/lib/motion';
import { cn } from '@renderer/lib/cn';

const log = createLogger('erp-document');

/** An editable row. Strings, because a half-typed number is not a number. */
interface DraftLine {
  productId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  taxRatePercent: string;
}

const EMPTY_DRAFT: DraftLine = {
  productId: '',
  description: '',
  quantity: '1',
  unitPrice: '0',
  discountPercent: '',
  taxRatePercent: '',
};

function toDraft(line: DocumentLinesView['lines'][number]): DraftLine {
  return {
    productId: line.productId ?? '',
    description: line.description,
    quantity: String(line.quantity),
    unitPrice: String(line.unitPrice),
    discountPercent: line.discountPercent === null ? '' : String(line.discountPercent),
    taxRatePercent: line.taxRatePercent === null ? '' : String(line.taxRatePercent),
  };
}

/** Blank means "not set", which is different from zero. */
function optionalNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function toInput(draft: DraftLine): DocumentLineInput {
  return {
    // Some document types (purchase orders, receipts) REQUIRE a product; the
    // engine refuses the line without one, so the field has to be enterable.
    productId: draft.productId.trim() || null,
    description: draft.description.trim(),
    quantity: Number(draft.quantity) || 0,
    unitPrice: Number(draft.unitPrice) || 0,
    discountPercent: optionalNumber(draft.discountPercent),
    taxRatePercent: optionalNumber(draft.taxRatePercent),
  };
}

function money(value: number, currency: string): string {
  return `${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

export function DocumentPanel({
  moduleId,
  recordId,
  onChanged,
}: {
  moduleId: string;
  recordId: string;
  /** The record's value changed — the list behind this panel is now stale. */
  onChanged: () => void;
}): JSX.Element | null {
  const [view, setView] = useState<DocumentLinesView | null>(null);
  const [approval, setApproval] = useState<DocumentApprovalView | null>(null);
  const [drafts, setDrafts] = useState<DraftLine[] | null>(null);
  const [errors, setErrors] = useState<{ lineNo: number; errors: string[] }[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    const [lines, appr] = await Promise.allSettled([
      ipc.enterpriseModules.lines(moduleId, recordId),
      ipc.enterpriseModules.approval(moduleId, recordId),
    ]);
    if (lines.status === 'fulfilled') setView(lines.value);
    if (appr.status === 'fulfilled') setApproval(appr.value);
    if (lines.status === 'rejected') {
      log.warn('Document lines unavailable', { message: String(lines.reason) });
      setView({ supported: false, documentType: null, editPermission: null, lines: [], totals: null });
    }
  }, [moduleId, recordId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Not a line-item document (most of the 106 modules are master data). Render
  // nothing rather than an empty editor that implies lines are expected.
  if (view && !view.supported && !approval?.required) return null;
  if (!view) {
    return (
      <SkeletonRegion label="Loading document lines">
        <SkeletonCards count={1} lines={2} />
      </SkeletonRegion>
    );
  }

  const editing = drafts !== null;
  const currency = view.totals?.currency ?? 'INR';

  const save = async (): Promise<void> => {
    if (!drafts) return;
    setBusy(true);
    setErrors([]);
    setMessage(null);
    try {
      const result = await ipc.enterpriseModules.setLines(moduleId, recordId, drafts.map(toInput));
      if (!result.ok) {
        setErrors(result.errors);
        return;
      }
      setView(result.view);
      setDrafts(null);
      // Totals feed the approval threshold, so the policy may now resolve
      // differently — re-read rather than assume it did not.
      void reload();
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const decide = async (stepId: string, decision: 'approved' | 'rejected'): Promise<void> => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await ipc.enterpriseModules.approve(moduleId, recordId, stepId, decision);
      setApproval(result.approval);
      // A refusal here is the SoD engine doing its job. Show its reason.
      if (!result.ok) setMessage(result.error);
      else onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-5 space-y-4">
      {view.supported && (
        <section>
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">
              Line items
              {view.lines.length > 0 && <span className="ml-1.5 text-faint">{view.lines.length}</span>}
            </h3>
            {editing ? (
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setDrafts(null)} disabled={busy}>
                  Cancel
                </Button>
                <Button size="sm" variant="primary" onClick={() => void save()} loading={busy}>
                  Save lines
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                icon="plus"
                onClick={() => setDrafts(view.lines.length ? view.lines.map(toDraft) : [{ ...EMPTY_DRAFT }])}
              >
                {view.lines.length ? 'Edit lines' : 'Add lines'}
              </Button>
            )}
          </div>

          {view.totals?.currencyMismatch && (
            <div className="mb-2">
              <NoticeBlock icon="info">
                These lines are in more than one currency. A document must be single-currency, so the
                total below cannot be trusted until that is corrected.
              </NoticeBlock>
            </div>
          )}

          {errors.length > 0 && (
            <div className="mb-2">
              <NoticeBlock icon="info">
                {errors.map((e) => `Line ${e.lineNo}: ${e.errors.join(' ')}`).join(' · ')}
              </NoticeBlock>
            </div>
          )}

          <div className="overflow-hidden rounded-xl border border-[var(--hairline)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--hairline)] text-xs uppercase tracking-wider text-faint">
                  <th className="w-28 px-3 py-2 text-left font-medium">Product</th>
                  <th className="px-3 py-2 text-left font-medium">Description</th>
                  <th className="w-20 px-3 py-2 text-right font-medium">Qty</th>
                  <th className="w-28 px-3 py-2 text-right font-medium">Unit price</th>
                  <th className="w-20 px-3 py-2 text-right font-medium">Disc %</th>
                  <th className="w-20 px-3 py-2 text-right font-medium">Tax %</th>
                  <th className="w-32 px-3 py-2 text-right font-medium">Total</th>
                  {editing && <th className="w-10 px-2 py-2" />}
                </tr>
              </thead>
              <tbody>
                {editing
                  ? drafts.map((draft, i) => (
                      <tr key={i} className="border-b border-[var(--hairline)] last:border-0">
                        {(
                          [
                            ['productId', 'text-left'],
                            ['description', 'text-left'],
                            ['quantity', 'text-right'],
                            ['unitPrice', 'text-right'],
                            ['discountPercent', 'text-right'],
                            ['taxRatePercent', 'text-right'],
                          ] as const
                        ).map(([key, align]) => (
                          <td key={key} className="px-1.5 py-1">
                            <input
                              value={draft[key]}
                              onChange={(e) =>
                                setDrafts((list) =>
                                  (list ?? []).map((d, j) =>
                                    j === i ? { ...d, [key]: e.target.value } : d,
                                  ),
                                )
                              }
                              aria-label={`Line ${i + 1} ${key}`}
                              className={cn(
                                'h-8 w-full rounded-md border border-transparent bg-transparent px-2 text-sm outline-none focus-visible:shadow-focus focus:border-accent/60',
                                align,
                              )}
                            />
                          </td>
                        ))}
                        {/* Derived, so there is nothing to type here. */}
                        <td className="px-3 py-1 text-right text-faint">—</td>
                        <td className="px-1 py-1">
                          <button
                            type="button"
                            aria-label={`Remove line ${i + 1}`}
                            onClick={() => setDrafts((list) => (list ?? []).filter((_, j) => j !== i))}
                            className={cn(
                              'rounded-md p-1 text-faint outline-none hover:text-syspink focus-visible:shadow-focus',
                              CSS_TRANSITION.colors,
                              AFFORDANCE.clickable,
                            )}
                          >
                            <Icon name="close" size={13} />
                          </button>
                        </td>
                      </tr>
                    ))
                  : view.lines.map((line) => (
                      <tr key={line.id} className="border-b border-[var(--hairline)] last:border-0">
                        <td className="px-3 py-2 text-faint">{line.productId ?? '—'}</td>
                        <td className="px-3 py-2">{line.description || '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{line.quantity}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{line.unitPrice}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {line.discountPercent ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {line.taxRatePercent ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-right font-medium tabular-nums">
                          {money(line.total, line.currency)}
                        </td>
                      </tr>
                    ))}
                {!editing && view.lines.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-4 text-center text-sm text-faint">
                      No lines yet. Totals stay at zero until lines are entered — and the accounting
                      rules that need costed lines cannot post without them.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {editing && (
            <Button
              size="sm"
              icon="plus"
              className="mt-2"
              onClick={() => setDrafts((list) => [...(list ?? []), { ...EMPTY_DRAFT }])}
            >
              Add line
            </Button>
          )}

          {view.totals && view.totals.lineCount > 0 && (
            <div className="mt-2.5 flex justify-end">
              <dl className="w-56 space-y-1 text-sm">
                <Row label="Net" value={money(view.totals.taxable, currency)} />
                <Row label="Tax" value={money(view.totals.tax, currency)} />
                <div className="border-t border-[var(--hairline)] pt-1">
                  <Row label="Total" value={money(view.totals.total, currency)} strong />
                </div>
              </dl>
            </div>
          )}
        </section>
      )}

      {approval?.required && (
        <section className="rounded-xl border border-[var(--hairline)] px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Approval</h3>
            <span
              className={cn(
                'rounded-full border px-2 py-0.5 text-[11px] font-medium',
                approval.state === 'approved'
                  ? 'border-sysgreen/40 text-sysgreen'
                  : approval.state === 'rejected'
                    ? 'border-syspink/40 text-syspink'
                    : 'border-sysorange/40 text-sysorange',
              )}
            >
              {approval.state === 'approved'
                ? 'Approved'
                : approval.state === 'rejected'
                  ? 'Rejected'
                  : approval.state === 'blocked'
                    ? 'Blocked'
                    : 'Awaiting approval'}
            </span>
          </div>

          <p className="mt-1 text-xs text-faint">
            Evaluated on {money(approval.amount, currency)}
            {approval.gatedStatuses.length > 0 &&
              ` · required before: ${approval.gatedStatuses.join(', ')}`}
          </p>

          <ol className="mt-2.5 space-y-1.5">
            {approval.requiredSteps.map((step) => {
              const done = approval.satisfiedStepIds.includes(step.id);
              const isNext = approval.nextStep?.id === step.id;
              return (
                <li key={step.id} className="flex items-center gap-2 text-sm">
                  <Icon
                    name={done ? 'check' : 'dot'}
                    size={13}
                    className={done ? 'text-sysgreen' : 'text-faint'}
                  />
                  <span className={done ? 'text-muted' : ''}>{step.label}</span>
                  <span className="text-xs text-faint">({step.roles.join(', ')})</span>
                  {isNext && approval.canDecide && (
                    <span className="ml-auto flex gap-1.5">
                      <Button size="sm" onClick={() => void decide(step.id, 'rejected')} disabled={busy}>
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => void decide(step.id, 'approved')}
                        disabled={busy}
                      >
                        Approve
                      </Button>
                    </span>
                  )}
                </li>
              );
            })}
          </ol>

          {/* The engine's own refusal, verbatim. A disabled button with no
              stated reason reads as a defect rather than as governance. */}
          {approval.nextStep && !approval.canDecide && approval.blockedReason && (
            <p className="mt-2.5 text-xs text-sysorange">{approval.blockedReason}</p>
          )}
          {message && <p className="mt-2 text-xs text-syspink">{message}</p>}

          {approval.decisions.length > 0 && (
            <div className="mt-3 border-t border-[var(--hairline)] pt-2">
              <div className="text-xs uppercase tracking-wider text-faint">Decisions</div>
              <ul className="mt-1 space-y-0.5">
                {approval.decisions.map((d, i) => (
                  <li key={i} className="text-xs text-muted">
                    {d.userId} {d.decision} {d.stepId} · {new Date(d.at).toLocaleString()}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className={cn('tabular-nums', strong && 'font-semibold')}>{value}</dd>
    </div>
  );
}
