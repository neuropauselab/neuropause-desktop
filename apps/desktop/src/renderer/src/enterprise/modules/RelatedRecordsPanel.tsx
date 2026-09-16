/**
 * Everything connected to this record, across domains.
 *
 * Open a customer and this is Customer 360 — orders, invoices, payments,
 * tickets, contracts, opportunities — but it is not customer-specific code.
 * It walks the same declared links from whatever record you are looking at,
 * which is why opening a purchase order gives you the supplier, the receipt,
 * the bill and the RFQ that awarded it, for free.
 *
 * What the design has to get right:
 *
 *  - **An empty list must not read as "nothing is connected"** when the real
 *    reason is a permission or a stopped engine. Those are three different
 *    sentences and the panel says which one it is.
 *  - **Every row is checkable.** Expanding a record shows the field, the
 *    literal value it carried, and how that value was matched — because a
 *    relationship you cannot verify is one you have to take on trust.
 *  - **A deleted far end is shown, not hidden.** A link pointing at nothing is
 *    information; quietly dropping it makes the record look tidier than it is.
 */
import { useCallback, useEffect, useState } from 'react';
import type { RelatedRecord, RelatedRecordsView } from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { createLogger } from '@renderer/lib/logger';
import { Button } from '@renderer/components/ui/Button';
import { Icon } from '@renderer/components/ui/Icon';
import { NoticeBlock } from '@renderer/dataCommandCenter/primitives';
import { SkeletonCards, SkeletonRegion } from '@renderer/components/ui/Skeleton';
import { CSS_TRANSITION } from '@renderer/lib/motion';
import { cn } from '@renderer/lib/cn';
import { isDeniedError } from '@renderer/lib/ipcError';

const log = createLogger('related-records');

/** How much to trust the match, in one word, from the method that made it. */
const METHOD_LABEL: Record<string, string> = {
  internal_id: 'Exact — record id',
  business_key: 'Exact — business key',
  normalized_key: 'Exact, ignoring case and spacing',
  canonical_name: 'Name proposal, accepted by a person',
  manual: 'Matched by a person',
};

