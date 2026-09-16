/**
 * The AI Sandbox workspace (P4 Validation Experience) — a dedicated, production-grade surface
 * over AI Sandbox v1.0 (S1–S6). A macOS-native shell: a header with a live indicator, an
 * Executive-mode switch and refresh, a global search box, a scrolling tab rail, and an animated
 * content region. Each section is a focused panel reading the shared SandboxProvider. No new
 * engine/store — every byte comes from the existing sandbox + validation channels.
 */
import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '@renderer/lib/cn';
import { Icon } from '@renderer/components/ui/Icon';
import { IconButton } from '@renderer/components/ui/Button';
import { SegmentedControl } from '@renderer/components/ui/controls';
import { SegmentedTabs, type SegmentedTabItem } from '@renderer/components/ui/pillTabs';
import { ViewScroll } from '@renderer/components/ui/Page';
import { SandboxProvider, useSandbox } from './SandboxProvider';
import {
  AiQaPanel,
  ArtifactsPanel,
  CertificationPanel,
  HistoryPanel,
  OverviewPanel,
  PerformancePanel,
  RegressionPanel,
  ScenariosPanel,
  SecurityPanel,
  SettingsPanel,
  ValidationPanel,
} from './panels';

type SandboxTab =
  | 'overview'
  | 'validation'
  | 'scenarios'
  | 'aiqa'
  | 'performance'
  | 'security'
  | 'regression'
  | 'certification'
  | 'artifacts'
  | 'history'
  | 'settings';

interface TabDef extends SegmentedTabItem<SandboxTab> {
  /** Tabs shown in Executive mode (a focused, decision-maker view). */
  exec?: boolean;
}

const TABS: TabDef[] = [
  { id: 'overview', label: 'Overview', icon: 'grid', exec: true },
  { id: 'validation', label: 'Validation', icon: 'play', exec: true },
  { id: 'certification', label: 'Certification', icon: 'verified', exec: true },
  { id: 'regression', label: 'Regression', icon: 'pulse' },
  { id: 'scenarios', label: 'Scenarios', icon: 'checklist' },
  { id: 'aiqa', label: 'AI QA', icon: 'sparkles' },
  { id: 'performance', label: 'Performance', icon: 'gauge' },
  { id: 'security', label: 'Security', icon: 'shield' },
  { id: 'artifacts', label: 'Artifacts', icon: 'folder' },
  { id: 'history', label: 'History', icon: 'clock', exec: true },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

const SEARCH_TABS = new Set<SandboxTab>(['validation', 'scenarios', 'history']);

function TabBody({ tab }: { tab: SandboxTab }): JSX.Element {
  switch (tab) {
    case 'overview':
      return <OverviewPanel />;
    case 'validation':
      return <ValidationPanel />;
    case 'certification':
      return <CertificationPanel />;
    case 'regression':
      return <RegressionPanel />;
    case 'scenarios':
      return <ScenariosPanel />;
    case 'aiqa':
      return <AiQaPanel />;
    case 'performance':
      return <PerformancePanel />;
    case 'security':
      return <SecurityPanel />;
    case 'artifacts':
      return <ArtifactsPanel />;
    case 'history':
      return <HistoryPanel />;
    case 'settings':
      return <SettingsPanel />;
  }
}

function SandboxInner(): JSX.Element {
  const { ready, error, executiveMode, setExecutiveMode, refreshAll, searchQuery, setSearchQuery, summary } = useSandbox();
  const [tab, setTab] = useState<SandboxTab>('overview');

  const tabs = useMemo(() => (executiveMode ? TABS.filter((t) => t.exec) : TABS), [executiveMode]);
  const effectiveTab: SandboxTab = tabs.some((t) => t.id === tab) ? tab : 'overview';
  const showSearch = SEARCH_TABS.has(effectiveTab);

  return (
    <ViewScroll max={1240}>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">AI Sandbox</h1>
          <p className="mt-1.5 max-w-[640px] text-md text-muted">
            Validate, certify, and inspect the platform — continuous validation, AI QA, performance &amp; security, and
            certification, in one workspace.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-faint">
            <span className="relative flex h-2 w-2">
              <span className={cn('absolute inline-flex h-full w-full rounded-full', ready ? 'animate-ping bg-white opacity-60' : '')} />
              <span className={cn('relative inline-flex h-2 w-2 rounded-full', ready ? 'bg-white' : 'bg-faint')} />
            </span>
            {ready ? 'Live' : 'Connecting…'}
          </span>
          <SegmentedControl<'standard' | 'exec'>
            size="sm"
            value={executiveMode ? 'exec' : 'standard'}
            onChange={(v) => setExecutiveMode(v === 'exec')}
            options={[
              { value: 'standard', label: 'Standard', icon: 'grid' },
              { value: 'exec', label: 'Executive', icon: 'user' },
            ]}
          />
          <IconButton icon="refresh" label="Refresh" onClick={() => void refreshAll()} />
        </div>
      </div>

      {error && (
        // D-7 — `role="alert"`: this banner is now the surface for refused WRITES
        // (generate report, toggle schedule), not just a passive note, so assistive
        // technology has to announce it rather than leave it to be noticed.
        <div
          role="alert"
          className="mb-4 flex items-center gap-2 rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] px-4 py-2.5 text-xs text-muted"
        >
          <Icon name="info" size={14} />
          {error}
        </div>
      )}

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <SegmentedTabs<SandboxTab> items={tabs} activeId={effectiveTab} onChange={setTab} ariaLabel="Sandbox sections" />
        {showSearch && (
          <label className="relative inline-flex items-center">
            <Icon name="search" size={14} className="pointer-events-none absolute left-2.5 text-faint" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`Search ${effectiveTab}…`}
              className="h-8 w-52 rounded-lg border border-[var(--hairline)] [background:var(--fill-1)] pl-8 pr-3 text-sm outline-none transition focus:border-accent focus-visible:shadow-focus"
            />
          </label>
        )}
      </div>

      {summary && summary.totalRuns === 0 && effectiveTab === 'overview' && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] px-4 py-2.5 text-xs text-muted">
          <Icon name="sparkles" size={14} />
          Welcome to the Sandbox. Run a pipeline from the Validation tab to produce your first certification.
        </div>
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={effectiveTab}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.14, ease: [0.2, 0.8, 0.2, 1] }}
        >
          <TabBody tab={effectiveTab} />
        </motion.div>
      </AnimatePresence>
    </ViewScroll>
  );
}

/** The Sandbox workspace, mounted with its live data provider. */
export function SandboxRoot(): JSX.Element {
  return (
    <SandboxProvider>
      <SandboxInner />
    </SandboxProvider>
  );
}
