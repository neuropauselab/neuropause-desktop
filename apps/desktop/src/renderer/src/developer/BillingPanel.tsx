/**
 * Billing & Licensing. Compare and switch plans (Free / Pro / Enterprise), see
 * the usage-based summary for the period (included vs metered requests, overage,
 * estimated cost), manage seats, review licenses and marketplace purchases, and
 * preview the current invoice. Switching a plan re-tiers the gateway rate +
 * quota immediately.
 */
import { useState } from 'react';
import type { Invoice, PlanTier } from '@neuropause/shared';
import { OpsPanel, Stat, StatusBadge, IconAction, OpsTable, Bar } from '@renderer/operations/primitives';
import { Button } from '@renderer/components/ui/Button';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { Icon } from '@renderer/components/ui/Icon';
import { cn } from '@renderer/lib/cn';
import { ipc } from '@renderer/lib/ipc';
import { useDeveloper } from './DeveloperProvider';
import { Modal, Field, Input } from './primitives';
import { formatMoney, formatNum, planMeta, relativeTime } from './lib';

export function BillingPanel(): JSX.Element {
  const { billing, plans, seats, licenses, purchases, setPlan, assignSeat, releaseSeat } = useDeveloper();
  const [seatModal, setSeatModal] = useState(false);
  const [seatUser, setSeatUser] = useState('');
  const [seatId, setSeatId] = useState('');
  const [seatError, setSeatError] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [busy, setBusy] = useState(false);

  const usagePct = billing && billing.includedRequests > 0 ? Math.min(1, billing.periodRequests / billing.includedRequests) : 0;

  const addSeat = async (): Promise<void> => {
    if (!seatUser.trim()) return;
    setBusy(true);
    setSeatError(null);
    try {
      const res = await assignSeat(seatId.trim() || `user-${Date.now()}`, seatUser.trim());
      if ('error' in res) {
        setSeatError(res.error);
      } else {
        setSeatModal(false);
        setSeatUser('');
        setSeatId('');
      }
    } finally {
      setBusy(false);
    }
  };

  const previewInvoice = async (): Promise<void> => {
    setInvoice(await ipc.ecosystem.invoice());
  };

  return (
    <div>
      <OpsPanel title="Plans" subtitle="Switch tiers — gateway limits update immediately">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {plans.map((p) => {
            const current = billing?.subscription.planTier === p.tier;
            const pm = planMeta(p.tier);
            return (
              <div key={p.tier} className={cn('relative rounded-2xl border p-5 shadow-card transition', current ? 'border-accent surface-raised' : 'border-[var(--hairline)] surface')}>
                {current && <span className="absolute right-4 top-4"><StatusBadge tone={pm.tone} label="Current" /></span>}
                <div className="text-sm font-medium text-faint">{p.name}</div>
                <div className="mt-1 text-2xl font-semibold tracking-tight">{p.priceMonthly === 0 ? 'Free' : `$${p.priceMonthly}`}<span className="text-sm font-normal text-faint">{p.priceMonthly === 0 ? '' : '/mo'}</span></div>
                <ul className="mt-3 space-y-1.5">
                  {p.features.map((f) => (
                    <li key={f.label} className={cn('flex items-start gap-1.5 text-xs', f.included ? 'text-muted' : 'text-faint line-through')}>
                      <Icon name={f.included ? 'check' : 'close'} size={13} className={cn('mt-0.5', f.included ? 'text-sysgreen' : 'text-faint')} />
                      {f.label}
                    </li>
                  ))}
                </ul>
                <div className="mt-4">
                  {current ? (
                    <Button size="sm" variant="secondary" className="w-full" disabled>Current plan</Button>
                  ) : (
                    <Button size="sm" variant="primary" className="w-full" disabled={busy} onClick={() => { setBusy(true); void setPlan(p.tier as PlanTier).finally(() => setBusy(false)); }}>Switch to {p.name}</Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </OpsPanel>

      {billing && (
        <OpsPanel title="This period" subtitle="Usage-based billing summary" actions={<Button size="sm" variant="ghost" icon="doc" onClick={() => void previewInvoice()}>Preview invoice</Button>}>
          <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat icon="globe" label="Requests" value={formatNum(billing.periodRequests)} tone="blue" hint={`of ${formatNum(billing.includedRequests)} included`} />
            <Stat icon="bolt" label="Overage" value={formatNum(billing.overageRequests)} tone={billing.overageRequests > 0 ? 'orange' : 'gray'} />
            <Stat icon="store" label="Marketplace spend" value={formatMoney(billing.marketplaceSpend, billing.currency)} tone="purple" />
            <Stat icon="gauge" label="Estimated cost" value={formatMoney(billing.estimatedCost, billing.currency)} tone="accent" />
          </div>
          <div className="surface-raised rounded-2xl p-4 shadow-card">
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="text-faint">Included request usage</span>
              <span className="font-medium">{formatNum(billing.periodRequests)} / {formatNum(billing.includedRequests)}</span>
            </div>
            <Bar value={usagePct} tone={usagePct > 0.9 ? 'red' : usagePct > 0.7 ? 'orange' : 'green'} />
          </div>
        </OpsPanel>
      )}

      <OpsPanel
        title="Seats"
        subtitle={billing ? `${billing.seatsUsed} of ${billing.seats < 0 ? '∞' : billing.seats} seats used` : undefined}
        actions={<Button size="sm" icon="plus" onClick={() => { setSeatError(null); setSeatModal(true); }}>Assign seat</Button>}
      >
        {seats.length === 0 ? (
          <EmptyState icon="user" title="No seats assigned" description="Assign a seat to a teammate to grant access." compact />
        ) : (
          <OpsTable
            head={
              <>
                <th className="px-4 py-2.5">User</th>
                <th className="px-4 py-2.5">User ID</th>
                <th className="px-4 py-2.5">Assigned</th>
                <th className="px-4 py-2.5" />
              </>
            }
          >
            {seats.map((s) => (
              <tr key={s.id} className="border-t border-[var(--hairline)]">
                <td className="px-4 py-2.5 font-medium">{s.userName}</td>
                <td className="px-4 py-2.5 font-mono text-2xs text-muted">{s.userId}</td>
                <td className="px-4 py-2.5 text-muted">{relativeTime(s.assignedAt)}</td>
                <td className="px-4 py-2.5 text-right"><IconAction icon="trash" label="Release seat" tone="red" onClick={() => void releaseSeat(s.id)} /></td>
              </tr>
            ))}
          </OpsTable>
        )}
      </OpsPanel>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <OpsPanel title="Licenses" subtitle="Organization & seat licenses">
          {licenses.length === 0 ? (
            <EmptyState icon="verified" title="No licenses" description="Purchasing a marketplace listing issues a license here." compact />
          ) : (
            <div className="surface-raised divide-y divide-[var(--hairline)] overflow-hidden rounded-2xl shadow-card">
              {licenses.map((l) => (
                <div key={l.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <div className="text-sm font-medium">{l.listingName}</div>
                    <div className="text-2xs text-faint">{l.kind} · {relativeTime(l.issuedAt)}</div>
                  </div>
                  <StatusBadge tone={l.status === 'active' ? 'green' : 'gray'} label={l.status} />
                </div>
              ))}
            </div>
          )}
        </OpsPanel>

        <OpsPanel title="Marketplace purchases" subtitle="Spend ledger">
          {purchases.length === 0 ? (
            <EmptyState icon="store" title="No purchases" description="Purchases from the marketplace appear here." compact />
          ) : (
            <div className="surface-raised divide-y divide-[var(--hairline)] overflow-hidden rounded-2xl shadow-card">
              {purchases.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <div className="text-sm font-medium">{p.listingName}</div>
                    <div className="text-2xs text-faint">{p.model} · fee {formatMoney(p.feeAmount, p.currency)} · {relativeTime(p.purchasedAt)}</div>
                  </div>
                  <span className="text-sm font-semibold">{formatMoney(p.amount, p.currency)}</span>
                </div>
              ))}
            </div>
          )}
        </OpsPanel>
      </div>

      <Modal
        open={seatModal}
        title="Assign seat"
        onClose={() => setSeatModal(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSeatModal(false)}>Cancel</Button>
            <Button variant="primary" disabled={busy || !seatUser.trim()} onClick={() => void addSeat()}>Assign</Button>
          </>
        }
      >
        <Field label="Name"><Input value={seatUser} onChange={(e) => setSeatUser(e.target.value)} placeholder="Jordan Lee" /></Field>
        <Field label="User ID" hint="Optional — generated if blank"><Input value={seatId} onChange={(e) => setSeatId(e.target.value)} placeholder="user-123" /></Field>
        {seatError && <p className="text-xs text-syspink">{seatError}</p>}
      </Modal>

      <Modal open={invoice !== null} title={invoice ? `Invoice · ${invoice.period}` : 'Invoice'} onClose={() => setInvoice(null)} footer={<Button variant="primary" onClick={() => setInvoice(null)}>Close</Button>}>
        {invoice && (
          <div>
            <OpsTable
              head={
                <>
                  <th className="px-4 py-2.5">Description</th>
                  <th className="px-4 py-2.5">Qty</th>
                  <th className="px-4 py-2.5 text-right">Amount</th>
                </>
              }
            >
              {invoice.lines.map((l, i) => (
                <tr key={i} className="border-t border-[var(--hairline)]">
                  <td className="px-4 py-2.5">{l.description}</td>
                  <td className="px-4 py-2.5 text-muted">{l.quantity}</td>
                  <td className="px-4 py-2.5 text-right font-medium">{formatMoney(l.amount, invoice.currency)}</td>
                </tr>
              ))}
            </OpsTable>
            <div className="mt-3 flex items-center justify-between px-1 text-sm">
              <span className="font-medium text-muted">Total</span>
              <span className="text-lg font-semibold">{formatMoney(invoice.total, invoice.currency)}</span>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
