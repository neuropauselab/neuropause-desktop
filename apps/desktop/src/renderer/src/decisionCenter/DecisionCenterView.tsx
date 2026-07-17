/**
 * Experience Program v1.0 — Decision Center (the decision-first home). NOT a dashboard: a single screen that
 * compresses the whole platform into what a human needs to decide right now — a greeting, business health in
 * one sentence, today's mission, revenue, and the single most important decision, risk, and approval. It is
 * role-adaptive (eight roles) and progressively disclosed (Executive by default; expand to Management, then
 * Specialist). Intent replaces search. Everything else is one line and a compression count. Maximum
 * intelligence, minimum interface — AI compresses; the human decides.
 * Reads via `ipc.experience.*`; refreshes on the existing `ecosystem:event` broadcast.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ExperienceDecisions,
  ExperienceHome,
  ExperienceIntents,
  ExperienceRole,
  ExperienceSummaries,
  IntentItem,
} from '@neuropause/shared';
import { cn } from '@renderer/lib/cn';
import { Icon } from '@renderer/components/ui/Icon';
import { ipc } from '@renderer/lib/ipc';
import { bandTone, kindIcon, moduleIcon, roleIcon } from './decisionCenterModel';

const TONE_TEXT: Record<string, string> = { green: 'text-[color:var(--good,#22c55e)]', blue: 'text-[color:var(--accent,#6366f1)]', orange: 'text-[color:var(--warn,#f59e0b)]', red: 'text-[color:var(--bad,#ef4444)]' };
const TONE_DOT: Record<string, string> = { green: 'bg-[color:var(--good,#22c55e)]', blue: 'bg-[color:var(--accent,#6366f1)]', orange: 'bg-[color:var(--warn,#f59e0b)]', red: 'bg-[color:var(--bad,#ef4444)]' };

export function DecisionCenterView({ onOpenSection }: { onOpenSection?: (id: string) => void }): JSX.Element {
  const [ready, setReady] = useState(false);
  const [home, setHome] = useState<ExperienceHome | null>(null);
  const [decisions, setDecisions] = useState<ExperienceDecisions | null>(null);
  const [summaries, setSummaries] = useState<ExperienceSummaries | null>(null);
  const [intents, setIntents] = useState<ExperienceIntents | null>(null);
  const [role, setRole] = useState<ExperienceRole>('founder');
  const [expanded, setExpanded] = useState(false);
  const [intentQuery, setIntentQuery] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [h, d, s, i] = await Promise.all([ipc.experience.home(), ipc.experience.decisions(), ipc.experience.summaries(), ipc.experience.intents()]);
      setHome(h);
      setDecisions(d);
      setSummaries(s);
      setIntents(i);
    } catch {
      /* keep last snapshot */
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const off = ipc.experience.onEvent(() => void refresh());
    return off;
  }, [refresh]);

  const activeRole = useMemo(() => home?.roleViews.find((r) => r.role === role) ?? home?.roleViews[0], [home, role]);
  const matchedIntents = useMemo(() => {
    const q = intentQuery.trim().toLowerCase();
    const all = intents?.intents ?? [];
    if (!q) return all.slice(0, 6);
    return all.filter((i) => i.label.toLowerCase().includes(q) || i.keywords.some((k) => k.includes(q) || q.includes(k))).slice(0, 6);
  }, [intents, intentQuery]);

  const go = (section: string): void => onOpenSection?.(section);

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        <div className="animate-pulse text-lg">Composing your decisions…</div>
      </div>
    );
  }
  if (!home) {
    return <div className="flex h-full items-center justify-center text-muted">Nothing to decide right now.</div>;
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto px-10 py-12" style={{ maxWidth: 1080 }}>
        {/* ── Role selector ── */}
        <div className="mb-10 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {home.roleViews.map((rv) => (
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

        {/* ── Hero: greeting + business health in one sentence ── */}
        <div className="mb-3 text-md font-medium text-faint">{home.greeting}.</div>
        <h1 className="text-[2.6rem] font-semibold leading-[1.12] tracking-tight text-ink">{home.businessHealth.headline}</h1>
        <div className="mt-3 flex items-center gap-2 text-md text-muted">
          <span className={cn('inline-block h-2 w-2 rounded-full', TONE_DOT[bandTone(home.businessHealth.band)])} />
          {activeRole?.focus}
        </div>

        {/* ── Role KPIs (large numbers) ── */}
        {activeRole && (
          <div className="mt-10 grid grid-cols-1 gap-8 sm:grid-cols-3">
            {activeRole.kpis.map((k) => (
              <div key={k.label}>
                <div className="text-2xs uppercase tracking-wide text-faint">{k.label}</div>
                <div className={cn('mt-1 text-3xl font-semibold tracking-tight', TONE_TEXT[bandTone(k.band)])}>{k.display}</div>
              </div>
            ))}
          </div>
        )}

        {/* ── Today's mission (the one primary focus) ── */}
        <div className="mt-12 rounded-3xl border border-[var(--hairline)] bg-gradient-to-br from-white/[0.04] to-transparent p-7 backdrop-blur-sm">
          <div className="text-2xs uppercase tracking-wide text-faint">Today&apos;s mission</div>
          <div className="mt-2 text-2xl font-semibold leading-snug tracking-tight text-ink">{home.todaysMission.title}</div>
          <p className="mt-2 text-md text-muted">{home.todaysMission.detail}</p>
          {home.todaysMission.why && <p className="mt-1 text-sm text-faint">Why: {home.todaysMission.why}</p>}
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <div>
              <div className="text-2xs uppercase tracking-wide text-faint">{home.revenue.label}</div>
              <div className={cn('text-xl font-semibold', TONE_TEXT[bandTone(home.revenue.band)])}>{home.revenue.display}</div>
            </div>
            <div className="ml-auto text-sm text-muted">{home.aiWorkforce.headline}</div>
          </div>
        </div>

        {/* ── The three decisions that need a human ── */}
        <div className="mt-12">
          <div className="mb-4 text-2xs uppercase tracking-wide text-faint">Needs you</div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <DecideCard title="One decision" icon="sparkles" empty="No decision pending." tone={home.oneDecision ? bandTone(home.oneDecision.band) : 'green'} heading={home.oneDecision?.title} body={home.oneDecision?.why} meta={home.oneDecision ? `${home.oneDecision.requiredApprovals} approval(s) · ${home.oneDecision.evidenceCount} evidence` : undefined} onAct={home.oneDecision ? () => go('strategy-center') : undefined} actLabel="Review" />
            <DecideCard title="One risk" icon="shield" empty="No elevated risk." tone={home.oneRisk ? bandTone(home.oneRisk.band) : 'green'} heading={home.oneRisk?.title} body={home.oneRisk?.reason} meta={home.oneRisk ? `${home.oneRisk.domain} · risk ${home.oneRisk.risk}/100` : undefined} onAct={home.oneRisk ? () => go('auto-ops-center') : undefined} actLabel="Investigate" />
            <DecideCard title="One approval" icon="lock" empty="Nothing to approve." tone={home.oneApproval ? bandTone(home.oneApproval.band) : 'green'} heading={home.oneApproval?.title} body={home.oneApproval ? `From ${home.oneApproval.source}` : undefined} meta={home.oneApproval?.requestedBy ? `Requested by ${home.oneApproval.requestedBy}` : undefined} onAct={home.oneApproval ? () => go('auto-ops-center') : undefined} actLabel="Approve" />
          </div>
        </div>

        {/* ── Intent search (replaces navigation) ── */}
        <div className="mt-12">
          <div className="mb-3 text-2xs uppercase tracking-wide text-faint">What outcome are you trying to achieve?</div>
          <input
            type="text"
            value={intentQuery}
            onChange={(e) => setIntentQuery(e.target.value)}
            placeholder="I want to reduce costs…"
            className="w-full rounded-2xl border border-[var(--hairline)] bg-white/[0.03] px-5 py-3.5 text-lg text-ink outline-none transition-all placeholder:text-faint focus:border-[color:var(--accent,#6366f1)]"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            {matchedIntents.map((i: IntentItem) => (
              <button
                key={i.id}
                type="button"
                onClick={() => go(i.targetSection)}
                className="flex items-center gap-2 rounded-full border border-[var(--hairline)] px-3.5 py-2 text-2xs text-muted transition-all hover:border-[color:var(--accent,#6366f1)] hover:text-ink"
              >
                <span className="font-medium text-ink">{i.label}</span>
                <span className="text-faint">→ {i.targetLabel}</span>
                {!i.available && <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-faint">soon</span>}
              </button>
            ))}
          </div>
        </div>

        {/* ── Progressive disclosure: everything else is one line, expandable ── */}
        <div className="mt-12">
          <button type="button" onClick={() => setExpanded((v) => !v)} className="flex items-center gap-2 text-2xs uppercase tracking-wide text-faint transition-colors hover:text-muted">
            <Icon name={expanded ? 'chevron-down' : 'arrow-right'} size={13} />
            {expanded ? 'Hide detail' : `Show everything else (${home.compressedSignals.toLocaleString()} signals compressed)`}
          </button>
          {expanded && summaries && (
            <div className="mt-5 space-y-2">
              {summaries.modules.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => go(m.expandTo)}
                  className="flex w-full items-center gap-3 rounded-2xl border border-[var(--hairline)] px-4 py-3 text-left transition-all hover:bg-white/[0.03]"
                >
                  <span className={cn('inline-block h-2 w-2 shrink-0 rounded-full', TONE_DOT[bandTone(m.band)])} />
                  <Icon name={moduleIcon(m.key)} size={15} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">{m.headline}</span>
                    <span className="block text-2xs text-faint">{m.label} · {m.compressedFrom.toLocaleString()} items compressed</span>
                  </span>
                  <Icon name="arrow-right" size={14} />
                </button>
              ))}
              <div className="pt-2 text-2xs text-faint">
                Progressive disclosure: {summaries.disclosure.map((d) => `${d.name} (${d.timeToValue})`).join(' · ')}.
              </div>
            </div>
          )}
        </div>

        {/* ── Decision queue count (a queue, not a notification center) ── */}
        {decisions && decisions.total > 0 && (
          <div className="mt-8 flex items-center gap-2 text-2xs text-faint">
            <Icon name={kindIcon('decision')} size={12} />
            {decisions.total} decision{decisions.total === 1 ? '' : 's'} in your queue · {decisions.needApproval} need approval — compressed from {decisions.compressedFrom.toLocaleString()} signals.
          </div>
        )}
      </div>
    </div>
  );
}

