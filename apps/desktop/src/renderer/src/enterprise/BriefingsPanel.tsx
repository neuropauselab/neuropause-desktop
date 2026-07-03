import { useEffect, useState } from 'react';
import type { Briefing, BriefingPeriod, BriefingSectionId } from '@neuropause/shared';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { OpsPanel } from '@renderer/operations/primitives';
import { ipc } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/cn';
import { createLogger } from '@renderer/lib/logger';
import { useEnterprise } from './EnterpriseProvider';
import { relativeTime, TINT_TONE } from './lib';

const log = createLogger('briefings');

const PERIODS: { id: BriefingPeriod; label: string; icon: IconName }[] = [
  { id: 'morning', label: 'Morning Brief', icon: 'sun' },
  { id: 'evening', label: 'Evening Summary', icon: 'moon' },
  { id: 'weekly', label: 'Weekly Review', icon: 'analytics' },
  { id: 'monthly', label: 'Monthly Report', icon: 'doc' },
];

const SECTION_ICON: Record<BriefingSectionId, IconName> = {
  completed: 'check',
  in_progress: 'play',
  upcoming: 'clock',
  meetings: 'user',
  documents: 'doc',
  activity: 'activity',
  attention: 'info',
  release_health: 'package',
  pr_health: 'code',
  ci_health: 'pulse',
  engineering_risk: 'shield',
};

export function BriefingsPanel(): JSX.Element {
  const { recommendations } = useEnterprise();
  const [period, setPeriod] = useState<BriefingPeriod>('morning');
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void ipc.intelligence
      .briefing(period)
      .then((b) => { if (alive) setBriefing(b); })
      .catch((err) => log.error('Briefing failed', err))
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [period]);

  const activeLabel = PERIODS.find((p) => p.id === period)?.label ?? 'Briefing';
  const sections = briefing?.sections.filter((s) => !s.empty) ?? [];

  return (
    <div>
      <nav className="mb-5 flex flex-wrap gap-1.5">
        {PERIODS.map((p) => (
          <button key={p.id} type="button" onClick={() => setPeriod(p.id)} className={cn('inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition', period === p.id ? 'border-transparent surface-raised text-ink shadow-sm' : 'border-[var(--hairline)] text-muted hover:text-ink')}>
            <Icon name={p.icon} size={15} /> {p.label}
          </button>
        ))}
      </nav>

      {loading ? (
        <div className="rounded-2xl border border-dashed border-[var(--hairline)] p-10 text-center text-sm text-faint">Generating {activeLabel.toLowerCase()}…</div>
      ) : !briefing ? (
        <div className="rounded-2xl border border-[var(--hairline)] p-10 text-center text-sm text-muted">Could not generate this briefing.</div>
      ) : (
        <>
          {/* Headline */}
          <div className="mb-5 rounded-2xl border border-[var(--hairline)] surface-raised p-5 shadow-card">
            <div className="flex items-center gap-2">
              <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg', TINT_TONE.accent)}><Icon name="sparkles" size={16} /></span>
              <div>
                <div className="text-2xs font-medium uppercase tracking-wider text-faint">{activeLabel} · {new Date(briefing.generatedAt).toLocaleString()}</div>
              </div>
              <span className={cn('ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-2xs font-semibold', briefing.grounded ? 'bg-sysgreen/15 text-sysgreen' : 'bg-sysorange/15 text-sysorange')}>
                <Icon name={briefing.grounded ? 'verified' : 'info'} size={12} /> {briefing.grounded ? 'Grounded in evidence' : 'No connected data'}
              </span>
            </div>
            <p className="mt-3 text-lg font-medium tracking-tight text-ink">{briefing.headline}</p>
            <p className="mt-1 text-2xs text-faint">{briefing.evidenceCount} evidence reference(s) · covering {new Date(briefing.range.since).toLocaleDateString()} → {new Date(briefing.range.until).toLocaleDateString()}</p>
          </div>

          {/* Facts */}
          <div className="mb-2 flex items-center gap-2">
            <span className="text-2xs font-semibold uppercase tracking-wider text-faint">Facts</span>
            <span className="text-2xs text-faint">— observed from your organization’s evidence</span>
          </div>
          {!briefing.grounded || sections.length === 0 ? (
            <div className="mb-6 rounded-2xl border border-dashed border-[var(--hairline)] p-8 text-center text-sm text-faint">
              There is no connected evidence to brief on for this period yet. Connect tools and run AI workers, and this report will fill with grounded facts — never invented.
            </div>
          ) : (
            <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
              {sections.map((s) => (
                <OpsPanel key={s.id} title={s.title} subtitle={`${s.items.length} item(s)`}>
                  <ul className="space-y-2">
                    {s.items.map((item, i) => (
                      <li key={i} className="flex items-start gap-2.5 rounded-xl border border-[var(--hairline)] p-3">
                        <span className={cn('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md', TINT_TONE.blue)}><Icon name={SECTION_ICON[s.id]} size={12} /></span>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-ink">{item.text}</div>
                          {item.detail && <div className="truncate text-2xs text-faint">{item.detail}</div>}
                          <div className="mt-0.5 flex items-center gap-2 text-2xs text-faint">
                            {item.at && <span>{relativeTime(item.at)}</span>}
                            {item.evidence.length > 0 && <span>· {item.evidence.length} source(s)</span>}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </OpsPanel>
              ))}
            </div>
          )}

          {/* Recommendations — clearly separated from facts */}
          <div className="mb-2 flex items-center gap-2">
            <span className="text-2xs font-semibold uppercase tracking-wider text-faint">Recommendations</span>
            <span className="text-2xs text-faint">— suggested next actions, not statements of fact</span>
          </div>
          <OpsPanel title="" subtitle={undefined}>
            {recommendations.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--hairline)] p-5 text-center text-sm text-faint">No recommendations for this period.</div>
            ) : (
              <ul className="space-y-2">
                {recommendations.slice(0, 6).map((r) => (
                  <li key={r.id} className="flex items-start gap-2.5 rounded-xl border border-[var(--hairline)] p-3">
                    <span className={cn('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md', TINT_TONE.accent)}><Icon name="lightbulb" size={12} /></span>
                    <div className="min-w-0 flex-1">
                      <span className="text-sm text-ink">{r.title}</span>
                      <span className="block truncate text-2xs text-faint">{r.rationale}</span>
                    </div>
                    <span className={cn('shrink-0 text-2xs font-semibold uppercase', r.priority === 'high' ? 'text-syspink' : r.priority === 'normal' ? 'text-sysblue' : 'text-faint')}>{r.priority}</span>
                  </li>
                ))}
              </ul>
            )}
          </OpsPanel>

          <p className="mt-2 text-center text-2xs text-faint">Reports are computed deterministically from available evidence. Facts are observed; recommendations are suggestions.</p>
        </>
      )}
    </div>
  );
}
