import { useMemo, useState } from 'react';
import type { Job, JobProposal } from '@neuropause/shared';
import { Icon } from '@renderer/components/ui/Icon';
import { OpsPanel, StatusBadge } from '@renderer/operations/primitives';
import { EvidencePills, VerdictBlock, Pill } from '@renderer/workforce/primitives';
import { riskMeta } from '@renderer/workforce/lib';
import { cn } from '@renderer/lib/cn';
import { useEnterprise } from './EnterpriseProvider';
import { severityMeta, relativeTime, titleCase, TEXT_TONE, TINT_TONE, type EnterpriseTab } from './lib';

interface PendingItem {
  job: Job;
  proposal: JobProposal;
}

export function DecisionCenterPanel({ onNavigate }: { onNavigate: (tab: EnterpriseTab) => void }): JSX.Element {
  const { jobs, workers, graph, compliance, recommendations, approve, reject, delegate } = useEnterprise();
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const pending = useMemo<PendingItem[]>(() => {
    const out: PendingItem[] = [];
    for (const j of jobs) {
      for (const p of j.proposals) {
        if (p.verdict.decision === 'require_approval' && !p.approval) out.push({ job: j, proposal: p });
      }
    }
    return out;
  }, [jobs]);

  const highRisk = useMemo(() => pending.filter((i) => i.proposal.risk === 'high' || i.proposal.risk === 'critical'), [pending]);
  const violations = useMemo(() => compliance.filter((f) => f.status !== 'pass'), [compliance]);
  const workerName = (id: string): string => workers.find((w) => w.id === id)?.name ?? id;

  const relatedNodes = (proposal: JobProposal): { id: string; label: string }[] => {
    if (!graph) return [];
    const out: { id: string; label: string }[] = [];
    for (const ev of proposal.evidence) {
      const node = graph.nodes.find((n) => n.id === `entity:${ev.id}`);
      if (node) out.push({ id: node.id, label: node.label });
    }
    return out.slice(0, 6);
  };

  const act = async (item: PendingItem, kind: 'approve' | 'reject' | 'changes' | 'escalate'): Promise<void> => {
    setBusy(true);
    try {
      const text = note.trim();
      if (kind === 'approve') await approve(item.job.id, item.proposal.id, text || undefined);
      else if (kind === 'reject') await reject(item.job.id, item.proposal.id, text || undefined);
      else if (kind === 'changes') await reject(item.job.id, item.proposal.id, `Changes requested: ${text || 'see reviewer notes'}`);
      else await reject(item.job.id, item.proposal.id, `Escalated for owner review: ${text || 'flagged by reviewer'}`);
      setOpenId(null);
      setNote('');
    } finally {
      setBusy(false);
    }
  };

  const onDelegate = async (item: PendingItem): Promise<void> => {
    setBusy(true);
    try {
      await delegate(item.job.workerId, item.job.skillId);
      setOpenId(null);
      setNote('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile icon="shield" label="Pending decisions" value={pending.length} tone={pending.length > 0 ? 'orange' : 'green'} />
        <Tile icon="bolt" label="High-risk actions" value={highRisk.length} tone={highRisk.length > 0 ? 'red' : 'green'} />
        <Tile icon="info" label="Policy violations" value={violations.length} tone={violations.length > 0 ? 'orange' : 'green'} />
        <Tile icon="lightbulb" label="AI recommendations" value={recommendations.length} tone="accent" />
      </div>

      <OpsPanel title="Pending approvals" subtitle={pending.length === 0 ? 'Nothing awaiting a decision' : `${pending.length} governed action(s) need you`}>
        {pending.length === 0 ? (
          <div className="flex items-center gap-2 rounded-xl border border-[var(--hairline)] p-5 text-sm text-muted">
            <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg', TINT_TONE.green)}><Icon name="check" size={14} /></span>
            Every side-effecting action has been decided. Workers continue to propose; they will appear here for your approval.
          </div>
        ) : (
          <ul className="space-y-3">
            {pending.map((item) => {
              const { job, proposal } = item;
              const open = openId === proposal.id;
              const rm = riskMeta(proposal.risk);
              const related = relatedNodes(proposal);
              return (
                <li key={proposal.id} className="overflow-hidden rounded-2xl border border-[var(--hairline)]">
                  <div className="flex items-start gap-3 p-4">
                    <span className={cn('mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', TINT_TONE.orange)}><Icon name="shield" size={18} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-ink">{proposal.title}</span>
                        <Pill icon="cpu" tone="purple">{workerName(job.workerId)}</Pill>
                        <Pill tone="gray">{titleCase(job.skillId)}</Pill>
                        <StatusBadge tone={rm.tone} label={`${rm.label} risk`} />
                        {proposal.sideEffects && <Pill icon="bolt" tone="orange">Side effects</Pill>}
                      </div>
                      <p className="mt-1.5 text-sm text-muted">{proposal.summary}</p>
                      <div className="mt-2 flex items-center gap-2 text-2xs text-faint">
                        <Icon name="clock" size={12} /> proposed {relativeTime(job.createdAt)}
                      </div>
                      {!open && (
                        <button type="button" onClick={() => { setOpenId(proposal.id); setNote(''); }} className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg">
                          Review decision <Icon name="chevron-right" size={13} />
                        </button>
                      )}
                    </div>
                  </div>

                  {open && (
                    <div className="border-t border-[var(--hairline)] [background:var(--fill-1)] p-4">
                      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                        <div>
                          <Label text="Governance verdict" />
                          <VerdictBlock verdict={proposal.verdict} />
                          <Label text="Evidence" className="mt-3" />
                          {proposal.evidence.length > 0 ? <EvidencePills evidence={proposal.evidence} /> : <Empty text="No evidence references." />}
                        </div>
                        <div>
                          <Label text="Related knowledge-graph entities" />
                          {related.length > 0 ? (
                            <ul className="space-y-1.5">
                              {related.map((n) => (
                                <li key={n.id} className="flex items-center gap-2 rounded-lg border border-[var(--hairline)] px-2.5 py-1.5 text-sm">
                                  <Icon name="doc" size={13} className="text-faint" /> <span className="truncate text-ink">{n.label}</span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <Empty text="No linked entities in the organization graph." />
                          )}
                        </div>
                      </div>

                      <Label text="Decision note (recorded to the Governance Trace)" className="mt-4" />
                      <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        rows={2}
                        placeholder="Add context for this decision — required changes, rationale, or escalation reason…"
                        className="w-full resize-none rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] px-3 py-2 text-sm text-ink outline-none placeholder:text-faint focus-visible:shadow-focus"
                      />

                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Action icon="check" label="Approve" tone="green" onClick={() => void act(item, 'approve')} disabled={busy} />
                        <Action icon="undo" label="Request changes" tone="orange" onClick={() => void act(item, 'changes')} disabled={busy} />
                        <Action icon="arrow-up" label="Escalate" tone="blue" onClick={() => void act(item, 'escalate')} disabled={busy} />
                        <Action icon="cpu" label="Delegate to worker" tone="purple" onClick={() => void onDelegate(item)} disabled={busy} />
                        <Action icon="close" label="Reject" tone="red" onClick={() => void act(item, 'reject')} disabled={busy} />
                        <button type="button" onClick={() => { setOpenId(null); setNote(''); }} className="ml-auto rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted fill-hover hover:text-ink">Cancel</button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </OpsPanel>

      <OpsPanel title="Policy violations & risks" subtitle={violations.length === 0 ? 'Within policy' : `${violations.length} finding(s)`}>
        {violations.length === 0 ? (
          <div className="flex items-center gap-2 rounded-xl border border-[var(--hairline)] p-5 text-sm text-muted">
            <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg', TINT_TONE.green)}><Icon name="verified" size={14} /></span>
            All compliance rules pass.
          </div>
        ) : (
          <ul className="space-y-2">
            {violations.map((f) => {
              const sm = severityMeta(f.severity);
              return (
                <li key={f.ruleId} className="flex items-start gap-3 rounded-xl border border-[var(--hairline)] p-3.5">
                  <span className={cn('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', TINT_TONE[sm.tone])}><Icon name="info" size={14} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-ink">{f.ruleName}</span>
                      <span className="text-2xs text-faint">· {f.category}</span>
                    </div>
                    <p className="text-2xs text-faint">{f.detail}</p>
                    {f.evidence.length > 0 && <p className="mt-1 text-2xs text-faint">Evidence: {f.evidence.length} reference(s)</p>}
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <span className={cn('text-2xs font-semibold', TEXT_TONE[sm.tone])}>{sm.label}</span>
                    <button type="button" onClick={() => onNavigate(f.category === 'Governance' ? 'customize' : 'organization')} className="text-2xs font-medium text-accent">Resolve</button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </OpsPanel>

      <p className="mt-2 text-center text-2xs text-faint">
        Approve, reject, request-changes, and escalate are written to the Governance Trace™ with your note. Delegate re-runs the worker for a revised proposal.
      </p>
    </div>
  );
}

function Tile({ icon, label, value, tone }: { icon: Parameters<typeof Icon>[0]['name']; label: string; value: number; tone: 'green' | 'orange' | 'red' | 'accent' }): JSX.Element {
  return (
    <div className="surface-raised rounded-2xl p-4 shadow-card">
      <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg', TINT_TONE[tone])}><Icon name={icon} size={16} /></span>
      <div className="mt-3 text-2xl font-semibold tracking-tight">{value}</div>
      <div className="text-xs text-faint">{label}</div>
    </div>
  );
}

function Action({ icon, label, tone, onClick, disabled }: { icon: Parameters<typeof Icon>[0]['name']; label: string; tone: 'green' | 'orange' | 'red' | 'blue' | 'purple'; onClick: () => void; disabled: boolean }): JSX.Element {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cn('inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-40', TINT_TONE[tone])}>
      <Icon name={icon} size={13} /> {label}
    </button>
  );
}

function Label({ text, className }: { text: string; className?: string }): JSX.Element {
  return <div className={cn('mb-1.5 text-2xs font-semibold uppercase tracking-wider text-faint', className)}>{text}</div>;
}

function Empty({ text }: { text: string }): JSX.Element {
  return <div className="rounded-lg border border-dashed border-[var(--hairline)] px-3 py-2 text-2xs text-faint">{text}</div>;
}
