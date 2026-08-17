/**
 * Holds & Decisions — the third run state, and the memory of consequential acts.
 *
 * HOLD is not failure. It is "understood, and not safe to run yet", and the
 * only way that claim means anything is if the hold is a durable item with a
 * named resolution rather than a modal someone dismissed. Each open hold
 * answers the five questions in order: what I know, what I don't, why I'm
 * holding, what would resolve it, what happens if you proceed.
 *
 * Below it, the Decision Record trail: who wanted what, what the evidence
 * said, what was recommended, what actually happened. This is what makes
 * "why did we approve this?" answerable from real data months later.
 */
import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { DecisionRecord, ExecutionSession, HoldCenterView, HoldRecord, Job } from '@neuropause/shared';
import {
  DECISION_RISK_LABELS,
  DECISION_RISK_RECOMMENDATIONS,
  HOLD_OUTCOME_LABELS,
  HOLD_REASON_LABELS,
} from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/cn';
import { createLogger } from '@renderer/lib/logger';
import { ViewHeader, ViewScroll } from '@renderer/components/ui/Page';
import { Button } from '@renderer/components/ui/Button';
import { Card } from '@renderer/components/ui/Card';
import { Icon } from '@renderer/components/ui/Icon';
import { NoticeBlock } from '@renderer/dataCommandCenter/primitives';
import { TRANSITION, listItemVariants, staggerDelay } from '@renderer/lib/motion';
import { SkeletonCards, SkeletonRegion } from '@renderer/components/ui/Skeleton';
import { useAnimatedCount } from '@renderer/lib/useAnimatedCount';
import {
  buildActionLifecycle,
  buildEvidenceTimeline,
  classifyExecutionSession,
  classifyHold,
  correlateJobForSession,
  correlateProposalForSession,
  linkHoldToSession,
  type LifecycleFact,
  type LifecycleStage,
  type TimelineFact,
  type TimelineStep,
} from './operatorConsole';

const log = createLogger('holds');

