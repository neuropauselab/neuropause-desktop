/**
 * Data Command Center — the surface for getting real enterprise data into
 * NeuroPause and being able to prove where every record came from.
 *
 * Composition only. The panels own their own reads and every judgement is made
 * by `dataCommandCenterModel`, which is tested; this file decides which panel is
 * on screen and holds the one piece of state two panels share (import history).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DataPlaneOntologyView, DataPlaneRunResult } from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { createLogger } from '@renderer/lib/logger';
import { ViewHeader, ViewScroll } from '@renderer/components/ui/Page';
import { SegmentedTabs, type SegmentedTabItem } from '@renderer/components/ui/pillTabs';
import { Loading } from '@renderer/components/ui/Loading';
import { buildOverview, friendlyError } from './dataCommandCenterModel';
import { ImportPanel } from './ImportPanel';
import { DocumentsPanel } from './DocumentsPanel';
import { IdentityPanel } from './IdentityPanel';
import {
  CoveragePanel,
  ExportPanel,
  RelationshipsPanel,
  HistoryPanel,
  MappingsPanel,
  OverviewPanel,
  ProvenancePanel,
  QualityPanel,
  RefreshButton,
} from './panels';
import { ErrorBlock } from './primitives';

const log = createLogger('data-command-center');

type Tab =
  | 'overview'
  | 'import'
  | 'export'
  | 'documents'
  | 'identity'
  | 'relationships'
  | 'history'
  | 'quality'
  | 'provenance'
  | 'mappings'
  | 'coverage';

export function DataCommandCenterView(): JSX.Element {
  const [tab, setTab] = useState<Tab>('overview');
  const [history, setHistory] = useState<DataPlaneRunResult[] | null>(null);
  const [ontology, setOntology] = useState<DataPlaneOntologyView | null>(null);
  const [error, setError] = useState<{ title: string; detail: string; canRetry: boolean } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  /**
   * Read here rather than inside the panel so the badge is visible without
   * opening the tab. A refusal (no `data:read`) leaves it at zero rather than
   * showing a broken badge on an unrelated screen.
   */
  const [identityPending, setIdentityPending] = useState(0);

  const loadHistory = useCallback(async (): Promise<void> => {
    setRefreshing(true);
    try {
      setError(null);
      setHistory(await ipc.data.history(100));
    } catch (err) {
      log.warn('Could not load import history', {
        message: err instanceof Error ? err.message : String(err),
      });
      setError(friendlyError(err));
      // An empty list is the honest fallback: the panels then render their
      // "nothing imported yet" state under a visible error, rather than
      // pretending the surface is fine or hanging on a spinner forever.
      setHistory([]);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
    // The ontology is static per build; a failure here only disables the
    // Coverage tab's content, so it never blocks the rest of the surface.
    ipc.data
      .ontology()
      .then(setOntology)
      .catch(() => setOntology(null));
    ipc.data.identity
      .queue(200)
      .then((q) => setIdentityPending(q.length))
      .catch(() => setIdentityPending(0));
  }, [loadHistory]);

  // `history` is null only before the first load resolves; the panels take a
  // list, so it is normalized once here rather than at seven call sites.
  const runs = useMemo(() => history ?? [], [history]);
  const overview = useMemo(() => buildOverview(runs), [runs]);

  const tabs = useMemo<SegmentedTabItem<Tab>[]>(() => {
    const attention = overview.metrics
      .filter((m) => m.key === 'review' || m.key === 'awaiting' || m.key === 'failed')
      .reduce((n, m) => n + m.value, 0);
    return [
      { id: 'overview', label: 'Overview', icon: 'gauge' },
      { id: 'import', label: 'Import', icon: 'upload' },
      { id: 'export', label: 'Export', icon: 'download' },
      { id: 'documents', label: 'Documents', icon: 'doc' },
      /**
       * The count is the point of this tab.
       *
       * An unanswered identity question means a row a connector pulled has not
       * arrived. Before P10 that was a number inside a finished sync summary
       * nobody re-opened; on the tab strip it is a standing ask.
       */
      { id: 'identity', label: 'Identity', icon: 'user', count: identityPending || undefined },
      { id: 'relationships', label: 'Relationships', icon: 'connectors' },
      { id: 'history', label: 'History', icon: 'clock', count: runs.length || undefined },
      { id: 'quality', label: 'Data Quality', icon: 'shield', count: attention || undefined },
      { id: 'provenance', label: 'Provenance', icon: 'eye' },
      { id: 'mappings', label: 'Mappings', icon: 'memory' },
      { id: 'coverage', label: 'Coverage', icon: 'list' },
    ];
  }, [overview.metrics, runs.length, identityPending]);

  const openRun = useCallback((planId: string): void => {
    setSelectedRun(planId);
    setTab('history');
  }, []);

  return (
    <ViewScroll max={1240}>
      <ViewHeader
        title="Data"
        subtitle="Bring your real business data into NeuroPause — identified, reviewed before anything is written, and traceable back to the row it came from."
        right={<RefreshButton busy={refreshing} onClick={() => void loadHistory()} />}
      />

      <div className="mb-6">
        <SegmentedTabs items={tabs} activeId={tab} onChange={setTab} ariaLabel="Data Command Center sections" />
      </div>

      {error && (
        <div className="mb-5">
          <ErrorBlock
            title={error.title}
            detail={error.detail}
            onRetry={error.canRetry ? () => void loadHistory() : undefined}
          />
        </div>
      )}

      {history === null ? (
        <Loading kind="panel" cards={4} />
      ) : (
        <>
          {tab === 'overview' && (
            <OverviewPanel history={runs} onImport={() => setTab('import')} onOpenRun={openRun} />
          )}
          {tab === 'import' && <ImportPanel onImported={() => void loadHistory()} />}
          {tab === 'export' && <ExportPanel />}
          {tab === 'documents' && <DocumentsPanel />}
          {tab === 'identity' && <IdentityPanel />}
          {tab === 'relationships' && <RelationshipsPanel />}
          {tab === 'history' && (
            <HistoryPanel history={runs} selected={selectedRun} onSelect={setSelectedRun} />
          )}
          {tab === 'quality' && <QualityPanel history={runs} />}
          {tab === 'provenance' && <ProvenancePanel history={runs} />}
          {tab === 'mappings' && <MappingsPanel />}
          {tab === 'coverage' && <CoveragePanel ontology={ontology} />}
        </>
      )}
    </ViewScroll>
  );
}