export function RelatedRecordsPanel({
  recordId,
  moduleId,
  /** Bumped by the parent when the record changes, so this re-reads. */
  revision,
  onOpenRecord,
}: {
  recordId: string;
  moduleId: string;
  revision: string;
  onOpenRecord?: (moduleId: string, recordId: string) => void;
}): JSX.Element {
  const [view, setView] = useState<RelatedRecordsView | null>(null);
  const [settled, setSettled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [depth, setDepth] = useState(2);

  const load = useCallback(
    async (wanted: number): Promise<void> => {
      setBusy(true);
      setError(null);
      setDenied(false);
      try {
        setView(await ipc.crossDomain.related(recordId, moduleId, wanted));
      } catch (err) {
        const message = String(err);
        log.warn('Related records unavailable', { message });
        setView(null);
        // A refusal and a fault are different answers, and telling someone
        // "you lack permission" when the truth was a crash is a confident
        // false claim about their account.
        // D-6: `isDeniedError` reads the machine code when present and falls
        // back to the same prose test only when the rejection carries none.
        if (isDeniedError(err)) setDenied(true);
        else setError('Related records could not be loaded. This is a fault, not an empty result.');
      } finally {
        setBusy(false);
        setSettled(true);
      }
    },
    [recordId, moduleId],
  );

  useEffect(() => {
    void load(depth);
  }, [load, depth, revision]);

  if (!settled) {
    return (
      <SkeletonRegion label="Finding connected records">
        <SkeletonCards count={1} lines={2} />
      </SkeletonRegion>
    );
  }

  return (
    <section className="mt-5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          Related records
          {view && view.total > 0 && <span className="ml-1.5 text-faint">{view.total}</span>}
        </h3>
        <div className="flex items-center gap-2">
          {/*
            Depth is the user's choice and its cost is stated. Defaulting to
            three and hoping nobody notices the traversal is how a detail page
            becomes slow for reasons nobody can see.
          */}
          <Button
            size="sm"
            onClick={() => setDepth(depth === 1 ? 2 : depth === 2 ? 3 : 1)}
            disabled={busy}
          >
            {depth === 1 ? 'Direct links only' : `${depth} steps out`}
          </Button>
          <Button size="sm" icon="refresh" onClick={() => void load(depth)} loading={busy}>
            Refresh
          </Button>
        </div>
      </div>

      {denied && (
        <NoticeBlock icon="shield">
          You do not have permission to read this record’s module, so its connections cannot be
          shown.
        </NoticeBlock>
      )}
      {error && <NoticeBlock icon="info">{error}</NoticeBlock>}

      {view && !denied && !error && (
        <>
          {view.root === null && view.total === 0 ? (
            <NoticeBlock icon="info">
              This record’s module is not available, so its connections cannot be looked up. This
              is not a statement that nothing is connected.
            </NoticeBlock>
          ) : view.total === 0 && !view.hiddenByPermission ? (
            // Only when nothing was filtered. Otherwise this sentence and the
            // "view is partial" notice below both render, and the product
            // simultaneously claims nothing is hidden and that something is.
            <NoticeBlock icon="info">
              Nothing links to this record{depth < 3 ? ' within ' + depth + ' step' + (depth === 1 ? '' : 's') : ''}.
              No related records exist — nothing is being hidden from you.
            </NoticeBlock>
          ) : view.total === 0 ? null : (
            <div className="space-y-3">
              {view.groups.map((group) => (
                <div
                  key={group.moduleId}
                  className="rounded-xl border border-[var(--hairline)] px-3.5 py-3"
                >
                  <div className="mb-1.5 flex items-baseline justify-between gap-2">
                    <div className="text-sm font-medium">{group.moduleTitle}</div>
                    <div className="text-xs text-faint">
                      {group.records.length} record{group.records.length === 1 ? '' : 's'}
                    </div>
                  </div>
                  <ul className="space-y-1">
                    {group.records.map((record) => (
                      <RelatedRow
                        key={record.recordId}
                        record={record}
                        expanded={expanded === record.recordId}
                        onToggle={() =>
                          setExpanded(expanded === record.recordId ? null : record.recordId)
                        }
                        {...(onOpenRecord ? { onOpen: onOpenRecord } : {})}
                      />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {/*
            Said whenever it applies, including alongside results. A filtered
            list that looks complete is worse than an empty one, because the
            reader has no reason to doubt it. Deliberately names no module and
            no count — that would disclose the thing the permission protects.
          */}
          {view.hiddenByPermission && (
            <div className="mt-3">
              <NoticeBlock icon="shield">
                Some connected records are not shown, because this account cannot read the modules
                they belong to. This view is partial. Your access is listed in Administration.
              </NoticeBlock>
            </div>
          )}
          {view.truncated && (
            <div className="mt-3">
              <NoticeBlock icon="info">
                There are more connected records than can be shown at once. Reduce the depth to see
                the closest ones.
              </NoticeBlock>
            </div>
          )}
          {view.brokenLinks > 0 && (
            <p className="mt-2 text-xs text-faint">
              {view.brokenLinks} link{view.brokenLinks === 1 ? '' : 's'} point at records that no
              longer exist. They are listed rather than hidden.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function RelatedRow({
  record,
  expanded,
  onToggle,
  onOpen,
}: {
  record: RelatedRecord;
  expanded: boolean;
  onToggle: () => void;
  onOpen?: (moduleId: string, recordId: string) => void;
}): JSX.Element {
  return (
    <li>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggle}
          className={cn(
            'flex-1 rounded-lg px-2 py-1 text-left text-sm hover:bg-[var(--hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sysblue/50',
            CSS_TRANSITION.colors,
          )}
          aria-expanded={expanded}
        >
          <span className={record.deleted ? 'text-faint line-through' : ''}>{record.title}</span>
          {record.hops > 1 && (
            <span className="ml-1.5 text-[11px] text-faint">{record.hops} steps away</span>
          )}
        </button>
        {onOpen && !record.deleted && (
          <Button size="sm" icon="launch" onClick={() => onOpen(record.moduleId, record.recordId)}>
            Open
          </Button>
        )}
      </div>

      {expanded && (
        <div className="mt-1 space-y-1.5 rounded-lg border border-[var(--hairline)] px-3 py-2">
          <div className="text-xs uppercase tracking-wider text-faint">Why these are connected</div>
          {record.path.map((hop, i) => (
            <div key={`${hop.relationshipKey}-${i}`} className="text-sm">
              <div className="flex flex-wrap items-center gap-1.5 text-muted">
                <span className="font-medium text-[var(--text)]">{hop.fromTitle}</span>
                <Icon name={hop.direction === 'out' ? 'launch' : 'download'} size={10} />
                <span className="rounded-md border border-[var(--hairline)] px-1.5 py-0.5 text-[11px]">
                  {hop.label}
                </span>
                <span className="font-medium text-[var(--text)]">{hop.toTitle}</span>
              </div>
              <p className="mt-0.5 leading-relaxed text-muted">{hop.why}</p>
              <p className="text-[11px] text-faint">
                {METHOD_LABEL[hop.method] ?? hop.method} · confidence{' '}
                {Math.round(hop.confidence * 100)}%
              </p>
            </div>
          ))}
        </div>
      )}
    </li>
  );
}
