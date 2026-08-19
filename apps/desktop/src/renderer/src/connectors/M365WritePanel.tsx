/**
 * P2.4 — Microsoft 365 write surface (renderer).
 *
 * Shows live write-health (last write, failed writes, retry queue, pending, latency, quota) and a
 * representative CONFIRMATION-GATED action: compose an email, optionally AI-draft the body (the AI never
 * sends — it only fills the draft), then an explicit two-step Send → Confirm before anything is written.
 * All writes flow through the audited executor over IPC; no token ever reaches the renderer.
 */
import { useState } from 'react';
import type { ConnectorSyncSnapshot } from '@neuropause/shared';
import { BrainReviewCard, type BrainReview } from './BrainReviewCard';
import { ipc } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/cn';
import {
  classifyWriteOutcome,
  EXECUTING_VIEW,
  type M365OutcomeTone,
  type M365OutcomeView,
} from './m365Outcome';

/** Honest tone → color mapping. UNKNOWN (warn) is deliberately distinct from FAILED/DENIED (error). */
const TONE_CLASS: Record<M365OutcomeTone, string> = {
  ok: 'text-sysgreen',
  warn: 'text-sysorange',
  error: 'text-sysred',
  info: 'text-sysblue',
  pending: 'text-faint',
};

function Title({ children }: { children: string }): JSX.Element {
  return <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">{children}</div>;
}

function Metric({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-center justify-between rounded-lg [background:var(--fill-2)] px-3 py-1.5 text-2xs">
      <span className="text-faint">{label}</span>
      <span className="font-medium text-ink tabular-nums">{value}</span>
    </div>
  );
}

