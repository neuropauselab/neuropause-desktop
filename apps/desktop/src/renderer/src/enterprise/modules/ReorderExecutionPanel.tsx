/**
 * ReorderExecutionPanel (ERP Session 89) — the smallest real operator surface for governed reorder
 * execution. It renders on the S86 decision-report detail ONLY, and only offers "Create Purchase
 * Request" for rows the S86 policy marks executable (`readinessStatus === 'READY_FOR_OPERATOR_REVIEW'`).
 *
 * The action is EXPLICIT and TWO-STEP: the operator opens a confirmation that states the product,
 * current stock, open supply, reorder level, recommended quantity, estimated value, approval
 * requirement, the deterministic PR number, and — plainly — that this creates a DRAFT purchase
 * request only. Confirming dispatches the governed `CreatePurchaseRequestFromReorderRecommendation`
 * command (via `ipc.platform.createReorderPurchaseRequest`), which re-reads the live state, re-applies
 * the S88 policy (fail closed if stale), and creates exactly ONE draft PR. There is no automatic or
 * background execution here; nothing runs without this explicit confirmation.
 */
import { useMemo, useState } from 'react';
import { ipc } from '@renderer/lib/ipc';
import { Button } from '@renderer/components/ui/Button';

interface DecisionRow {
  sku: string;
  availableStock?: number;
  openSupply?: number;
  reorderLevel?: number;
  suggestedQuantity?: number;
  estimatedOrderValue?: number | null;
  requiredApprovalSteps?: string[];
  readinessStatus?: string;
}

/** Display-only mirror of the server's S88 identity (`reorderExecutionRequestNumber`). The server is
 *  authoritative; this only shows the operator the number the draft will carry. */
function deterministicPrNumber(reportNumber: string, sku: string): string {
  return `PR-REORDER-${reportNumber}-${sku}`;
}

export function ReorderExecutionPanel({
  reportId,
  reportNumber,
  rowsJson,
  onCreated,
}: {
  reportId: string;
  reportNumber: string;
  rowsJson: string;
  onCreated?: () => void;
}): JSX.Element | null {
  const executableRows = useMemo<DecisionRow[]>(() => {
    let rows: DecisionRow[] = [];
    try {
      const parsed = JSON.parse(rowsJson || '[]');
      if (Array.isArray(parsed)) rows = parsed as DecisionRow[];
    } catch {
      rows = [];
    }
    return rows.filter((r) => r && r.readinessStatus === 'READY_FOR_OPERATOR_REVIEW' && typeof r.sku === 'string');
  }, [rowsJson]);

  const [confirmSku, setConfirmSku] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Record<string, string>>({}); // sku → PR number
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  if (executableRows.length === 0) return null;

  const confirmRow = executableRows.find((r) => r.sku === confirmSku) ?? null;

  const execute = async (sku: string): Promise<void> => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await ipc.platform.createReorderPurchaseRequest(reportId, sku);
      if (res.ok) {
        const prNumber = String(res.data?.requestNumber ?? deterministicPrNumber(reportNumber, sku));
        setCreated((c) => ({ ...c, [sku]: prNumber }));
        setMsg({ tone: 'ok', text: `Draft purchase request ${prNumber} created for ${sku}. Approve it in Purchase Requests to proceed.` });
        onCreated?.();
      } else {
        setMsg({ tone: 'error', text: res.error?.message ?? res.error?.code ?? 'The reorder could not be executed.' });
      }
    } finally {
      setBusy(false);
      setConfirmSku(null);
    }
  };

  return (
    <section className="mb-4 rounded-lg border border-border/60 bg-surface/40 p-4" aria-label="Reorder execution">
      <h3 className="mb-1 text-sm font-semibold text-ink">Reorder execution</h3>
      <p className="mb-3 text-xs text-faint">
        Creates a DRAFT purchase request only — no purchase order, no stock movement, no accounting.
        Approval happens later in Purchase Requests.
      </p>

      {msg && (
        <div className={`mb-3 rounded-md px-3 py-2 text-sm ${msg.tone === 'ok' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-rose-500/10 text-rose-300'}`} role={msg.tone === 'error' ? 'alert' : undefined}>
          {msg.text}
        </div>
      )}

      <ul className="space-y-2">
        {executableRows.map((r) => {
          const prNumber = deterministicPrNumber(reportNumber, r.sku);
          const done = created[r.sku];
          return (
            <li key={r.sku} className="rounded-md border border-border/40 px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-ink">{r.sku}</span>
                {done ? (
                  <span className="text-xs text-emerald-300">Draft created · {done}</span>
                ) : (
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => setConfirmSku(r.sku)}>
                    Create Purchase Request
                  </Button>
                )}
              </div>
              <div className="mt-1 grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs text-muted">
                <span>Available stock: {Number(r.availableStock ?? 0)}</span>
                <span>Open supply: {Number(r.openSupply ?? 0)}</span>
                <span>Reorder level: {Number(r.reorderLevel ?? 0)}</span>
                <span>Recommended qty: {Number(r.suggestedQuantity ?? 0)}</span>
                <span>Estimated value: {r.estimatedOrderValue == null ? '—' : Number(r.estimatedOrderValue)}</span>
                <span>Approval: {(r.requiredApprovalSteps ?? []).join(', ') || '—'}</span>
                <span className="col-span-2 text-faint">Draft PR #: {prNumber}</span>
              </div>
            </li>
          );
        })}
      </ul>

      {confirmRow && (
        <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm" role="alertdialog" aria-modal="true" aria-label="Confirm reorder execution">
          <p className="mb-2 text-ink">
            Create a <strong>draft</strong> purchase request for <strong>{Number(confirmRow.suggestedQuantity ?? 0)}</strong> unit(s) of{' '}
            <strong>{confirmRow.sku}</strong> as <strong>{deterministicPrNumber(reportNumber, confirmRow.sku)}</strong>?
          </p>
          <p className="mb-3 text-xs text-faint">
            This creates a draft PR only. No purchase order is placed, no supplier is selected, no stock
            moves, and nothing is posted to the ledger. The quantity is fixed by the recommendation.
          </p>
          <div className="flex justify-end gap-2">
            <Button size="sm" onClick={() => setConfirmSku(null)} disabled={busy}>Cancel</Button>
            <Button size="sm" variant="primary" icon="check" disabled={busy} onClick={() => void execute(confirmRow.sku)}>
              Confirm — create draft PR
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
