import { useCallback, useEffect, useState } from 'react';
import type {
  Briefing,
  BriefingPeriod,
  Recommendation,
  RecommendationPriority,
  RecommendationSet,
} from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/cn';
import { Icon } from '@renderer/components/ui/Icon';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { OpsPanel, Stat } from './primitives';
import { TINT_TONE, TEXT_TONE, type OpsTone } from './lib';

const PERIODS: { id: BriefingPeriod; label: string }[] = [
  { id: 'morning', label: 'Morning' },
  { id: 'evening', label: 'Evening' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'quarterly', label: 'Quarterly' },
];

const PRIORITY_TONE: Record<RecommendationPriority, OpsTone> = {
  high: 'red',
  normal: 'blue',
  low: 'gray',
};

function fmtTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function RecommendationRow({ r }: { r: Recommendation }): JSX.Element {
  const tone = PRIORITY_TONE[r.priority];
  return (
    <div className="flex items-start gap-3 rounded-xl border border-[var(--hairline)] p-3">
      <span className={cn('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', TINT_TONE[tone])}>
        <Icon name="lightbulb" size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-ink">{r.title}</p>
          <span className={cn('shrink-0 text-2xs font-medium uppercase tracking-wide', TEXT_TONE[tone])}>{r.priority}</span>
        </div>
        <p className="mt-0.5 text-xs text-muted">{r.rationale}</p>
        <p className="mt-1 text-2xs text-faint">
          {r.kind.replace(/_/g, ' ')} · {r.evidence.length} evidence
        </p>
      </div>
    </div>
  );
}

export function IntelligencePanel(): JSX.Element {
  const [period, setPeriod] = useState<BriefingPeriod>('morning');
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [recs, setRecs] = useState<RecommendationSet | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (p: BriefingPeriod) => {
    setLoading(true);
    try {
      const [b, r] = await Promise.all([ipc.intelligence.briefing(p), ipc.recommendations.generate({ limit: 12 })]);
      setBriefing(b);
      setRecs(r);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(period);
  }, [period, load]);

  const sections = briefing?.sections.filter((s) => !s.empty) ?? [];

  return (
    <div>
      <OpsPanel
        title="Daily Intelligence"
        subtitle="Evidence-grounded briefings computed from your connected work — every line cites its source."
        actions={
          <div className="flex items-center gap-1 rounded-xl border border-[var(--hairline)] p-0.5">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPeriod(p.id)}
                className={cn(
                  'rounded-lg px-2.5 py-1 text-xs font-medium transition',
                  period === p.id ? 'bg-[var(--fill-2)] text-ink' : 'text-muted hover:text-ink',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        }
      >
        {briefing && (
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat icon="sparkles" label="Headline" value={<span className="text-sm leading-snug">{briefing.headline}</span>} tone="accent" />
            <Stat icon="layers" label="Sections with activity" value={sections.length} tone="blue" />
            <Stat icon="check" label="Evidence cited" value={briefing.evidenceCount} tone="green" />
            <Stat
              icon={briefing.grounded ? 'database' : 'info'}
              label="Grounding"
              value={briefing.grounded ? 'Live data' : 'No data yet'}
              tone={briefing.grounded ? 'green' : 'orange'}
            />
          </div>
        )}

        {!loading && briefing && !briefing.grounded && (
          <EmptyState
            icon="database"
            title="No connected data yet"
            description="Connect and sync an account, then briefings fill in automatically from your real work. Nothing here is fabricated."
          />
        )}

        {briefing && briefing.grounded && sections.length === 0 && !loading && (
          <EmptyState icon="sparkles" title="A quiet period" description="No notable activity recorded for this window." compact />
        )}

        <div className="space-y-4">
          {sections.map((s) => (
            <div key={s.id} className="rounded-2xl border border-[var(--hairline)] p-4">
              <h3 className="mb-2 text-sm font-semibold text-ink">{s.title}</h3>
              <ul className="space-y-2">
                {s.items.map((it, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--fill-2)]" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-ink">{it.text}</p>
                      {it.detail && <p className="truncate text-xs text-muted">{it.detail}</p>}
                      <p className="text-2xs text-faint">
                        {[fmtTime(it.at), it.connectorId, `${it.evidence.length} evidence`].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </OpsPanel>

      <OpsPanel title="Recommendations" subtitle="Next actions derived from your data — each cites the records that triggered it.">
        {recs && recs.recommendations.length === 0 && (
          <EmptyState
            icon="lightbulb"
            title={recs.grounded ? 'Nothing needs attention' : 'No connected data yet'}
            description={
              recs.grounded
                ? 'No stale tasks, stalled projects, or upcoming deadlines were found.'
                : 'Recommendations appear once an account is connected and synced.'
            }
            compact
          />
        )}
        <div className="space-y-2">
          {recs?.recommendations.map((r) => <RecommendationRow key={r.id} r={r} />)}
        </div>
      </OpsPanel>
    </div>
  );
}
