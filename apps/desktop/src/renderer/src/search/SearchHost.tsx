/**
 * Phase 6 Stage 3 — Universal Search host (the live binding).
 *
 * Owns query/scope/run state, binds the pure pipeline to the real IPC client,
 * streams per-source results into the view, executes result actions through
 * existing shell verbs, and persists history (prefs) + saved/pinned searches
 * (the existing personalization store). No new IPC, no new index.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SavedView } from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { prefs, PrefKey } from '@renderer/lib/preferences';
import { useShell } from '@renderer/state/ShellProvider';
import { createLogger } from '@renderer/lib/logger';
import { CATALOG } from '@renderer/data/catalog';
import { SECTIONS, type SectionId } from '../shell/sections';
import { planSearch } from './queryPlanner';
import {
  applyPlanFilters,
  applyScope,
  rankUnified,
  readSearchHistory,
  pushSearchHistory,
  type SearchScopeId,
  type UnifiedSearchItem,
} from './searchModel';
import {
  idleAvailability,
  runUnifiedSearch,
  type SearchAvailability,
  type SearchIo,
  type SearchRunHandle,
} from './searchPipeline';
import { resolveAction, type SearchActionId } from './searchActions';
import { consumePendingSearchQuery } from './searchHandoff';
import { SearchView } from './SearchView';

const log = createLogger('search');
const SAVED_TAB = 'search';
const PIN_KIND = 'search-result';

function buildIo(): SearchIo {
  return {
    enterpriseSearch: (q) => ipc.search.enterprise({ text: q.text, ...(q.sources ? { sources: q.sources as never } : {}), ...(q.limit ? { limit: q.limit } : {}) }),
    unifiedSearch: (q) => ipc.unified.search({ text: q.text, ...(q.kinds ? { kinds: q.kinds as never } : {}), ...(q.connectorId ? { connectorId: q.connectorId } : {}), ...(q.limit ? { limit: q.limit } : {}) }),
    semanticRecall: (text, limit) => ipc.memory.semanticRecall({ text, limit }),
    decisionsList: () => ipc.decisions.list(),
    automationsList: () => ipc.automations.list(),
    connectorsList: () => ipc.connectors.list(),
    workspaceContextsList: () => ipc.workspaceContexts.list(),
    executeSessions: () => ipc.execute.sessions(),
    executeHistory: () => ipc.execute.history(),
    enterpriseOrg: () => ipc.enterprise.org(),
    modulesList: () => ipc.enterpriseModules.list(),
    moduleSearch: (moduleId, query, limit) => ipc.enterpriseModules.search(moduleId, query, limit),
    listApps: () => CATALOG,
    listSections: () => SECTIONS,
  };
}

export function SearchHost({ onNavigate }: { onNavigate?: (section: SectionId) => void }): JSX.Element {
  const { setSection, openApp, openEnterprise, openConnectors } = useShell();
  const go = useCallback((section: SectionId): void => { (onNavigate ?? setSection)(section); }, [onNavigate, setSection]);

  const io = useMemo(buildIo, []);
  const [query, setQuery] = useState<string>(() => consumePendingSearchQuery() ?? '');
  const [scope, setScope] = useState<SearchScopeId>('all');
  const [items, setItems] = useState<UnifiedSearchItem[]>([]);
  const [availability, setAvailability] = useState<SearchAvailability>(idleAvailability);
  const [running, setRunning] = useState(false);
  const [planExplain, setPlanExplain] = useState<string[]>([]);
  const [filterNotes, setFilterNotes] = useState<string[]>([]);
  const [timings, setTimings] = useState<{ totalMs: number; fromCache: boolean } | null>(null);
  const [history, setHistory] = useState<string[]>(() => readSearchHistory((k, f) => prefs.read(k, f)));
  const [saved, setSaved] = useState<SavedView[]>([]);
  const [pinnedKeys, setPinnedKeys] = useState<Set<string>>(new Set());

  const runRef = useRef<SearchRunHandle | null>(null);
  const runSeq = useRef(0);
  const collected = useRef<UnifiedSearchItem[]>([]);

  // Saved searches + pinned results from the existing personalization store.
  useEffect(() => {
    let active = true;
    void ipc.enterprise.personalization
      .get()
      .then((p) => {
        if (!active) return;
        setSaved(p.savedViews.filter((v) => v.tab === SAVED_TAB));
        setPinnedKeys(new Set(p.favorites.filter((f) => f.kind === PIN_KIND).map((f) => f.id)));
      })
      .catch((err) => log.warn('personalization unavailable', err));
    return () => { active = false; };
  }, []);

  const execute = useCallback(
    (rawQuery: string, scopeId: SearchScopeId, opts: { recordHistory?: boolean; bypassCache?: boolean } = {}): void => {
      const raw = rawQuery.trim();
      runRef.current?.cancel();
      const seq = ++runSeq.current;
      collected.current = [];
      setItems([]);
      setFilterNotes([]);
      setTimings(null);

      const plan = planSearch(raw);
      const resolved = applyScope(plan, scopeId);
      setPlanExplain(plan.explain);

      if (!raw) {
        setAvailability(idleAvailability());
        setRunning(false);
        return;
      }

      setRunning(true);
      const base = idleAvailability();
      for (const s of resolved.sources) base[s] = { state: 'loading' };
      setAvailability(base);

      if (opts.recordHistory) {
        setHistory((prev) => {
          const next = pushSearchHistory(prev, raw);
          prefs.write(PrefKey.searchHistory, next);
          return next;
        });
      }

      const handle = runUnifiedSearch(resolved, io, {
        ...(opts.bypassCache ? { bypassCache: true } : {}),
        onUpdate: (u) => {
          if (seq !== runSeq.current) return; // stale run — ignore
          collected.current = [...collected.current, ...u.items];
          const filtered = applyPlanFilters(collected.current, plan);
          const ranked = rankUnified(filtered.kept, { queryText: plan.text || raw, now: Date.now(), pinnedKeys });
          setFilterNotes(filtered.notes);
          setItems(ranked);
          setAvailability((prev) => ({ ...prev, [u.source]: u.state }));
        },
      });
      runRef.current = handle;
      void handle.done.then((result) => {
        if (seq !== runSeq.current) return;
        setRunning(false);
        setTimings({ totalMs: result.totalMs, fromCache: result.fromCache });
      });
    },
    [io, pinnedKeys],
  );

  // A pending hand-off query runs immediately on mount.
  useEffect(() => {
    if (query.trim()) execute(query, scope, { recordHistory: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => runRef.current?.cancel(), []);

  const onSubmit = useCallback((q: string): void => execute(q, scope, { recordHistory: true }), [execute, scope]);
  const onScopeChange = useCallback(
    (s: SearchScopeId): void => {
      setScope(s);
      if (query.trim()) execute(query, s, {});
    },
    [execute, query],
  );
  const onRefresh = useCallback((): void => execute(query, scope, { bypassCache: true }), [execute, query, scope]);

  const onAction = useCallback(
    (item: UnifiedSearchItem, actionId: SearchActionId): void => {
      const res = resolveAction(item, actionId);
      switch (res.kind) {
        case 'section':
          go(res.section);
          return;
        case 'enterprise-tab':
          openEnterprise(res.tab);
          return;
        case 'connectors-tab':
          openConnectors(res.tab);
          return;
        case 'open-app':
          openApp(res.appId, res.title);
          return;
        case 'switch-workspace':
          // Workspace switching lives behind Stage 1's provider; navigate to the
          // workspace section — the switcher there owns the actual switch.
          go('workspace');
          return;
        case 'copy':
          void navigator.clipboard?.writeText(res.text).catch(() => undefined);
          return;
        case 'pin':
          setPinnedKeys((prev) => new Set(prev).add(item.key));
          void ipc.enterprise.personalization
            .favorite({ id: item.key, kind: PIN_KIND, label: item.title, tab: SAVED_TAB, query })
            .catch((err) => log.warn('pin failed', err));
          return;
        case 'none':
          return;
      }
    },
    [go, openApp, openConnectors, openEnterprise, query],
  );

  const onSaveSearch = useCallback((): void => {
    const label = query.trim();
    if (!label) return;
    void ipc.enterprise.personalization
      .saveView({ label, tab: SAVED_TAB, query: label })
      .then((p) => setSaved(p.savedViews.filter((v) => v.tab === SAVED_TAB)))
      .catch((err) => log.warn('save search failed', err));
  }, [query]);

  const onDeleteSaved = useCallback((id: string): void => {
    void ipc.enterprise.personalization
      .deleteView(id)
      .then((p) => setSaved(p.savedViews.filter((v) => v.tab === SAVED_TAB)))
      .catch((err) => log.warn('delete saved search failed', err));
  }, []);

  const onPickQuery = useCallback(
    (q: string): void => {
      setQuery(q);
      execute(q, scope, { recordHistory: true });
    },
    [execute, scope],
  );

  return (
    <SearchView
      query={query}
      onQueryChange={setQuery}
      onSubmit={onSubmit}
      scope={scope}
      onScopeChange={onScopeChange}
      items={items}
      availability={availability}
      running={running}
      planExplain={planExplain}
      filterNotes={filterNotes}
      timings={timings}
      history={history}
      saved={saved}
      pinnedKeys={pinnedKeys}
      onAction={onAction}
      onSaveSearch={onSaveSearch}
      onDeleteSaved={onDeleteSaved}
      onPickQuery={onPickQuery}
      onRefresh={onRefresh}
    />
  );
}
