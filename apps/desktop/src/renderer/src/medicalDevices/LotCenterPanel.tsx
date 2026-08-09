/**
 * Medical Devices → Batch / Lot Center.
 *
 * Every write here goes through `ipc.medicalDevice.lots.*`, which is the only
 * path that can change a batch. The form-level checks below are convenience —
 * the service checks the same rules again with sight of every other lot, and
 * its answer is the one that decides.
 *
 * Where a downstream module does not exist in this build, the panel says so in
 * words. An empty "Quality" card would read as "this lot has no quality
 * history", which is a different and far more dangerous claim.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  DeviceLotDetail,
  DeviceLotListItem,
  DeviceLotPage,
  DeviceProductListItem,
  LotCenterView,
  LotStatus,
  MedicalDevicePackView,
} from '@neuropause/shared';
import { LOT_MERGE_UNSUPPORTED_REASON } from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { Button } from '@renderer/components/ui/Button';
import { Card } from '@renderer/components/ui/Card';
import { Input } from '@renderer/components/ui/Input';
import { Loading } from '@renderer/components/ui/Loading';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { Badge } from '@renderer/components/ui/controls';
import { SegmentedTabs, type SegmentedTabItem } from '@renderer/components/ui/pillTabs';
import {
  DataTable,
  DetailRow,
  ErrorBlock,
  NoticeBlock,
  Section,
  StatusPill,
  Td,
  Th,
} from '@renderer/dataCommandCenter/primitives';
import {
  EMPTY_LOT_DRAFT,
  LOT_STATUS_TONE,
  checkLotDraft,
  emptyMessage,
  friendlyError,
  lotFlag,
  lotSubtitle,
  lotTabs,
  previewSplit,
  quantityBreakdown,
  statusLabel,
  type LotCreateDraft,
  type SplitPartDraft,
} from './medicalDevicesModel';

interface Props {
  pack: MedicalDevicePackView | null;
  /** Set when the panel was opened from a product. */
  productFilter: string | null;
  onClearProductFilter: () => void;
  onTrace: (lotId: string, label: string) => void;
}

type Mode = { kind: 'list' } | { kind: 'detail'; id: string } | { kind: 'create' };

export function LotCenterPanel({ pack, productFilter, onClearProductFilter, onTrace }: Props): JSX.Element {
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [view, setView] = useState<LotCenterView>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState<DeviceLotPage | null>(null);
  const [error, setError] = useState<{ title: string; detail: string } | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setError(null);
      setPage(
        await ipc.medicalDevice.lots.list({
          view,
          ...(search.trim() ? { search: search.trim() } : {}),
          ...(productFilter ? { productId: productFilter } : {}),
        }),
      );
    } catch (err) {
      setError(friendlyError(err));
      setPage(null);
    }
  }, [view, search, productFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const tabs = useMemo<SegmentedTabItem<LotCenterView>[]>(
    () => lotTabs(page).map((t) => ({ id: t.id, label: t.label, count: t.count || undefined })),
    [page],
  );

  if (mode.kind === 'create') {
    return (
      <CreateLotForm
        onCancel={() => setMode({ kind: 'list' })}
        onCreated={(id) => {
          void load();
          setMode({ kind: 'detail', id });
        }}
      />
    );
  }

  if (mode.kind === 'detail') {
    return (
      <LotDetailPanel
        lotId={mode.id}
        onBack={() => {
          void load();
          setMode({ kind: 'list' });
        }}
        onTrace={onTrace}
      />
    );
  }

  const empty = emptyMessage('lots', Boolean(search.trim()), view);

  return (
    <div>
      <Section
        title="Batch / Lot Center"
        subtitle="Batches, their lifecycle, and the quantities that must stay reconciled with what has been consumed, split and shipped."
        icon="tag"
        right={
          <Button size="sm" icon="plus" onClick={() => setMode({ kind: 'create' })}>
            New lot
          </Button>
        }
      >
        <div className="mb-4">
          <SegmentedTabs items={tabs} activeId={view} onChange={setView} ariaLabel="Lot views" />
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search lot number, product, warehouse, order or supplier"
            className="min-w-[300px] flex-1"
            aria-label="Search lots"
          />
          {productFilter && (
            <Button size="sm" icon="close" onClick={onClearProductFilter}>
              Clear product filter
            </Button>
          )}
        </div>

        {error && <ErrorBlock title={error.title} detail={error.detail} onRetry={() => void load()} />}

        {page === null ? (
          <Loading label="Loading lots" />
        ) : page.lots.length === 0 ? (
          <EmptyState icon="tag" title={empty.title} description={empty.body} />
        ) : (
          <>
            <DataTable
              head={
                <tr>
                  <Th>Lot</Th>
                  <Th>Product</Th>
                  <Th>Status</Th>
                  <Th>Remaining</Th>
                  <Th>Warehouse</Th>
                  <Th>Expires</Th>
                </tr>
              }
            >
              {page.lots.map((lot) => (
                <LotRow key={lot.id} lot={lot} onOpen={() => setMode({ kind: 'detail', id: lot.id })} />
              ))}
            </DataTable>
            {page.total > page.lots.length && (
              <p className="mt-2 text-xs text-faint">
                Showing {page.lots.length} of {page.total} — narrow the search to see the rest.
              </p>
            )}
          </>
        )}
        {pack && pack.counts.traceEdges === 0 && page && page.lots.length > 0 && (
          <NoticeBlock icon="info">
            No movement has been recorded against any batch yet, so a trace will be empty. That is a statement about
            your records, not a missing feature.
          </NoticeBlock>
        )}
      </Section>
    </div>
  );
}

