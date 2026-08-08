import { useMemo, useState } from 'react';
import { cn } from '@renderer/lib/cn';
import { Icon } from '@renderer/components/ui/Icon';
import { SegmentedTabs, type SegmentedTabItem } from '@renderer/components/ui/pillTabs';
import { OpsCenterProvider, useOpsCenter } from './OpsCenterProvider';
import { headline, relativeTime, sortedRecommendations, type OpsCenterTab } from './opsModel';
import { ErrorBlock, LoadingBlock } from './primitives';
import { HealthPanel, HomePanel, IntelligencePanel } from './panels/DashboardPanels';
import { CapacityPanel, IncidentPanel, RecommendationPanel, RiskPanel } from './panels/CenterPanels';
import { ChangeImpactPanel, DependencyPanel, GraphPanel, RootCausePanel } from './panels/ExplorerPanels';
import { DiagnosticsPanel, SearchPanel, TimelinePanel } from './panels/SystemPanels';
// Phase 6 Stage 9 — the Enterprise Operations Platform tab (read-only eops:* composition).
import { EopsPlatformTab } from '../operationsPlatform/EopsPlatformTab';

/** The Operations Center, mounted with its live intelligence provider. */
export function OpsCenterRoot(): JSX.Element {
  return (
    <OpsCenterProvider>
      <OpsCenterInner />
    </OpsCenterProvider>
  );
}

function OpsCenterInner(): JSX.Element {
  const { report, loading, error, refreshing, loadedAt, nowMs, refresh } = useOpsCenter();
  const [tab, setTab] = useState<OpsCenterTab>('home');

  const tabs = useMemo<SegmentedTabItem<OpsCenterTab>[]>(() => {
    const h = report ? headline(report) : null;
    const criticalRecs = report ? sortedRecommendations(report.recommendations).filter((r) => r.priority === 'critical' || r.priority === 'high').length : 0;
    return [
      { id: 'home', label: 'Home', icon: 'home' },
      { id: 'intelligence', label: 'Intelligence', icon: 'sparkles' },
      { id: 'health', label: 'Health', icon: 'heart' },
      { id: 'risk', label: 'Risk', icon: 'shield' },
      { id: 'capacity', label: 'Capacity', icon: 'gauge' },
      { id: 'incidents', label: 'Incidents', icon: 'pulse', count: h?.openIncidents || undefined },
      { id: 'recommendations', label: 'Actions', icon: 'lightbulb', count: criticalRecs || undefined },
      { id: 'dependencies', label: 'Dependencies', icon: 'connectors', count: h?.spofCount || undefined },
      { id: 'impact', label: 'Change Impact', icon: 'bolt' },
      { id: 'rootcause', label: 'Root Cause', icon: 'search' },
      { id: 'graph', label: 'Graph', icon: 'grid' },
      { id: 'timeline', label: 'Timeline', icon: 'clock' },
      { id: 'search', label: 'Search', icon: 'filter' },
      { id: 'diagnostics', label: 'Diagnostics', icon: 'activity' },
      // Phase 6 Stage 9 — services · SLA · readiness · incidents · continuity.
      { id: 'platform', label: 'Platform', icon: 'server' },
    ];
  }, [report]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto px-8 py-7" style={{ maxWidth: 1320 }}>
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Operations</h1>
            <p className="mt-1 text-md text-muted">
              The enterprise command center — health, risk, dependencies, capacity, incidents and root cause across the unified Enterprise Graph.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-faint">
              <span className="relative flex h-2 w-2">
                <span className={cn('absolute inline-flex h-full w-full rounded-full', report ? 'animate-ping bg-sysgreen opacity-60' : '')} />
                <span className={cn('relative inline-flex h-2 w-2 rounded-full', report ? 'bg-sysgreen' : 'bg-faint')} />
              </span>
              {refreshing ? 'Refreshing…' : report ? `Live${loadedAt ? ` · ${relativeTime(loadedAt, nowMs)}` : ''}` : 'Connecting…'}
            </span>
            <button
              type="button"
              aria-label="Refresh"
              title="Refresh"
              onClick={() => void refresh()}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted fill-hover hover:text-ink"
            >
              <Icon name="refresh" size={16} />
            </button>
          </div>
        </div>

        <div className="mb-6">
          <SegmentedTabs items={tabs} activeId={tab} onChange={setTab} ariaLabel="Operations Center sections" />
        </div>

        {loading && !report && <LoadingBlock />}
        {!loading && !report && error && <ErrorBlock message={error} onRetry={() => void refresh()} />}
        {report && (
          <>
            {tab === 'home' && <HomePanel report={report} nowMs={nowMs} onNavigate={setTab} />}
            {tab === 'intelligence' && <IntelligencePanel report={report} nowMs={nowMs} />}
            {tab === 'health' && <HealthPanel report={report} nowMs={nowMs} />}
            {tab === 'risk' && <RiskPanel report={report} nowMs={nowMs} />}
            {tab === 'capacity' && <CapacityPanel report={report} nowMs={nowMs} />}
            {tab === 'incidents' && <IncidentPanel report={report} nowMs={nowMs} />}
            {tab === 'recommendations' && <RecommendationPanel report={report} nowMs={nowMs} />}
            {tab === 'dependencies' && <DependencyPanel report={report} nowMs={nowMs} />}
            {tab === 'impact' && <ChangeImpactPanel report={report} nowMs={nowMs} />}
            {tab === 'rootcause' && <RootCausePanel report={report} nowMs={nowMs} />}
            {tab === 'graph' && <GraphPanel report={report} nowMs={nowMs} />}
            {tab === 'timeline' && <TimelinePanel report={report} nowMs={nowMs} />}
            {tab === 'search' && <SearchPanel />}
            {tab === 'diagnostics' && <DiagnosticsPanel report={report} nowMs={nowMs} />}
          </>
        )}
        {/* Phase 6 Stage 9 — the Platform tab loads its own eops:* reads and
            renders even when the P7 report is unavailable (honest isolation). */}
        {tab === 'platform' && <EopsPlatformTab />}
      </div>
    </div>
  );
}
