import { useEffect, useState } from 'react';
import type {
  ExecutiveCard,
  ExecutiveCenterSnapshot,
  ExecutiveKpi,
  IntelligenceItem,
} from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/cn';
import { formatRelative } from '@renderer/lib/format';
import { useShell } from '@renderer/state/ShellProvider';
import { Icon } from '@renderer/components/ui/Icon';
import { Card } from '@renderer/components/ui/Card';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { Spinner } from '@renderer/components/Spinner';
import { OpsPanel } from '../operations/primitives';
import { TINT_TONE, TEXT_TONE, DOT_BG, type OpsTone } from '../operations/lib';
import { deepLinkToSection } from './executiveCenterNav';

/** Health band → the existing tone system (no new palette introduced). */
function bandTone(band: ExecutiveKpi['band']): OpsTone {
  switch (band) {
    case 'healthy':
      return 'green';
    case 'watch':
      return 'blue';
    case 'at-risk':
      return 'orange';
    case 'critical':
      return 'red';
    default:
      return 'gray';
  }
}

/** Item priority → tone. */
function priorityTone(p: IntelligenceItem['priority']): OpsTone {
  switch (p) {
    case 'critical':
      return 'red';
    case 'high':
      return 'orange';
    case 'normal':
      return 'blue';
    default:
      return 'gray';
  }
}

/**
 * The Executive Intelligence Center.
 *
 * Presentation only: it reads the V2.4 snapshot over IPC and renders a KPI strip
 * plus priority-sorted cards. Every KPI and card navigates into the existing
 * module via the shell — no duplicated detail views, no new intelligence.
 */
export function ExecutiveCenterPanel(): JSX.Element {
  const { setSection } = useShell();
  const [snapshot, setSnapshot] = useState<ExecutiveCenterSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    // On-demand read (no polling) — the snapshot is composed from live stores.
    ipc.intelligence
      .executiveCenterSnapshot()
      .then((s) => {
        if (alive) setSnapshot(s);
      })
      .catch(() => {
        if (alive) setError('Executive intelligence is unavailable right now.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const go = (deepLink: string | undefined): void => {
    setSection(deepLinkToSection(deepLink));
  };

  if (loading) {
    return (
      <OpsPanel title="Executive Intelligence" subtitle="Your organization at a glance">
        <div className="flex items-center justify-center py-20">
          <Spinner />
        </div>
      </OpsPanel>
    );
  }

  if (error || !snapshot) {
    return (
      <OpsPanel title="Executive Intelligence" subtitle="Your organization at a glance">
        <EmptyState
          icon="sparkles"
          title="Nothing to show yet"
          description={error ?? 'Connect a source or generate a brief to populate this view.'}
        />
      </OpsPanel>
    );
  }

  const { kpis, attentionCounts } = snapshot;
  const cards: ExecutiveCard[] = [
    snapshot.criticalAlerts,
    snapshot.founderRecommendations,
    snapshot.organizationHealth,
    snapshot.engineeringHealth,
    snapshot.upcomingPriorities,
    // V2.9 completion cards (rendered when present).
    snapshot.executiveTimeline,
    snapshot.recentDecisions,
    snapshot.recentDeliveries,
    snapshot.evidenceSummary,
  ].filter((c): c is ExecutiveCard => Boolean(c));

  return (
    <OpsPanel
      title="Executive Intelligence"
      subtitle={`${attentionCounts.critical} critical · ${attentionCounts.high} high · updated ${formatRelative(snapshot.generatedAt)}`}
    >
      {/* KPI strip — the instrument cluster. Each tile deep-links. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {kpis.map((k) => (
          <button
            key={k.key}
            onClick={() => go(k.deepLink)}
            className={cn(
              'group flex flex-col items-start rounded-xl border border-white/5 p-3 text-left transition',
              'hover:border-white/15 hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20',
              TINT_TONE[bandTone(k.band)],
            )}
          >
            <span className="text-[11px] font-medium uppercase tracking-wide text-white/50">
              {k.label}
            </span>
            <span className="mt-1 text-xl font-semibold tabular-nums">{k.display}</span>
            {k.band && (
              <span
                className={cn(
                  'mt-1 flex items-center gap-1.5 text-[11px]',
                  TEXT_TONE[bandTone(k.band)],
                )}
              >
                <span className={cn('h-1.5 w-1.5 rounded-full', DOT_BG[bandTone(k.band)])} />
                {k.band}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Section cards. Bold lives in the KPI strip; cards stay quiet + scannable. */}
      {/* NPDS A.3: migrated to <Card variant="flat"> — reproduces the prior inline
          surface (rounded-2xl border-white/5 bg-white/[0.02]) verbatim; flush + p-4
          preserve the exact prior padding. Pixel-identical to the hand-rolled shell. */}
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {cards.map((card) => (
          <Card key={card.key} variant="flat" flush className="p-4">
            <header className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold tracking-tight">{card.title}</h3>
                {card.summary && <p className="mt-0.5 text-xs text-white/45">{card.summary}</p>}
              </div>
              <button
                onClick={() => go(card.deepLink)}
                className="rounded-lg px-2 py-1 text-xs text-white/50 transition hover:bg-white/5 hover:text-white/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
              >
                Open <Icon name="arrow-right" className="ml-0.5 inline h-3 w-3" />
              </button>
            </header>

            {card.items.length === 0 ? (
              <p className="py-6 text-center text-xs text-white/30">Nothing to surface.</p>
            ) : (
              <ul className="space-y-2">
                {card.items.slice(0, 4).map((item) => (
                  <li
                    key={item.id}
                    className="flex items-start gap-2.5 rounded-lg border border-white/5 bg-white/[0.02] p-2.5"
                  >
                    <span
                      className={cn(
                        'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                        DOT_BG[priorityTone(item.priority)],
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">{item.title}</p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-white/45">{item.body}</p>
                      {item.governance && (
                        <p className="mt-1 text-[10px] text-white/30">
                          {Math.round(item.governance.confidence * 100)}% confidence ·{' '}
                          {item.governance.sourceSystems.slice(0, 2).join(', ')}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
                {card.items.length > 4 && (
                  <li className="pt-0.5 text-center text-[11px] text-white/35">
                    +{card.items.length - 4} more in{' '}
                    <button
                      onClick={() => go(card.deepLink)}
                      className="underline hover:text-white/60"
                    >
                      {card.title}
                    </button>
                  </li>
                )}
              </ul>
            )}
          </Card>
        ))}
      </div>
    </OpsPanel>
  );
}