function LotRow({ lot, onOpen }: { lot: DeviceLotListItem; onOpen: () => void }): JSX.Element {
  const qty = quantityBreakdown(lot);
  const flag = lotFlag(lot);
  return (
    <tr className="cursor-pointer hover:[background:var(--fill-1)]" onClick={onOpen}>
      <Td className="font-medium">
        {lot.lotNumber}
        {flag && (
          <div className="mt-0.5 text-xs font-normal text-muted" title={flag.text}>
            {flag.text}
          </div>
        )}
      </Td>
      <Td className="text-muted">{lot.productCode}</Td>
      <Td>
        <StatusPill tone={LOT_STATUS_TONE[lot.status]}>{statusLabel(lot.status)}</StatusPill>
      </Td>
      <Td className="tabular-nums">
        {qty.remaining} <span className="text-faint">/ {qty.original}</span> {lot.unit}
      </Td>
      <Td className="text-muted">{lot.warehouseId || '—'}</Td>
      <Td className="text-muted">{lot.expiryDate || <span className="text-faint">None recorded</span>}</Td>
    </tr>
  );
}

/* ── detail ───────────────────────────────────────────────────────────────── */

function LotDetailPanel({
  lotId,
  onBack,
  onTrace,
}: {
  lotId: string;
  onBack: () => void;
  onTrace: (lotId: string, label: string) => void;
}): JSX.Element {
  const [detail, setDetail] = useState<DeviceLotDetail | null | 'missing'>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [drawer, setDrawer] = useState<'none' | 'split' | 'consume' | 'ship' | 'move'>('none');

  const load = useCallback(async (): Promise<void> => {
    try {
      setDetail((await ipc.medicalDevice.lots.get(lotId)) ?? 'missing');
    } catch (err) {
      const friendly = friendlyError(err);
      setMessage({ tone: 'bad', text: `${friendly.title}. ${friendly.detail}` });
      setDetail('missing');
    }
  }, [lotId]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>, success: string): Promise<void> => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await fn();
      if (result.ok) {
        setMessage({ tone: 'good', text: success });
        setDrawer('none');
        await load();
      } else {
        setMessage({ tone: 'bad', text: result.error ?? 'That was refused without a reason.' });
      }
    } catch (err) {
      const friendly = friendlyError(err);
      setMessage({ tone: 'bad', text: `${friendly.title}. ${friendly.detail}` });
    } finally {
      setBusy(false);
    }
  };

  if (detail === null) return <Loading label="Loading lot" />;
  if (detail === 'missing') {
    return (
      <div>
        <Button size="sm" icon="close" onClick={onBack} className="mb-4">
          Back to lots
        </Button>
        <EmptyState icon="tag" title="Lot not found" description="It may have been deleted." />
      </div>
    );
  }

  const lot = detail.lot;
  const qty = quantityBreakdown(lot);
  const flag = lotFlag(lot);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Button size="sm" icon="close" onClick={onBack}>
          Back to lots
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon="layers" onClick={() => onTrace(lot.id, lot.lotNumber)}>
            Trace
          </Button>
          <Button size="sm" icon="filter" onClick={() => setDrawer(drawer === 'split' ? 'none' : 'split')}>
            Split
          </Button>
          <Button size="sm" icon="download" onClick={() => setDrawer(drawer === 'consume' ? 'none' : 'consume')}>
            Consume
          </Button>
          <Button size="sm" icon="package" onClick={() => setDrawer(drawer === 'move' ? 'none' : 'move')}>
            Move
          </Button>
          <Button size="sm" icon="upload" onClick={() => setDrawer(drawer === 'ship' ? 'none' : 'ship')}>
            Ship
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-xl font-semibold tracking-tight">{lot.lotNumber}</h2>
        <StatusPill tone={LOT_STATUS_TONE[lot.status]}>{statusLabel(lot.status)}</StatusPill>
      </div>
      <p className="mt-1 text-sm text-muted">{lotSubtitle(lot)}</p>
      {flag && <p className="mt-2 text-sm text-sysorange">{flag.text}</p>}

      {message && (
        <div
          className={`mt-4 rounded-xl border px-3.5 py-3 text-sm ${
            message.tone === 'good' ? 'border-sysgreen/30 text-sysgreen' : 'border-syspink/30 text-syspink'
          }`}
        >
          {message.text}
        </div>
      )}

      {qty.inconsistency && (
        <div className="mt-4">
          <ErrorBlock title="These quantities do not reconcile" detail={qty.inconsistency} />
        </div>
      )}

      {drawer === 'split' && <SplitDrawer lot={lot} busy={busy} onRun={run} />}
      {drawer === 'consume' && <ConsumeDrawer lot={lot} busy={busy} onRun={run} />}
      {drawer === 'move' && <MoveDrawer lot={lot} busy={busy} onRun={run} />}
      {drawer === 'ship' && <ShipDrawer lot={lot} busy={busy} onRun={run} />}

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <Card variant="flat">
          <h3 className="mb-2 text-sm font-semibold">Identity</h3>
          <DetailRow label="Lot number" value={lot.lotNumber} />
          <DetailRow label="Product" value={`${lot.productCode}${lot.productName ? ` · ${lot.productName}` : ''}`} />
          <DetailRow label="Record id" value={<span className="font-mono text-xs">{lot.id}</span>} />
        </Card>

        <Card variant="flat">
          <h3 className="mb-2 text-sm font-semibold">Quantity</h3>
          <DetailRow label="Original" value={`${qty.original} ${lot.unit}`} />
          <DetailRow label="Consumed" value={`${qty.consumed} ${lot.unit}`} />
          <DetailRow label="Split into child lots" value={`${qty.split} ${lot.unit}`} />
          <DetailRow label="Remaining" value={<strong>{`${qty.remaining} ${lot.unit}`}</strong>} />
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full [background:var(--fill-2)]">
            <div className="h-full rounded-full bg-sysgreen" style={{ width: `${qty.remainingPct}%` }} />
          </div>
        </Card>

        <Card variant="flat">
          <h3 className="mb-2 text-sm font-semibold">Dates</h3>
          <DetailRow label="Manufactured" value={lot.manufactureDate || '—'} />
          <DetailRow
            label="Expires"
            value={lot.expiryDate || <span className="text-faint">No expiry recorded</span>}
          />
          {!lot.expiryDate && (
            <NoticeBlock icon="info">
              Many devices have no expiry at all. Empty here means none was recorded — never &ldquo;unknown
              risk&rdquo;.
            </NoticeBlock>
          )}
        </Card>

        <Card variant="flat">
          <h3 className="mb-2 text-sm font-semibold">Warehouse &amp; manufacturing</h3>
          <DetailRow label="Warehouse" value={lot.warehouseId || '—'} />
          <DetailRow label="Manufacturing order" value={lot.manufacturingOrderId || '—'} />
          <DetailRow label="Supplier" value={lot.supplierId || '—'} />
        </Card>

        <Card variant="flat">
          <h3 className="mb-2 text-sm font-semibold">Lineage</h3>
          <DetailRow label="Parent lot" value={detail.context.parentLots.map((l) => l.label).join(', ') || '—'} />
          <DetailRow label="Child lots" value={detail.context.childLots.map((l) => l.label).join(', ') || '—'} />
          <DetailRow label="Source lot" value={lot.sourceLotId || '—'} />
        </Card>

        <Card variant="flat">
          <h3 className="mb-2 text-sm font-semibold">Distribution</h3>
          <DetailRow label="Shipments" value={detail.context.shipments.map((s) => s.label).join(', ') || '—'} />
          <DetailRow
            label="Manufacturing orders"
            value={detail.context.manufacturingOrders.map((m) => m.label).join(', ') || '—'}
          />
        </Card>
      </div>

      <Section title="Lifecycle" icon="pulse" subtitle="Only the transitions the state machine allows are offered.">
        {detail.allowedTransitions.length === 0 ? (
          <NoticeBlock icon="lock">
            {statusLabel(lot.status)} is a final state. Record a new decision rather than changing this one.
          </NoticeBlock>
        ) : (
          <div className="flex flex-wrap gap-2">
            {detail.allowedTransitions.map((t) => (
              <Button
                key={t.status}
                size="sm"
                disabled={busy}
                onClick={() =>
                  void run(
                    () => ipc.medicalDevice.lots.transition(lot.id, t.status as LotStatus),
                    `${lot.lotNumber} is now ${t.label.toLowerCase()}.`,
                  )
                }
              >
                {t.label}
              </Button>
            ))}
          </div>
        )}
      </Section>

      <Section title="Not yet configured" icon="info">
        {detail.notConfigured.map((n) => (
          <div key={n.section} className="mb-2">
            <NoticeBlock icon="info">
              <strong>{n.section}:</strong> {n.reason}
            </NoticeBlock>
          </div>
        ))}
        <NoticeBlock icon="layers">
          <strong>Merging lots:</strong> {LOT_MERGE_UNSUPPORTED_REASON}
        </NoticeBlock>
      </Section>

      <Section title="Audit" icon="clock" subtitle="Every recorded change to this batch.">
        {detail.history.length === 0 ? (
          <NoticeBlock icon="clock">Nothing has been recorded against this batch yet.</NoticeBlock>
        ) : (
          <DataTable
            head={
              <tr>
                <Th>When</Th>
                <Th>Who</Th>
                <Th>What</Th>
              </tr>
            }
          >
            {detail.history.map((h, i) => (
              <tr key={`${h.at}-${i}`}>
                <Td className="whitespace-nowrap text-muted">{new Date(h.at).toLocaleString()}</Td>
                <Td className="text-muted">{h.actor ?? 'Unknown'}</Td>
                <Td>{h.summary}</Td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>
    </div>
  );
}

/* ── operation drawers ────────────────────────────────────────────────────── */

type RunFn = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string) => Promise<void>;

function SplitDrawer({
  lot,
  busy,
  onRun,
}: {
  lot: DeviceLotListItem;
  busy: boolean;
  onRun: RunFn;
}): JSX.Element {
  const [parts, setParts] = useState<SplitPartDraft[]>([
    { lotNumber: `${lot.lotNumber}-A`, quantity: '' },
    { lotNumber: `${lot.lotNumber}-B`, quantity: '' },
  ]);
  const preview = previewSplit(lot, parts);
  const set = (i: number, patch: Partial<SplitPartDraft>): void =>
    setParts((p) => p.map((part, idx) => (idx === i ? { ...part, ...patch } : part)));

  return (
    <Card variant="flat" className="mt-4">
      <h3 className="mb-1 text-sm font-semibold">Split {lot.lotNumber}</h3>
      <p className="mb-3 text-sm text-muted">
        The arithmetic is shown as you type. Quantity is conserved: what leaves the parent is exactly what arrives in
        the children.
      </p>
      {parts.map((part, i) => (
        <div key={i} className="mb-2 flex flex-wrap gap-2">
          <Input
            value={part.lotNumber}
            onChange={(e) => set(i, { lotNumber: e.target.value })}
            placeholder="Child lot number"
            className="min-w-[200px] flex-1"
            aria-label={`Child lot ${i + 1} number`}
          />
          <Input
            value={part.quantity}
            onChange={(e) => set(i, { quantity: e.target.value })}
            placeholder="Quantity"
            className="w-32"
            aria-label={`Child lot ${i + 1} quantity`}
          />
        </div>
      ))}
      <Button
        size="sm"
        icon="plus"
        onClick={() => setParts((p) => [...p, { lotNumber: '', quantity: '' }])}
        className="mb-3"
      >
        Add part
      </Button>

      <div className="rounded-xl border border-[var(--hairline)] px-3.5 py-3 text-sm">
        <div className="tabular-nums">
          {preview.total} {lot.unit} out · {preview.remainingAfter} {lot.unit} left in {lot.lotNumber}
        </div>
        {preview.reason && <div className="mt-1 text-syspink">{preview.reason}</div>}
      </div>

      <Button
        variant="primary"
        icon="check"
        className="mt-3"
        disabled={busy || !preview.ok}
        onClick={() =>
          void onRun(
            () => ipc.medicalDevice.lots.split(lot.id, preview.parts),
            `${lot.lotNumber} split into ${preview.parts.length} lots.`,
          )
        }
      >
        Split lot
      </Button>
    </Card>
  );
}

function ConsumeDrawer({ lot, busy, onRun }: { lot: DeviceLotListItem; busy: boolean; onRun: RunFn }): JSX.Element {
  const [quantity, setQuantity] = useState('');
  const [order, setOrder] = useState('');
  return (
    <Card variant="flat" className="mt-4">
      <h3 className="mb-1 text-sm font-semibold">Consume from {lot.lotNumber}</h3>
      <p className="mb-3 text-sm text-muted">
        {lot.remaining} {lot.unit} remaining. Naming a manufacturing order records the consumption in the trace.
      </p>
      <div className="flex flex-wrap gap-2">
        <Input
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          placeholder="Quantity"
          className="w-32"
          aria-label="Quantity to consume"
        />
        <Input
          value={order}
          onChange={(e) => setOrder(e.target.value)}
          placeholder="Manufacturing order (optional)"
          className="min-w-[220px] flex-1"
          aria-label="Manufacturing order"
        />
      </div>
      <Button
        variant="primary"
        icon="check"
        className="mt-3"
        disabled={busy || !(Number(quantity) > 0)}
        onClick={() =>
          void onRun(
            () =>
              ipc.medicalDevice.lots.consume({
                lotId: lot.id,
                quantity: Number(quantity),
                ...(order.trim() ? { manufacturingOrderId: order.trim() } : {}),
              }),
            `Consumed ${quantity} ${lot.unit} from ${lot.lotNumber}.`,
          )
        }
      >
        Record consumption
      </Button>
    </Card>
  );
}

function MoveDrawer({ lot, busy, onRun }: { lot: DeviceLotListItem; busy: boolean; onRun: RunFn }): JSX.Element {
  const [warehouse, setWarehouse] = useState('');
  return (
    <Card variant="flat" className="mt-4">
      <h3 className="mb-1 text-sm font-semibold">Move {lot.lotNumber}</h3>
      <p className="mb-3 text-sm text-muted">
        Currently in {lot.warehouseId || 'no recorded warehouse'}. The move is recorded in the trace.
      </p>
      <Input
        value={warehouse}
        onChange={(e) => setWarehouse(e.target.value)}
        placeholder="Warehouse code"
        className="max-w-[280px]"
        aria-label="Destination warehouse"
      />
      <Button
        variant="primary"
        icon="check"
        className="mt-3"
        disabled={busy || !warehouse.trim()}
        onClick={() =>
          void onRun(
            () => ipc.medicalDevice.lots.move(lot.id, warehouse.trim()),
            `${lot.lotNumber} moved to ${warehouse.trim()}.`,
          )
        }
      >
        Record move
      </Button>
    </Card>
  );
}

function ShipDrawer({ lot, busy, onRun }: { lot: DeviceLotListItem; busy: boolean; onRun: RunFn }): JSX.Element {
  const [shipment, setShipment] = useState('');
  const [customer, setCustomer] = useState('');
  const [order, setOrder] = useState('');
  const [quantity, setQuantity] = useState('');
  return (
    <Card variant="flat" className="mt-4">
      <h3 className="mb-1 text-sm font-semibold">Ship from {lot.lotNumber}</h3>
      <p className="mb-3 text-sm text-muted">
        Shipping draws material, so it is refused from a quarantined, blocked or recalled batch. Leave the quantity
        empty to ship everything remaining ({lot.remaining} {lot.unit}).
      </p>
      <div className="grid gap-2 md:grid-cols-2">
        <Input
          value={shipment}
          onChange={(e) => setShipment(e.target.value)}
          placeholder="Shipment reference"
          aria-label="Shipment reference"
        />
        <Input
          value={customer}
          onChange={(e) => setCustomer(e.target.value)}
          placeholder="Customer (optional)"
          aria-label="Customer"
        />
        <Input
          value={order}
          onChange={(e) => setOrder(e.target.value)}
          placeholder="Sales order (optional)"
          aria-label="Sales order"
        />
        <Input
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          placeholder={`Quantity (default ${lot.remaining})`}
          aria-label="Quantity to ship"
        />
      </div>
      <Button
        variant="primary"
        icon="check"
        className="mt-3"
        disabled={busy || !shipment.trim()}
        onClick={() =>
          void onRun(
            () =>
              ipc.medicalDevice.lots.ship({
                lotId: lot.id,
                shipmentId: shipment.trim(),
                ...(customer.trim() ? { customerId: customer.trim() } : {}),
                ...(order.trim() ? { orderId: order.trim() } : {}),
                ...(Number(quantity) > 0 ? { quantity: Number(quantity) } : {}),
              }),
            `${lot.lotNumber} recorded on ${shipment.trim()}.`,
          )
        }
      >
        Record shipment
      </Button>
    </Card>
  );
}

/* ── create ───────────────────────────────────────────────────────────────── */

function CreateLotForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (id: string) => void;
}): JSX.Element {
  const [draft, setDraft] = useState<LotCreateDraft>(EMPTY_LOT_DRAFT);
  const [products, setProducts] = useState<DeviceProductListItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    ipc.medicalDevice.products
      .search({ status: 'active' })
      .then((found) => setProducts(found.filter((p) => p.batchLotTracked)))
      .catch(() => setProducts([]));
  }, []);

  const check = checkLotDraft(draft);
  const set = <K extends keyof LotCreateDraft>(key: K, value: LotCreateDraft[K]): void =>
    setDraft((d) => ({ ...d, [key]: value }));

  const submit = async (): Promise<void> => {
    setSaving(true);
    setServerError(null);
    try {
      const result = await ipc.medicalDevice.lots.create({
        lotNumber: draft.lotNumber.trim(),
        productId: draft.productId,
        quantity: Number(draft.quantity),
        ...(draft.unit.trim() ? { unit: draft.unit.trim() } : {}),
        ...(draft.manufactureDate ? { manufactureDate: draft.manufactureDate } : {}),
        ...(draft.expiryDate ? { expiryDate: draft.expiryDate } : {}),
        ...(draft.warehouseId.trim() ? { warehouseId: draft.warehouseId.trim() } : {}),
        ...(draft.supplierId.trim() ? { supplierId: draft.supplierId.trim() } : {}),
        ...(draft.manufacturingOrderId.trim()
          ? { manufacturingOrderId: draft.manufacturingOrderId.trim() }
          : {}),
        ...(draft.notes.trim() ? { notes: draft.notes.trim() } : {}),
      });
      if (result.ok && result.lot) onCreated(result.lot.id);
      else setServerError(result.error ?? 'The lot was refused without a reason.');
    } catch (err) {
      const friendly = friendlyError(err);
      setServerError(`${friendly.title}. ${friendly.detail}`);
    } finally {
      setSaving(false);
    }
  };

  const field = (
    key: keyof LotCreateDraft,
    label: string,
    placeholder?: string,
    type?: string,
  ): JSX.Element => (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <Input
        value={draft[key]}
        onChange={(e) => set(key, e.target.value)}
        placeholder={placeholder ?? ''}
        {...(type ? { type } : {})}
      />
      {check.errors[key] && <span className="mt-1 block text-xs text-syspink">{check.errors[key]}</span>}
    </label>
  );

  return (
    <div>
      <Button size="sm" icon="close" onClick={onCancel} className="mb-4">
        Cancel
      </Button>
      <Section
        title="New lot"
        icon="tag"
        subtitle="Only products with Batch / Lot Tracked turned on can carry a batch — a lot against an untracked product could never be recalled by batch."
      >
        {serverError && <ErrorBlock title="That lot was not created" detail={serverError} />}
        <Card variant="flat" className="mt-3">
          <div className="grid gap-4 md:grid-cols-2">
            {field('lotNumber', 'Lot number', 'LOT-2026-08-001')}
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Product</span>
              <select
                value={draft.productId}
                onChange={(e) => set('productId', e.target.value)}
                className="h-9 w-full rounded-lg border border-[var(--hairline)] bg-transparent px-3 text-sm"
              >
                <option value="">Choose a product</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.productCode} — {p.productName}
                  </option>
                ))}
              </select>
              {check.errors.productId && (
                <span className="mt-1 block text-xs text-syspink">{check.errors.productId}</span>
              )}
              {products.length === 0 && (
                <span className="mt-1 block text-xs text-faint">
                  No batch-tracked products yet. Create one, or turn on Batch / Lot Tracked for an existing product.
                </span>
              )}
            </label>
            {field('quantity', 'Quantity', '100')}
            {field('unit', 'Unit', 'unit')}
            {field('manufactureDate', 'Manufactured', '', 'date')}
            {field('expiryDate', 'Expires (optional)', '', 'date')}
            {field('warehouseId', 'Warehouse', 'WH-01')}
            {field('supplierId', 'Supplier (optional)', 'SUP-001')}
            {field('manufacturingOrderId', 'Manufacturing order (optional)', 'MO-102')}
          </div>
          <label className="mt-4 block">
            <span className="mb-1 block text-sm font-medium">Notes</span>
            <textarea
              value={draft.notes}
              onChange={(e) => set('notes', e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-[var(--hairline)] bg-transparent px-3 py-2 text-sm"
            />
          </label>
          <div className="mt-5 flex items-center gap-2">
            <Button variant="primary" icon="check" disabled={saving || !check.ok} onClick={() => void submit()}>
              {saving ? 'Creating…' : 'Create lot'}
            </Button>
            <Button onClick={onCancel}>Cancel</Button>
          </div>
          <p className="mt-3 text-xs text-faint">
            A new lot starts in <strong>Created</strong>. It has to be released before any material can be drawn from
            it.
          </p>
        </Card>
      </Section>
      <NoticeBlock icon="info">
        Many devices have no expiry at all. Leaving Expires empty is normal and never means &ldquo;unknown
        risk&rdquo;.
      </NoticeBlock>
    </div>
  );
}

/** Re-exported for the badge tone used by the lot list. */
export { Badge };