function DecideCard(props: {
  title: string;
  icon: 'sparkles' | 'shield' | 'lock';
  empty: string;
  tone: string;
  heading?: string;
  body?: string;
  meta?: string;
  onAct?: () => void;
  actLabel: string;
}): JSX.Element {
  const has = Boolean(props.heading);
  return (
    <div className="flex min-h-[168px] flex-col rounded-3xl border border-[var(--hairline)] p-5">
      <div className="flex items-center gap-2">
        <span className={cn('inline-block h-2 w-2 rounded-full', has ? TONE_DOT[props.tone] : TONE_DOT.green)} />
        <span className="text-2xs uppercase tracking-wide text-faint">{props.title}</span>
      </div>
      {has ? (
        <>
          <div className="mt-3 text-md font-semibold leading-snug text-ink">{props.heading}</div>
          {props.body && <p className="mt-1.5 line-clamp-3 text-2xs text-muted">{props.body}</p>}
          {props.meta && <div className="mt-2 text-2xs text-faint">{props.meta}</div>}
          <button type="button" onClick={props.onAct} className="mt-auto flex items-center gap-1.5 pt-3 text-2xs font-medium text-[color:var(--accent,#6366f1)] hover:underline">
            {props.actLabel} <Icon name="arrow-right" size={12} />
          </button>
        </>
      ) : (
        <div className="mt-3 flex flex-1 items-center text-sm text-faint">{props.empty}</div>
      )}
    </div>
  );
}
