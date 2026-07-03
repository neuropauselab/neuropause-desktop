import { useMemo, useState } from 'react';
import type { Job, JobProposal, WorkerSummary } from '@neuropause/shared';
import { cn } from '@renderer/lib/cn';
import { Icon } from '@renderer/components/ui/Icon';
import { Button } from '@renderer/components/ui/Button';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { OpsPanel } from '@renderer/operations/primitives';
import { useWorkforce } from './WorkforceProvider';
import { EvidencePills, Pill, VerdictBlock, WorkerGlyph } from './primitives';
import { approvalMeta, relativeTime, riskMeta, TEXT_TONE, TINT_TONE, titleCase } from './lib';

interface PendingItem {
  job: Job;
  proposal: JobProposal;
  worker?: WorkerSummary;
}

function ProposalCard({ item }: { item: PendingItem }): JSX.Element {
  const { approve, reject } = useWorkforce();
  const { job, proposal, worker } = item;
  const [note, setNote] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const risk = riskMeta(proposal.risk);

  const decide = async (kind: 'approve' | 'reject'): Promise<void> => {
    setBusy(true);
    try {
      const trimmed = note.trim() || undefined;
      if (kind === 'approve') await approve(job.id, proposal.id, trimmed);
      else await reject(job.id, proposal.id, trimmed);
    } finally {
      setBusy(false);
    }
  };

  const openNote = (prefill: string): void => {
    setNoteOpen(true);
    setNote((n) => (n ? n : prefill));
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--hairline)]">
      <div className="flex items-start gap-3 p-4">
        {worker && <WorkerGlyph role={worker.role} size={38} />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-ink">{proposal.title}</span>
            <Pill tone={risk.tone} icon="bolt">
              {risk.label} risk
            </Pill>
            {proposal.sideEffects && (
              <Pill tone="orange" icon="shield">
                side effects
              </Pill>
            )}
          </div>
          <div className="mt-0.5 text-2xs text-faint">
            {worker?.name ?? job.workerId} · {titleCase(job.skillId)} · {relativeTime(job.createdAt)}
          </div>
          <p className="mt-2 text-sm text-ink">{proposal.summary}</p>

          <div className="mt-2">
            <div className="mb-1 text-2xs uppercase tracking-wide text-faint">Evidence</div>
            <EvidencePills evidence={proposal.evidence} />
          </div>

          <div className="mt-3">
            <VerdictBlock verdict={proposal.verdict} />
          </div>

          {noteOpen && (
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Add an instruction or delegate note — recorded with your decision."
              className="mt-3 w-full resize-none rounded-xl border border-[var(--hairline)] bg-transparent px-3 py-2 text-sm text-ink outline-none placeholder:text-faint focus:shadow-focus"
            />
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="primary" icon="check" onClick={() => void decide('approve')} disabled={busy}>
              Approve
            </Button>
            <Button variant="secondary" icon="close" onClick={() => void decide('reject')} disabled={busy}>
              Reject
            </Button>
            <button
              type="button"
              onClick={() => openNote('')}
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted transition fill-hover hover:text-ink"
            >
              <Icon name="doc" size={13} /> Edit instruction
            </button>
            <button
              type="button"
              onClick={() => openNote('Delegate to: ')}
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted transition fill-hover hover:text-ink"
            >
              <Icon name="user" size={13} /> Delegate
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ApprovalCenterPanel(): JSX.Element {
  const { jobs, workers } = useWorkforce();

  const { pending, decided } = useMemo(() => {
    const workerById = new Map(workers.map((w) => [w.id, w]));
    const pending: PendingItem[] = [];
    const decided: PendingItem[] = [];
    for (const job of jobs) {
      for (const proposal of job.proposals) {
        const needs = proposal.verdict.decision === 'require_approval';
        const item: PendingItem = { job, proposal, worker: workerById.get(job.workerId) };
        if (needs && !proposal.approval) pending.push(item);
        else if (proposal.approval) decided.push(item);
      }
    }
    decided.sort((a, b) => (a.proposal.approval!.decidedAt < b.proposal.approval!.decidedAt ? 1 : -1));
    return { pending, decided: decided.slice(0, 10) };
  }, [jobs, workers]);

  return (
    <div>
      <OpsPanel
        title="Human Approval Center"
        subtitle="Workers propose; you decide. Approving authorizes the action and records your decision in the audit trail."
        actions={pending.length > 0 ? <Pill tone="orange">{pending.length} pending</Pill> : undefined}
      >
        {pending.length === 0 ? (
          <EmptyState
            icon="check"
            title="No proposals waiting"
            description="When a worker proposes a side-effecting action, it parks here with its evidence and governance verdict for your approval."
            compact
          />
        ) : (
          <div className="space-y-3">
            {pending.map((item) => (
              <ProposalCard key={item.proposal.id} item={item} />
            ))}
          </div>
        )}
      </OpsPanel>

      {decided.length > 0 && (
        <OpsPanel title="Recently decided" subtitle="Your latest approvals and rejections">
          <ul className="divide-y divide-[var(--hairline)] overflow-hidden rounded-2xl border border-[var(--hairline)]">
            {decided.map(({ proposal, worker }) => {
              const meta = approvalMeta(proposal.approval!.decision);
              return (
                <li key={proposal.id} className="flex items-center gap-3 p-3">
                  {worker && <WorkerGlyph role={worker.role} size={26} />}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-ink">{proposal.title}</div>
                    {proposal.approval!.note && (
                      <div className="truncate text-2xs text-faint">“{proposal.approval!.note}”</div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className={cn('flex h-5 w-5 items-center justify-center rounded-md', TINT_TONE[meta.tone])}>
                      <Icon name={proposal.approval!.decision === 'approved' ? 'check' : 'close'} size={12} />
                    </span>
                    <span className={cn('text-2xs font-medium', TEXT_TONE[meta.tone])}>{meta.label}</span>
                    <span className="text-2xs text-faint">{relativeTime(proposal.approval!.decidedAt)}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </OpsPanel>
      )}
    </div>
  );
}
