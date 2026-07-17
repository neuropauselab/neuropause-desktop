/**
 * Intent Experience Program v2.0 — Intent Home (the intent-native front door). NOT a module dashboard: the
 * app organizes around the user's current OUTCOME. It never asks "What module?" — it shows Today's Intent
 * (the outcome that most needs you now), a role-filtered board of every active outcome, and — when you focus
 * an intent — a dynamic workspace assembled from that intent's REAL facets (objectives, timeline, evidence,
 * dependencies, linked decisions) plus the one real Next Best Action. Every value traces to a real strategic
 * goal; panels with no real per-intent source are withheld, never faked. Reads via `ipc.intent.*`; refreshes
 * on the existing `ecosystem:event` broadcast.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  IntentBoard,
  IntentGovernance,
  IntentRole,
  IntentSummary,
  IntentWorkspace,
  IntentWorkspaces,
} from '@neuropause/shared';
import { cn } from '@renderer/lib/cn';
import { Icon } from '@renderer/components/ui/Icon';
import { ipc } from '@renderer/lib/ipc';
import { bandTone, categoryIcon, categoryLabel, pctText, roleIcon, statusLabel, statusTone } from './intentHomeModel';

const TONE_TEXT: Record<string, string> = { green: 'text-[color:var(--good,#22c55e)]', blue: 'text-[color:var(--accent,#6366f1)]', orange: 'text-[color:var(--warn,#f59e0b)]', red: 'text-[color:var(--bad,#ef4444)]' };
const TONE_DOT: Record<string, string> = { green: 'bg-[color:var(--good,#22c55e)]', blue: 'bg-[color:var(--accent,#6366f1)]', orange: 'bg-[color:var(--warn,#f59e0b)]', red: 'bg-[color:var(--bad,#ef4444)]' };
const TONE_BAR: Record<string, string> = { green: 'var(--good,#22c55e)', blue: 'var(--accent,#6366f1)', orange: 'var(--warn,#f59e0b)', red: 'var(--bad,#ef4444)' };

function ProgressBar({ pct, tone }: { pct: number; tone: string }): JSX.Element {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: TONE_BAR[tone] }} />
    </div>
  );
}

function Panel({ title, icon, children }: { title: string; icon: Parameters<typeof Icon>[0]['name']; children: React.ReactNode }): JSX.Element {
  return (
    <div className="rounded-3xl border border-[var(--hairline)] p-5">
      <div className="mb-3 flex items-center gap-2 text-2xs uppercase tracking-wide text-faint">
        <Icon name={icon} size={13} />
        {title}
      </div>
      {children}
    </div>
  );
}

export function IntentHomeView({ onOpenSection }: { onOpenSection?: (id: string) => void }): JSX.Element {
  const [ready, setReady] = useState(false);
  const [board, setBoard] = useState<IntentBoard | null>(null);
  const [workspaces, setWorkspaces] = useState<IntentWorkspaces | null>(null);
  const [governance, setGovernance] = useState<IntentGovernance | null>(null);
  const [role, setRole] = useState<IntentRole>('founder');
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [showProvenance, setShowProvenance] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [b, w, g] = await Promise.all([ipc.intent.board(), ipc.intent.workspaces(), ipc.intent.governance()]);
      setBoard(b);
      setWorkspaces(w);
      setGovernance(g);
    } catch {
      /* keep last snapshot */
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const off = ipc.intent.onEvent(() => void refresh());
    return off;
  }, [refresh]);

  const roleView = useMemo(() => board?.roleViews.find((r) => r.role === role) ?? board?.roleViews[0], [board, role]);
  const byId = useMemo(() => new Map((board?.intents ?? []).map((i) => [i.id, i])), [board]);
  const visibleIntents = useMemo<IntentSummary[]>(
    () => (roleView?.intentIds ?? []).map((id) => byId.get(id)).filter((i): i is IntentSummary => Boolean(i)),
    [roleView, byId],
  );
  const focusId = focusedId && visibleIntents.some((i) => i.id === focusedId) ? focusedId : visibleIntents[0]?.id ?? null;
  const focused = useMemo<IntentWorkspace | null>(
    () => workspaces?.workspaces.find((w) => w.intentId === focusId) ?? null,
    [workspaces, focusId],
  );

  const go = (section: string): void => onOpenSection?.(section);

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        <div className="animate-pulse text-lg">Assembling your outcomes…</div>
      </div>
    );
  }
  if (!board || board.intents.length === 0) {
    return <div className="flex h-full items-center justify-center text-muted">No active outcomes yet — the platform is tracking your strategy goals.</div>;
  }

  const fi = focused?.intent;
  // Honesty: the hero only claims "what most needs you now" when it is showing the genuine top-ranked
  // outcome in this lens. If the user manually focuses a lower-priority card, the eyebrow says so instead.
  const isTopFocus = focusId === visibleIntents[0]?.id;
  // Risks for the focused outcome, derived from its REAL status + its REAL blocking dependencies.
  const focusRisks: { key: string; label: string; detail: string; tone: string }[] = [];
  if (fi && fi.status !== 'on_track') {
    focusRisks.push({ key: 'self', label: `This outcome is ${statusLabel(fi.status).toLowerCase()}`, detail: `${fi.successMetric} — now ${fi.current}${fi.unit === '%' ? '%' : ` ${fi.unit}`} of ${fi.target}.`, tone: statusTone(fi.status) });
  }
  for (const dep of focused?.dependencies.filter((d) => d.blocking) ?? []) {
    focusRisks.push({ key: `dep:${dep.id}`, label: `Blocked by "${dep.name}"`, detail: `A dependency is ${statusLabel(dep.status).toLowerCase()}.`, tone: statusTone(dep.status) });
  }
  const nba = focused?.nextBestAction ?? null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto px-10 py-12" style={{ maxWidth: 1120 }}>
        {/* ── Role selector (a role emphasizes real outcomes; it never invents one) ── */}
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {board.roleViews.map((rv) => (
              <button
                key={rv.role}
                type="button"
                onClick={() => setRole(rv.role)}
                className={cn('flex items-center gap-1.5 rounded-full px-3 py-1.5 text-2xs font-medium transition-all', role === rv.role ? 'bg-white/[0.10] text-ink shadow-sm' : 'text-faint hover:text-muted')}
              >
                <Icon name={roleIcon(rv.role)} size={13} />
                {rv.label}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => void refresh()} aria-label="Refresh" className="flex h-8 w-8 items-center justify-center rounded-lg text-faint hover:text-ink">
            <Icon name="refresh" size={15} />
          </button>
        </div>

        {/* ── Outcome counts (real GoalManager statuses) ── */}
        <div className="mb-10 flex flex-wrap items-center gap-x-6 gap-y-2 text-2xs text-faint">
          <span><span className="font-semibold text-ink">{board.counts.total}</span> outcomes</span>
          <span className={TONE_TEXT.green}>{board.counts.onTrack} on track</span>
          <span className={TONE_TEXT.orange}>{board.counts.atRisk} at risk</span>
          <span className={TONE_TEXT.red}>{board.counts.offTrack} off track</span>
          {board.counts.blocked > 0 && <span className={TONE_TEXT.orange}>{board.counts.blocked} blocked</span>}
          <span className="ml-auto">Overall progress <span className="font-semibold text-ink">{board.overallProgressPct}%</span></span>
          <span title="Board-level confidence from the P14 Reasoning Engine — not a per-intent figure.">Strategic reasoning confidence <span className="font-semibold text-ink">{pctText(board.reasoningConfidence)}</span></span>
        </div>

        {fi && (
          <>
            {/* ── Today's Intent (the outcome that most needs you now) — or the outcome you focused ── */}
            <div className="mb-2 flex items-center gap-2 text-2xs uppercase tracking-wide text-faint">
              <Icon name="command" size={13} />
              {isTopFocus
                ? `${role === 'founder' ? "Today's Intent" : `Today's Intent · ${roleView?.label}`} — what most needs you now`
                : 'Focused outcome — you selected this'}
            </div>
            <h1 className="text-[2.5rem] font-semibold leading-[1.12] tracking-tight text-ink">{fi.name}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-md text-muted">
              <span className={cn('inline-block h-2 w-2 rounded-full', TONE_DOT[statusTone(fi.status)])} />
              <span className={TONE_TEXT[statusTone(fi.status)]}>{statusLabel(fi.status)}</span>
              <span className="text-faint">·</span>
              <span>{fi.successMetric}</span>
            </div>

            {/* ── Progress + meta ── */}
            <div className="mt-7 flex flex-wrap items-end gap-x-10 gap-y-4">
              <div className="min-w-[240px] flex-1">
                <div className="mb-1.5 flex items-baseline justify-between">
                  <span className="text-2xs uppercase tracking-wide text-faint">Progress toward outcome</span>
                  <span className={cn('text-2xl font-semibold tracking-tight', TONE_TEXT[bandTone(fi.band)])}>{fi.progressPct}%</span>
                </div>
                <ProgressBar pct={fi.progressPct} tone={bandTone(fi.band)} />
                <div className="mt-1.5 text-2xs text-faint">Now {fi.current}{fi.unit === '%' ? '%' : ` ${fi.unit}`} · target {fi.target}{fi.unit === '%' ? '%' : ` ${fi.unit}`}</div>
              </div>
              <div className="flex flex-wrap items-center gap-5 text-2xs text-faint">
                <span className="flex items-center gap-1.5"><Icon name={categoryIcon(fi.category)} size={13} />{categoryLabel(fi.category)}</span>
                <span className="flex items-center gap-1.5"><Icon name="arrow-right" size={12} />Target horizon {fi.horizonLabel}</span>
                <span>{fi.evidenceCount} evidence signal{fi.evidenceCount === 1 ? '' : 's'}</span>
                {fi.blocked && <span className={TONE_TEXT.orange}>Blocked by {fi.blockedBy.join(', ')}</span>}
              </div>
            </div>

            {/* ── Next best action (every screen answers "what next?") ── */}
            <div className="mt-8 flex flex-wrap items-center gap-4 rounded-3xl border border-[color:var(--accent,#6366f1)]/30 bg-gradient-to-br from-[color:var(--accent,#6366f1)]/[0.10] to-transparent p-6">
              <div className="min-w-0 flex-1">
                <div className="text-2xs uppercase tracking-wide text-faint">Next best action</div>
                {nba ? (
                  <>
                    <div className="mt-1 text-lg font-semibold leading-snug text-ink">{nba.label}</div>
                    <div className="mt-1 text-2xs text-muted">
                      {nba.approval
                        ? nba.approval.governed
                          ? `Requires approval — ${nba.approval.chainName} (${nba.approval.steps} step${nba.approval.steps === 1 ? '' : 's'}).`
                          : 'No approval chain governs this action yet — it would need one before execution.'
                        : 'Advisory step — routed through the existing approval and execution engines.'}
                    </div>
                  </>
                ) : (
                  <div className="mt-1 text-lg font-semibold leading-snug text-ink">This outcome is on track — no action needed right now.</div>
                )}
              </div>
              <button
                type="button"
                onClick={() => go('strategy-center')}
                className="flex items-center gap-1.5 rounded-xl bg-[color:var(--accent,#6366f1)] px-4 py-2.5 text-sm font-medium text-white transition-all hover:opacity-90"
              >
                Open in Strategy Center <Icon name="arrow-right" size={14} />
              </button>
            </div>

            {/* ── Intent dashboard: Risks / Approvals / Recommendations (real, per-intent) ── */}
            <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
              <Panel title="Risks" icon="shield">
                {focusRisks.length === 0 ? (
                  <div className="text-sm text-faint">On track — no elevated risks for this outcome.</div>
                ) : (
                  <div className="space-y-2.5">
                    {focusRisks.map((r) => (
                      <div key={r.key} className="flex gap-2">
                        <span className={cn('mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full', TONE_DOT[r.tone])} />
                        <span className="min-w-0">
                          <span className="block text-sm text-ink">{r.label}</span>
                          <span className="block text-2xs text-faint">{r.detail}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>

              <Panel title="Approvals" icon="lock">
                {nba?.approval ? (
                  <div className="space-y-1">
                    <div className="text-sm text-ink">{nba.approval.governed ? nba.approval.chainName : 'No governing chain yet'}</div>
                    <div className="text-2xs text-faint">{nba.approval.note}</div>
                    {nba.approval.governed && <div className="text-2xs text-faint">{nba.approval.steps} approval step{nba.approval.steps === 1 ? '' : 's'}.</div>}
                  </div>
                ) : (
                  <div className="text-sm text-faint">No approval required for the next step on this outcome.</div>
                )}
              </Panel>

              <Panel title="Recommendations" icon="lightbulb">
                {focused && focused.relatedDecisions.length > 0 ? (
                  <div className="space-y-2.5">
                    {focused.relatedDecisions.slice(0, 3).map((d) => (
                      <div key={d.id} className="flex gap-2">
                        <span className={cn('mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full', TONE_DOT[bandTone(d.band)])} />
                        <span className="min-w-0">
                          <span className="block text-sm text-ink">{d.title}</span>
                          <span className="block text-2xs text-faint">{d.recommendation}</span>
                          <span className="block text-2xs text-faint">Confidence {pctText(d.confidence)}{d.requiresApproval ? ' · needs approval' : ''}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-faint">No strategic decisions are linked to this outcome right now.</div>
                )}
              </Panel>
            </div>

            {/* ── Dynamic workspace: assembled only from real per-intent facets ── */}
            {focused && (
              <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
                {focused.objectives.length > 0 && (
                  <Panel title="Objectives" icon="analytics">
                    <div className="space-y-3">
                      {focused.objectives.map((o) => (
                        <div key={o.id}>
                          <div className="mb-1 flex items-baseline justify-between gap-3">
                            <span className="min-w-0 truncate text-sm text-ink">{o.label}</span>
                            <span className={cn('shrink-0 text-2xs font-medium', TONE_TEXT[bandTone(o.band)])}>{o.progressPct}%</span>
                          </div>
                          <ProgressBar pct={o.progressPct} tone={bandTone(o.band)} />
                          <div className="mt-1 text-2xs text-faint">{o.metric}: {o.current}{o.unit === '%' ? '%' : ` ${o.unit}`} / {o.target}{o.unit === '%' ? '%' : ` ${o.unit}`}</div>
                        </div>
                      ))}
                    </div>
                  </Panel>
                )}

                {focused.timeline.length > 0 && (
                  <Panel title="Timeline" icon="pulse">
                    <div className="space-y-2">
                      {focused.timeline.map((m) => (
                        <div key={m.id} className="flex items-center gap-2.5">
                          <span className={cn('inline-block h-1.5 w-1.5 shrink-0 rounded-full', TONE_DOT[bandTone(m.band)])} />
                          <span className="min-w-0 flex-1 truncate text-sm text-ink">{m.label}</span>
                          <span className="shrink-0 text-2xs text-faint">{m.horizonLabel} · {statusLabel(m.status)}</span>
                        </div>
                      ))}
                    </div>
                  </Panel>
                )}

                {focused.dependencies.length > 0 && (
                  <Panel title="Dependencies" icon="grid">
                    <div className="space-y-2">
                      {focused.dependencies.map((d) => (
                        <div key={d.id} className="flex items-center gap-2.5">
                          <span className={cn('inline-block h-1.5 w-1.5 shrink-0 rounded-full', TONE_DOT[statusTone(d.status)])} />
                          <span className="min-w-0 flex-1 truncate text-sm text-ink">{d.name}</span>
                          <span className={cn('shrink-0 text-2xs', d.blocking ? TONE_TEXT.orange : 'text-faint')}>{d.blocking ? 'Blocking' : statusLabel(d.status)}</span>
                        </div>
                      ))}
                    </div>
                  </Panel>
                )}

                {focused.evidence.length > 0 && (
                  <Panel title="Evidence" icon="globe">
                    <div className="flex flex-wrap gap-1.5">
                      {focused.evidence.slice(0, 12).map((e) => (
                        <span key={e} className="rounded-full border border-[var(--hairline)] px-2.5 py-1 font-mono text-[10px] text-muted">{e}</span>
                      ))}
                    </div>
                    <div className="mt-2 text-2xs text-faint">Real platform signal ids backing this outcome&apos;s current value.</div>
                  </Panel>
                )}
              </div>
            )}

            {/* ── Authenticity: what this workspace deliberately does NOT show ── */}
            {focused && focused.omitted.length > 0 && (
              <div className="mt-4 rounded-2xl border border-[var(--hairline)] bg-white/[0.02] px-4 py-3 text-2xs text-faint">
                <span className="font-medium text-muted">Not shown for this outcome (no real per-intent source): </span>
                {focused.omitted.map((o) => o.split(' — ')[0]).join(' · ')}. These panels are withheld rather than fabricated.
              </div>
            )}
          </>
        )}

        {/* ── Multi-intent board: every active outcome, role-filtered ── */}
        <div className="mt-14">
          <div className="mb-4 flex items-center gap-2 text-2xs uppercase tracking-wide text-faint">
            <Icon name="layers" size={13} />
            {role === 'founder' ? 'Your outcomes' : `${roleView?.label} outcomes`} — pick one to focus its workspace
          </div>
          {visibleIntents.length === 0 ? (
            <div className="rounded-2xl border border-[var(--hairline)] px-4 py-6 text-center text-sm text-faint">No outcomes in this lens right now.</div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {visibleIntents.map((i) => (
                <button
                  key={i.id}
                  type="button"
                  onClick={() => setFocusedId(i.id)}
                  className={cn(
                    'flex flex-col rounded-3xl border p-5 text-left transition-all',
                    i.id === focusId ? 'border-[color:var(--accent,#6366f1)] bg-white/[0.04]' : 'border-[var(--hairline)] hover:bg-white/[0.03]',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className={cn('inline-block h-2 w-2 rounded-full', TONE_DOT[statusTone(i.status)])} />
                    <span className={cn('text-2xs font-medium', TONE_TEXT[statusTone(i.status)])}>{statusLabel(i.status)}</span>
                    <Icon name={categoryIcon(i.category)} size={12} />
                    <span className="ml-auto text-2xs text-faint">{i.horizonLabel}</span>
                  </div>
                  <div className="mt-2.5 text-md font-semibold leading-snug text-ink">{i.name}</div>
                  <p className="mt-1 line-clamp-2 text-2xs text-muted">{i.description}</p>
                  <div className="mt-3">
                    <div className="mb-1 flex items-baseline justify-between">
                      <span className="text-2xs text-faint">{i.successMetric}</span>
                      <span className={cn('text-2xs font-medium', TONE_TEXT[bandTone(i.band)])}>{i.progressPct}%</span>
                    </div>
                    <ProgressBar pct={i.progressPct} tone={bandTone(i.band)} />
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-2xs text-faint">
                    {i.blocked ? (
                      <span className={TONE_TEXT.orange}>Blocked by {i.blockedBy.join(', ')}</span>
                    ) : i.nextAction ? (
                      <span className="min-w-0 truncate">Next: {i.nextAction}</span>
                    ) : (
                      <span>On track</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Authenticity ledger: every value is real ── */}
        {governance && (
          <div className="mt-12 border-t border-[var(--hairline)] pt-6">
            <button type="button" onClick={() => setShowProvenance((v) => !v)} className="flex items-center gap-2 text-2xs uppercase tracking-wide text-faint transition-colors hover:text-muted">
              <Icon name={showProvenance ? 'chevron-down' : 'arrow-right'} size={13} />
              How this is built — every value traces to a real source
            </button>
            {showProvenance && (
              <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-2">
                <div>
                  <div className="mb-2 text-2xs uppercase tracking-wide text-faint">Provenance</div>
                  <div className="space-y-1.5">
                    {governance.provenance.map((p) => (
                      <div key={p.field} className="text-2xs">
                        <span className="text-ink">{p.field}</span>
                        <span className="text-faint"> ← {p.source}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="mb-2 text-2xs uppercase tracking-wide text-faint">Deliberately omitted (never fabricated)</div>
                  <div className="space-y-1.5">
                    {governance.omissions.map((o) => (
                      <div key={o.item} className="text-2xs">
                        <span className="text-ink">{o.item}</span>
                        <span className="text-faint"> — {o.reason}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