export function HoldsView(): JSX.Element {
  const [view, setView] = useState<HoldCenterView | null>(null);
  const [records, setRecords] = useState<DecisionRecord[] | null>(null);
  // Wave-2 Increment-3 — durable execution records, to authoritatively correlate a hold to its ExecutionSession
  // by governed decisionId (worker OUTCOME_UNKNOWN holds carry it). Read-only; never used to execute anything.
  const [sessions, setSessions] = useState<ExecutionSession[]>([]);
  // Wave-2 Increment-4 — worker Jobs (and their proposals/approvals/verdicts), to compose the full AI → proposal →
  // approval → governance → execution lifecycle. Correlated to a session ONLY by authoritative ids, same tenant.
  const [jobs, setJobs] = useState<Job[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    const [holds, decisions, execSessions, workJobs] = await Promise.allSettled([
      ipc.holds.list(200),
      ipc.decisionRecords.list(200),
      ipc.execute.sessions(),
      ipc.workforce.jobs({ limit: 200 }),
    ]);
    if (holds.status === 'fulfilled') setView(holds.value);
    if (decisions.status === 'fulfilled') setRecords(decisions.value);
    // Sessions and jobs are best-effort correlation context — a failure here only means links show as NOT_LINKED
    // / NOT_AVAILABLE, never a fabricated link. RBAC/denial on holds is still the authoritative signal below.
    if (execSessions.status === 'fulfilled') setSessions(execSessions.value.sessions);
    if (workJobs.status === 'fulfilled') setJobs(workJobs.value.jobs);
    // A refusal here is RBAC doing its job, not a bug. Say which it is rather
    // than rendering an empty list that reads as "nothing ever happened".
    if (holds.status === 'rejected') {
      log.warn('Holds unavailable', { message: String(holds.reason) });
      setDenied(true);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const resolve = async (
    hold: HoldRecord,
    outcome: 'took_alternative' | 'cancelled',
    note: string,
  ): Promise<void> => {
    setBusy(hold.id);
    setError(null);
    try {
      await ipc.holds.resolve(hold.id, outcome, note);
      await reload();
    } catch (err) {
      log.warn('Could not resolve the hold', { message: String(err) });
      setError('That hold could not be resolved — you may not have permission.');
    } finally {
      setBusy(null);
    }
  };

  const open = view?.open ?? [];
  // Rolls when a hold is resolved — the count and the row leaving the list are
  // the same event, so they should read as one. Not safety-critical: the
  // authoritative statement is the list itself, this is its label.
  const openCount = useAnimatedCount(open.length);

  return (
    <ViewScroll max={920}>
      <ViewHeader
        title="Holds & decisions"
        subtitle="A hold is not a failure — it is work NeuroPause understood but would not run without you. Below, the record of every consequential action and the evidence behind it."
        right={
          <Button icon="refresh" onClick={() => void reload()}>
            Refresh
          </Button>
        }
      />

      {denied && (
        <div className="mb-4">
          <NoticeBlock icon="shield">
            You do not have permission to read the governance trail (governance:read). Nothing is
            hidden from you here — this surface simply cannot show it.
          </NoticeBlock>
        </div>
      )}
      {error && (
        <div className="mb-4">
          <NoticeBlock icon="info">{error}</NoticeBlock>
        </div>
      )}

      {view && !view.assessmentLive && (
        <div className="mb-4">
          <NoticeBlock icon="info">
            Dependency assessment is not active in this session, so destructive actions are not
            currently being checked against linked records. This is a runtime fault, not an
            all-clear.
          </NoticeBlock>
        </div>
      )}

      <section className="mb-8">
        <h2 className="mb-2.5 text-sm font-semibold">
          Open holds
          {open.length > 0 && <span className="ml-1.5 text-faint">{openCount}</span>}
        </h2>
        {open.length === 0 ? (
          <NoticeBlock icon="check">
            Nothing is on hold. NeuroPause raises a hold when it understands a request but cannot
            run it safely — you have no unresolved ones.
          </NoticeBlock>
        ) : (
          <div className="space-y-3">
            {/*
              Exit animation matters more than entry here. Resolving a hold is
              the whole point of the screen, and a row that vanishes between
              frames leaves the user unsure whether their click did the thing
              or the list simply re-fetched.
            */}
            <AnimatePresence initial={false} mode="popLayout">
              {open.map((hold, i) => (
                <motion.div
                  key={hold.id}
                  layout
                  variants={listItemVariants}
                  initial="initial"
                  animate="animate"
                  exit={{ opacity: 0, scale: 0.98, transition: TRANSITION.exit }}
                  transition={{ ...TRANSITION.quick, delay: staggerDelay(i) }}
                >
                  <Card variant="hairline">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1 rounded-full border border-sysorange/40 px-2 py-0.5 text-[11px] font-medium text-sysorange">
                            <Icon name="info" size={10} />
                            On hold · {HOLD_REASON_LABELS[hold.reason]}
                          </span>
                          <span className="text-xs text-faint">{formatWhen(hold.at)}</span>
                        </div>
                        <h3 className="mt-1.5 text-base font-semibold">{hold.title}</h3>
                        <p className="mt-1 max-w-[640px] text-sm leading-relaxed text-muted">
                          {hold.why}
                        </p>
                        {/* Wave-1 Increment-3 — operator-facing state (plain words); technical reason stays below. */}
                        {(() => {
                          const op = classifyHold(hold);
                          return (
                            <div
                              role="status"
                              className={cn(
                                'mt-1.5 text-sm font-medium',
                                op.state === 'OUTCOME_UNKNOWN' ? 'text-sysorange' : 'text-ink',
                              )}
                            >
                              {op.label}
                              {op.reconciliationRequired && (
                                <span className="ml-1 text-xs font-normal text-faint">
                                  · reconcile before any retry — do not blindly retry
                                </span>
                              )}
                              {/* Wave-2 Increment-3 — the correlated execution, joined ONLY by governed decisionId.
                                  Honest NOT_LINKED when no authoritative join exists (never guessed). */}
                              {(() => {
                                const link = linkHoldToSession(hold, sessions);
                                if (link.linkState !== 'LINKED' || !link.session) {
                                  return (
                                    <div className="mt-1 text-xs font-normal text-faint">
                                      Execution: not linked — {link.reason}
                                    </div>
                                  );
                                }
                                const exec = classifyExecutionSession(link.session);
                                return (
                                  <div className="mt-1 text-xs font-normal text-muted">
                                    Execution: {exec.label} — {exec.detail}
                                  </div>
                                );
                              })()}
                              {/* Wave-2 Increment-4 — the full AI → proposal → approval → governance → admission →
                                  execution → outcome → hold → reconciliation lifecycle, composed from existing
                                  records by AUTHORITATIVE ids only (never guessed, never cross-tenant). */}
                              <LifecycleCard hold={hold} sessions={sessions} jobs={jobs} />
                            </div>
                          );
                        })()}
                      </div>
                    </div>

                    <div className="mt-3.5 grid gap-3 sm:grid-cols-2">
                      <Block title="What I know" items={hold.known} />
                      <Block title="What I don't know" items={hold.unknown} />
                    </div>

                    <div className="mt-3 rounded-xl border border-[var(--hairline)] px-3.5 py-2.5">
                      <div className="text-xs uppercase tracking-wider text-faint">
                        What would resolve this
                      </div>
                      <p className="mt-1 text-sm text-muted">{hold.resolution}</p>
                    </div>

                    {hold.ifProceeding && (
                      <div className="mt-2 rounded-xl border border-syspink/30 px-3.5 py-2.5">
                        <div className="text-xs uppercase tracking-wider text-syspink">
                          If you proceed anyway
                        </div>
                        <p className="mt-1 text-sm text-muted">{hold.ifProceeding}</p>
                      </div>
                    )}

                    <div className="mt-3.5 flex flex-wrap justify-end gap-2">
                      <Button
                        size="sm"
                        onClick={() =>
                          void resolve(
                            hold,
                            'cancelled',
                            'Cancelled — the action will not be taken.',
                          )
                        }
                        disabled={busy === hold.id}
                      >
                        Cancel the request
                      </Button>
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => void resolve(hold, 'took_alternative', hold.resolution)}
                        disabled={busy === hold.id}
                      >
                        I took the safer route
                      </Button>
                    </div>
                    <p className="mt-2 text-right text-xs text-faint">
                      Resolving records who cleared this and why. It does not execute anything.
                    </p>
                  </Card>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-1 text-sm font-semibold">Decision record</h2>
        <p className="mb-2.5 text-xs text-faint">
          Every consequential action, with the evidence that was on screen at the time.
          Reconstructable — nothing here is regenerated after the fact.
        </p>
        {records === null ? (
          // A skeleton, not "Reading the record…": the shape of the trail is
          // known, so holding it stops the page jumping when rows land.
          <SkeletonRegion label="Loading the decision record">
            <SkeletonCards count={3} lines={1} />
          </SkeletonRegion>
        ) : records.length === 0 ? (
          <NoticeBlock icon="info">
            No consequential decisions have been recorded yet. Records appear when an action is
            assessed before it runs — for example, deleting a record other records depend on.
          </NoticeBlock>
        ) : (
          <div className="space-y-2">
            {records.map((r, i) => (
              <motion.div
                key={r.id}
                variants={listItemVariants}
                initial="initial"
                animate="animate"
                transition={{ ...TRANSITION.quick, delay: staggerDelay(i) }}
              >
                <Card variant="hairline" className="!py-3">
                  <button
                    type="button"
                    className="flex w-full items-start justify-between gap-3 text-left"
                    onClick={() => setExpanded((cur) => (cur === r.id ? null : r.id))}
                    aria-expanded={expanded === r.id}
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{r.requestedAction}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-faint">
                        <span>{formatWhen(r.at)}</span>
                        <span>·</span>
                        <span>{r.actor ?? 'this device'}</span>
                        <span>·</span>
                        <span className={r.outcome === 'proceeded' ? 'text-syspink' : ''}>
                          {HOLD_OUTCOME_LABELS[r.outcome]}
                        </span>
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full border border-[var(--hairline)] px-2 py-0.5 text-[11px] text-muted">
                      {DECISION_RISK_LABELS[r.assessment.risk]}
                    </span>
                  </button>

                  <AnimatePresence initial={false}>
                    {expanded === r.id && (
                      // Height animation, not a hard show/hide: the evidence is
                      // the reason someone opened the row, and having it appear
                      // by shoving the rest of the list down loses their place.
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={TRANSITION.quick}
                        className="overflow-hidden"
                      >
                        <div className="mt-3 space-y-2 border-t border-[var(--hairline)] pt-3">
                          <Line label="Subject" value={r.subject} />
                          <Line
                            label="Recommendation"
                            value={`${DECISION_RISK_RECOMMENDATIONS[r.assessment.risk]} — ${r.assessment.recommendation}`}
                          />
                          <div>
                            <div className="text-xs uppercase tracking-wider text-faint">
                              Evidence at the time
                            </div>
                            <ul className="mt-1 space-y-1">
                              {r.assessment.evidence.map((e, i) => (
                                <li key={i} className="text-sm text-muted">
                                  <span className="font-medium text-ink">{e.label}:</span>{' '}
                                  {e.detail}
                                </li>
                              ))}
                            </ul>
                          </div>
                          {r.assessment.alternative && (
                            <Line label="Alternative offered" value={r.assessment.alternative} />
                          )}
                          <Line label="What executed" value={r.executed} />
                          <Line label="Record id" value={r.id} />
                          {/* Wave-1 Increment-3 — reconstructable evidence timeline; unavailable facts are said,
                              never fabricated, and the external effect is never shown as verified. */}
                          <EvidenceTimeline
                            steps={buildEvidenceTimeline(
                              r,
                              r.holdId
                                ? ([...open, ...(view?.resolved ?? [])].find((h) => h.id === r.holdId) ?? null)
                                : null,
                            )}
                          />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </Card>
              </motion.div>
            ))}
          </div>
        )}
      </section>
    </ViewScroll>
  );
}

function Block({ title, items }: { title: string; items: readonly string[] }): JSX.Element {
  return (
    <div className="rounded-xl border border-[var(--hairline)] px-3.5 py-2.5">
      <div className="text-xs uppercase tracking-wider text-faint">{title}</div>
      <ul className="mt-1 space-y-1">
        {items.length === 0 ? (
          <li className="text-sm text-faint">—</li>
        ) : (
          items.map((item, i) => (
            <li key={i} className="text-sm text-muted">
              {item}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

/** Wave-1 Increment-3 — the reconstructable evidence timeline for one consequential decision. */
const FACT_TONE: Record<TimelineFact, string> = {
  OBSERVED: 'text-ink',
  NOT_OBSERVED: 'text-faint',
  NOT_VERIFIED: 'text-sysorange',
  NOT_AVAILABLE: 'text-faint',
};
const FACT_TAG: Record<TimelineFact, string> = {
  OBSERVED: '',
  NOT_OBSERVED: 'NOT OBSERVED',
  NOT_VERIFIED: 'NOT VERIFIED',
  NOT_AVAILABLE: 'NOT AVAILABLE',
};
function EvidenceTimeline({ steps }: { steps: readonly TimelineStep[] }): JSX.Element {
  return (
    <div className="mt-1">
      <div className="text-xs uppercase tracking-wider text-faint">Evidence timeline</div>
      <ol className="mt-1 space-y-1">
        {steps.map((s) => (
          <li key={s.key} className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="text-xs uppercase tracking-wider text-faint">{s.label}:</span>
            <span className={cn('min-w-0 break-words', FACT_TONE[s.fact])}>{s.value}</span>
            {FACT_TAG[s.fact] && (
              <span className="rounded-full border border-[var(--hairline)] px-1.5 text-[10px] uppercase tracking-wider text-faint">
                {FACT_TAG[s.fact]}
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * Wave-2 Increment-4 — the composed action lifecycle for one open hold. Correlated ONLY by authoritative ids
 * (session.decisionId ↔ hold.decisionId, session.id ↔ job.executionId, verdict.requestId ↔ session.decisionId),
 * same tenant only. If no session links, there is nothing authoritative to compose — say so, never guess.
 */
const LIFECYCLE_TONE: Record<LifecycleFact, string> = {
  OBSERVED: 'text-ink',
  NOT_OBSERVED: 'text-faint',
  NOT_VERIFIED: 'text-sysorange',
  NOT_AVAILABLE: 'text-faint',
  NOT_LINKED: 'text-faint',
};
const LIFECYCLE_TAG: Record<LifecycleFact, string> = {
  OBSERVED: '',
  NOT_OBSERVED: 'NOT OBSERVED',
  NOT_VERIFIED: 'NOT VERIFIED',
  NOT_AVAILABLE: 'NOT AVAILABLE',
  NOT_LINKED: 'NOT LINKED',
};
function LifecycleCard({
  hold,
  sessions,
  jobs,
}: {
  hold: HoldRecord;
  sessions: readonly ExecutionSession[];
  jobs: readonly Job[];
}): JSX.Element | null {
  const link = linkHoldToSession(hold, sessions);
  // Without an authoritative session link there is no governed chain to compose. The execution line above already
  // states NOT_LINKED honestly; inventing a lifecycle here would be exactly the guessing we refuse.
  if (link.linkState !== 'LINKED' || !link.session) return null;
  const job = correlateJobForSession(link.session, jobs);
  const proposal = correlateProposalForSession(link.session, job);
  const lifecycle = buildActionLifecycle({ session: link.session, job, proposal, hold });
  return (
    <details className="mt-2 rounded-xl border border-[var(--hairline)] px-3 py-2">
      <summary className="cursor-pointer text-xs font-medium text-muted">
        Full lifecycle — request → AI → proposal → approval → governance → execution → outcome
      </summary>
      <ol className="mt-2 space-y-1">
        {lifecycle.stages.map((s: LifecycleStage) => (
          <li key={s.key} className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="w-24 shrink-0 text-xs uppercase tracking-wider text-faint">{s.label}</span>
            <span className={cn('min-w-0 break-words', LIFECYCLE_TONE[s.fact])}>{s.value}</span>
            {LIFECYCLE_TAG[s.fact] && (
              <span className="rounded-full border border-[var(--hairline)] px-1.5 text-[10px] uppercase tracking-wider text-faint">
                {LIFECYCLE_TAG[s.fact]}
              </span>
            )}
          </li>
        ))}
      </ol>
      {/* Technical ids stay here — never credentials/tokens, which no record above carries. */}
      <div className="mt-2 border-t border-[var(--hairline)] pt-2 text-[11px] text-faint">
        <div>Decision id: {link.session.decisionId ?? '—'}</div>
        <div>Execution session: {link.session.id}</div>
        {job && <div>Job id: {job.id}</div>}
        {proposal && <div>Proposal id: {proposal.id}</div>}
      </div>
    </details>
  );
}

function Line({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-faint">{label}</div>
      <div className="mt-0.5 break-words text-sm text-muted">{value}</div>
    </div>
  );
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
