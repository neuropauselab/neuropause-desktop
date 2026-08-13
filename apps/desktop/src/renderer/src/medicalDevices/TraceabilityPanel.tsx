/**
 * Medical Devices → Traceability.
 *
 * Two questions, asked of the same graph: where did this go, and what went into
 * it. Every line rendered here is a RECORD of something that happened; nothing
 * on this screen is inferred from a name that looks similar, and the scope note
 * under each answer says exactly what was searched — because an empty trace
 * because nothing was recorded and an empty trace because the material went
 * nowhere are different answers, and confusing them is dangerous.
 */
import { useCallback, useEffect, useState } from 'react';
import type { DeviceTraceView, TraceNodeType } from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { Button } from '@renderer/components/ui/Button';
import { Card } from '@renderer/components/ui/Card';
import { Input } from '@renderer/components/ui/Input';
import { Loading } from '@renderer/components/ui/Loading';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { Icon } from '@renderer/components/ui/Icon';
import { SegmentedTabs, type SegmentedTabItem } from '@renderer/components/ui/pillTabs';
import { ErrorBlock, NoticeBlock, Section } from '@renderer/dataCommandCenter/primitives';
import { friendlyError, nodeLabel, traceRows } from './medicalDevicesModel';

export interface TraceTarget {
  type: TraceNodeType;
  id: string;
  label: string;
}

interface Props {
  /** Set when the panel was opened from a lot or product. */
  target: TraceTarget | null;
  onTargetChange: (target: TraceTarget | null) => void;
}

type Direction = 'forward' | 'backward';

const NODE_TYPES: TraceNodeType[] = [
  'lot',
  'product',
  'manufacturing_order',
  'warehouse',
  'shipment',
  'customer',
  'order',
  'supplier',
];

const DIRECTION_TABS: SegmentedTabItem<Direction>[] = [
  { id: 'forward', label: 'Where did this go?', icon: 'download' },
  { id: 'backward', label: 'What went into this?', icon: 'upload' },
];

export function TraceabilityPanel({ target, onTargetChange }: Props): JSX.Element {
  const [direction, setDirection] = useState<Direction>('forward');
  const [type, setType] = useState<TraceNodeType>(target?.type ?? 'lot');
  const [id, setId] = useState(target?.id ?? '');
  const [view, setView] = useState<DeviceTraceView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ title: string; detail: string } | null>(null);

  useEffect(() => {
    if (!target) return;
    setType(target.type);
    setId(target.id);
  }, [target]);

  const run = useCallback(
    async (nodeType: TraceNodeType, nodeId: string, dir: Direction): Promise<void> => {
      if (!nodeId.trim()) return;
      setLoading(true);
      setError(null);
      try {
        const result =
          dir === 'forward'
            ? await ipc.medicalDevice.trace.forward(nodeType, nodeId.trim())
            : await ipc.medicalDevice.trace.backward(nodeType, nodeId.trim());
        setView(result);
      } catch (err) {
        setError(friendlyError(err));
        setView(null);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Running automatically when opened from a lot or product is the whole point
  // of the "Trace" button elsewhere: the user already said what they want.
  useEffect(() => {
    if (target) void run(target.type, target.id, direction);
  }, [target, direction, run]);

  const rows = view ? traceRows(view.lines, direction) : [];

  return (
    <div>
      <Section
        title="Traceability"
        subtitle="Follow real recorded movement between lots, manufacturing orders, warehouses, shipments and customers."
        icon="layers"
      >
        <div className="mb-4">
          <SegmentedTabs
            items={DIRECTION_TABS}
            activeId={direction}
            onChange={setDirection}
            ariaLabel="Trace direction"
          />
        </div>

        <Card variant="flat" className="mb-5">
          <div className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Start from</span>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as TraceNodeType)}
                className="h-9 rounded-lg border border-[var(--hairline)] bg-transparent px-3 text-sm"
              >
                {NODE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {nodeLabel(t)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block min-w-[260px] flex-1">
              <span className="mb-1 block text-sm font-medium">
                {type === 'lot' || type === 'product' ? 'Record id' : 'Code'}
              </span>
              <Input
                value={id}
                onChange={(e) => setId(e.target.value)}
                placeholder={type === 'lot' ? 'Open a lot and press Trace, or paste a record id' : 'e.g. WH-01'}
                aria-label="Trace subject"
              />
            </label>
            <Button
              variant="primary"
              icon="search"
              disabled={loading || !id.trim()}
              onClick={() => {
                onTargetChange(null);
                void run(type, id, direction);
              }}
            >
              Trace
            </Button>
            {target && (
              <Button
                icon="close"
                onClick={() => {
                  onTargetChange(null);
                  setView(null);
                  setId('');
                }}
              >
                Clear
              </Button>
            )}
          </div>
          <p className="mt-3 text-xs text-faint">
            Lots and products are identified by record id — open one and press Trace rather than typing it. Warehouses,
            shipments, customers, orders and suppliers are identified by the code your records use.
          </p>
        </Card>

        {error && <ErrorBlock title={error.title} detail={error.detail} />}

        {loading ? (
          <Loading label="Tracing" />
        ) : view === null ? (
          <EmptyState
            icon="layers"
            title="Nothing traced yet"
            description="Choose what to start from, or press Trace on a lot or product."
          />
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-baseline gap-2">
              <span className="text-sm text-muted">{nodeLabel(view.root.type)}</span>
              <span className="text-lg font-semibold">{view.root.label}</span>
            </div>

            <NoticeBlock icon="info">{view.scopeNote}</NoticeBlock>

            {rows.length > 0 && (
              <>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {(
                    [
                      ['lot', 'Lots'],
                      ['manufacturing_order', 'Manufacturing orders'],
                      ['warehouse', 'Warehouses'],
                      ['shipment', 'Shipments'],
                      ['customer', 'Customers'],
                      ['order', 'Orders'],
                      ['supplier', 'Suppliers'],
                    ] as [TraceNodeType, string][]
                  )
                    .filter(([t]) => (view.result.byType[t] ?? []).length > 0)
                    .map(([t, label]) => (
                      <Card key={t} variant="dashboard" className="p-3">
                        <div className="text-xs uppercase tracking-wider text-faint">{label}</div>
                        <div className="mt-1 text-sm">
                          {(view.result.byType[t] ?? []).map((n) => n.label).join(', ')}
                        </div>
                      </Card>
                    ))}
                </div>

                <Card variant="flat" className="mt-4">
                  <h3 className="mb-3 text-sm font-semibold">
                    {direction === 'forward' ? 'Downstream' : 'Upstream'} — every recorded step
                  </h3>
                  <ol className="space-y-1.5">
                    {rows.map((row, i) => (
                      <li
                        key={`${row.kind}-${i}`}
                        className="flex items-start gap-2 text-sm"
                        style={{ paddingLeft: row.indent * 18 }}
                      >
                        <span className="mt-0.5 shrink-0 text-faint">{row.marker}</span>
                        <span className="min-w-0">
                          {row.text}
                          {row.hasProvenance && (
                            <span
                              className="ml-2 inline-flex items-center gap-1 text-xs text-faint"
                              title="This step came from an import — its source file, sheet and row are in Data → Provenance."
                            >
                              <Icon name="doc" size={11} />
                              imported
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ol>
                </Card>
              </>
            )}

            {view.truncated && (
              <div className="mt-3">
                <NoticeBlock icon="info">
                  The walk stopped at its size limit, so there may be more beyond what is shown. Trace from a point
                  further along the chain to see the rest.
                </NoticeBlock>
              </div>
            )}
          </>
        )}
      </Section>
    </div>
  );
}