export function M365WritePanel({
  connectorId,
  accountId,
  snaps,
  proposal,
  brainReview,
}: {
  connectorId: string;
  accountId: string | null;
  snaps: ConnectorSyncSnapshot[];
  /**
   * Wave-2 Slice-7 — an optional NeuroPause-validated action to REVIEW. The AI (as the human's representative)
   * proposes which capability + concrete parameters; this prefills the compose fields so the human sees the exact
   * recipient/subject/body that would be sent. NeuroPause proposes — it never confirms and never sends; the human's
   * explicit "Confirm send" remains the sole consent, and the certified governed IPC path is unchanged.
   */
  proposal?: { to?: string; subject?: string; body?: string };
  /** FG-9 — a certified L6 proposal's eight review fields (display-only), rendered VERBATIM above the compose form. */
  brainReview?: BrainReview | null;
}): JSX.Element {
  const snap = snaps.find((s) => s.accountId === accountId) ?? snaps[0];
  const [to, setTo] = useState(proposal?.to ?? '');
  const [subject, setSubject] = useState(proposal?.subject ?? '');
  const [body, setBody] = useState(proposal?.body ?? '');
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<M365OutcomeView | null>(null);

  const canWrite = accountId !== null;

  async function draft(): Promise<void> {
    if (!accountId) return;
    setBusy(true);
    setOutcome(null);
    setStatus('Drafting…');
    try {
      const r = await ipc.connectors.m365Draft(connectorId, accountId, 'email', instruction || subject || 'Draft a short email', '');
      if (r.ok) setBody(r.text);
      setStatus(r.ok ? `Draft ready (${r.model}) — review before sending` : r.text);
    } catch {
      setStatus('Draft failed');
    } finally {
      setBusy(false);
    }
  }

  async function confirmSend(): Promise<void> {
    if (!accountId) return;
    setBusy(true);
    setConfirming(false);
    setStatus(null);
    setOutcome(EXECUTING_VIEW);
    try {
      const recipients = to.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
      const r = await ipc.connectors.m365Execute(connectorId, accountId, 'mail.send', { to: recipients, subject, body }, true);
      const view = classifyWriteOutcome(r);
      setOutcome(view);
      // Clear the compose fields only on an honest provider acknowledgement — never on UNKNOWN/HELD/DENIED,
      // so the operator keeps the exact content to reconcile or retry deliberately.
      if (view.state === 'ACKNOWLEDGED') {
        setTo('');
        setSubject('');
        setBody('');
      }
    } catch {
      // A thrown IPC/transport error is an ambiguous outcome, NOT a proven no-effect. Treat as UNKNOWN.
      setOutcome({
        state: 'OUTCOME_UNKNOWN',
        label: 'Outcome unknown',
        detail: 'The request could not be confirmed (transport error). Reconcile the external state before any retry.',
        tone: 'warn',
        reconciliationRequired: true,
      });
    } finally {
      setBusy(false);
    }
  }

  const m = snap
    ? {
        failed: String(snap.failedWrites ?? 0),
        pending: String(snap.pendingWrites ?? 0),
        retry: String(snap.writeRetryDepth ?? 0),
        latency: snap.lastWriteLatencyMs != null ? `${snap.lastWriteLatencyMs} ms` : '—',
        quota: snap.apiQuotaRemaining != null ? String(snap.apiQuotaRemaining) : '—',
      }
    : null;
  // S19 (FG-7) — the TRUTHFUL five write states, each derived from the S34a
  // ActionRecord (via the snapshot join). Retires the disjoint "Writes/Last write"
  // counter. Absent (older snapshot / no writes) → honest absence, never a fake 0.
  const ws = snap?.writeStates ?? null;

  return (
    <section className="mb-6">
      <Title>Microsoft 365 writes</Title>

      {/* S19 — the five truthful states, each provably derived from the ActionRecord. */}
      {ws ? (
        <div className="mb-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          <Metric label="Requested" value={String(ws.requested)} />
          <Metric label="Authorized" value={String(ws.authorized)} />
          <Metric label="Executed" value={String(ws.executed)} />
          <Metric label="Provider acknowledged" value={String(ws.providerAcknowledged)} />
          <Metric label="Externally observed" value={String(ws.externallyObserved)} />
        </div>
      ) : (
        <div className="mb-3 text-2xs text-faint">No governed writes yet.</div>
      )}
      {m && (
        <div className="mb-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          <Metric label="Failed" value={m.failed} />
          <Metric label="Pending" value={m.pending} />
          <Metric label="Retry queue" value={m.retry} />
          <Metric label="Graph latency" value={m.latency} />
          <Metric label="API quota" value={m.quota} />
        </div>
      )}

      <div className="rounded-xl border border-[var(--hairline)] p-3">
        {proposal && (
          <div role="note" className="mb-2 rounded-lg border border-sysblue/30 px-3 py-1.5 text-2xs text-sysblue">
            Proposed by NeuroPause — review the exact recipient, subject and body below, then confirm. NeuroPause
            proposes; it never sends without your confirmation.
          </div>
        )}
        {/* FG-9 · S5.4 Phase 0 — the certified L6 proposal's eight review fields, rendered VERBATIM (display-only). */}
        <div className="mb-2">
          <BrainReviewCard review={brainReview} />
        </div>
        <div className="mb-2 text-2xs text-faint">
          Compose an email. AI can draft the body — it never sends; every send needs your explicit confirmation.
        </div>
        <div className="space-y-1.5">
          <input
            className="w-full rounded-lg [background:var(--fill-2)] px-3 py-1.5 text-2xs text-ink outline-none focus-visible:shadow-focus placeholder:text-faint"
            placeholder="To (comma-separated)"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            disabled={!canWrite || busy}
          />
          <input
            className="w-full rounded-lg [background:var(--fill-2)] px-3 py-1.5 text-2xs text-ink outline-none focus-visible:shadow-focus placeholder:text-faint"
            placeholder="Subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            disabled={!canWrite || busy}
          />
          <div className="flex gap-1.5">
            <input
              className="min-w-0 flex-1 rounded-lg [background:var(--fill-2)] px-3 py-1.5 text-2xs text-ink outline-none focus-visible:shadow-focus placeholder:text-faint"
              placeholder="AI instruction (e.g. “thank them and propose Tuesday”)"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              disabled={!canWrite || busy}
            />
            <button
              type="button"
              className="shrink-0 rounded-lg border border-[var(--hairline)] px-2.5 py-1.5 text-2xs font-medium text-ink outline-none focus-visible:shadow-focus disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void draft()}
              disabled={!canWrite || busy}
            >
              AI draft
            </button>
          </div>
          <textarea
            className="h-24 w-full resize-none rounded-lg [background:var(--fill-2)] px-3 py-1.5 text-2xs text-ink outline-none focus-visible:shadow-focus placeholder:text-faint"
            placeholder="Body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={!canWrite || busy}
          />
          {confirming ? (
            <div className="flex items-center gap-2 rounded-lg [background:var(--fill-2)] px-3 py-2 text-2xs">
              <span className="flex-1 text-ink">Send this email to {to || '(no recipient)'}?</span>
              <button type="button" className="rounded-lg bg-sysgreen/90 px-2.5 py-1 font-medium text-white" onClick={() => void confirmSend()} disabled={busy}>
                Confirm send
              </button>
              <button type="button" className="rounded-lg border border-[var(--hairline)] px-2.5 py-1 text-ink" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="w-full rounded-lg border border-[var(--hairline)] px-3 py-1.5 text-2xs font-medium text-ink disabled:opacity-50"
              onClick={() => (to.trim().length === 0 ? setStatus('Add at least one recipient') : setConfirming(true))}
              disabled={!canWrite || busy}
            >
              Send…
            </button>
          )}
          {status && <div className={cn('text-2xs', status.endsWith('failed') ? 'text-sysorange' : 'text-faint')}>{status}</div>}
          {outcome && (
            <div role="status" className="rounded-lg [background:var(--fill-2)] px-3 py-2">
              <div className={cn('text-2xs font-semibold', TONE_CLASS[outcome.tone])}>{outcome.label}</div>
              <div className="mt-0.5 text-2xs text-faint">{outcome.detail}</div>
              {outcome.reconciliationRequired && (
                <div className="mt-1 text-2xs text-sysorange">
                  Reconciliation required — check the external state; do not blindly retry.
                </div>
              )}
            </div>
          )}
          {!canWrite && <div className="text-2xs text-faint">Connect a Microsoft account to enable writes.</div>}
        </div>
      </div>
    </section>
  );
}
