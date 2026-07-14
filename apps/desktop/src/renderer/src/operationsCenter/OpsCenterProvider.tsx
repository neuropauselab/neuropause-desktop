import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  ChangeImpactReport,
  EnterpriseIntelChangeImpactRequest,
  EnterpriseIntelRootCauseRequest,
  EnterpriseIntelligenceReport,
  RootCauseReport,
} from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { createLogger } from '@renderer/lib/logger';

const log = createLogger('opscenter');

/** How long after the last infra event we coalesce before refetching the report. */
const REFRESH_DEBOUNCE_MS = 1200;
/** Slow safety poll — the report is cached ~3s server-side, so this is gentle. */
const POLL_MS = 30_000;
/** Tick the shared `nowMs` clock so relative timestamps stay fresh without per-row timers. */
const CLOCK_MS = 30_000;

interface OpsCenterContextValue {
  report: EnterpriseIntelligenceReport | null;
  loading: boolean;
  /** Non-null only when the FIRST load failed (a stale report is kept on later failures). */
  error: string | null;
  /** True while a background refetch is in flight (an existing report is still shown). */
  refreshing: boolean;
  /** Epoch ms of the last successful load (for "updated Xs ago"). */
  loadedAt: number | null;
  /** A coarse clock (epoch ms) for relative-time rendering; updated every ~30s. */
  nowMs: number;
  refresh: () => Promise<void>;
  /** Targeted blast-radius analysis for one node (existing `intel:changeImpact`). */
  loadChangeImpact: (nodeId: string) => Promise<ChangeImpactReport | null>;
  /** Targeted upstream root-cause search (existing `intel:rootCause`). */
  loadRootCause: (req?: EnterpriseIntelRootCauseRequest) => Promise<RootCauseReport | null>;
}

const OpsCenterContext = createContext<OpsCenterContextValue | null>(null);

export function OpsCenterProvider({ children }: { children: ReactNode }): JSX.Element {
  const [report, setReport] = useState<EnterpriseIntelligenceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Guards so overlapping refreshes and post-unmount setState never race.
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const debounce = useRef<number | null>(null);
  // True once ANY load has succeeded — read via ref so the once-bound poll/event
  // closures decide "keep last good report" correctly (state would be stale here).
  const hasReport = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    try {
      const next = await ipc.enterpriseIntel.report();
      if (!mounted.current) return;
      hasReport.current = true;
      setReport(next);
      setError(null);
      setLoadedAt(Date.now());
    } catch (err) {
      if (!mounted.current) return;
      const message = (err as Error).message || 'Failed to load enterprise intelligence';
      log.warn('report load failed', { message });
      // Only surface a hard error on the FIRST load; later transient failures keep the last good report.
      if (!hasReport.current) setError(message);
    } finally {
      if (mounted.current) {
        setLoading(false);
        setRefreshing(false);
      }
      inFlight.current = false;
    }
  }, []);

  const scheduleRefresh = useCallback(() => {
    if (debounce.current != null) window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => {
      debounce.current = null;
      void refresh();
    }, REFRESH_DEBOUNCE_MS);
  }, [refresh]);

  useEffect(() => {
    mounted.current = true;
    void refresh();

    // The report is derived from the Resource Graph + Timeline; infra events are the
    // live signal the renderer can see, so coalesce them into a debounced refetch.
    const offInfra = ipc.infra.onEvent(() => scheduleRefresh());
    const poll = window.setInterval(() => void refresh(), POLL_MS);
    const clock = window.setInterval(() => setNowMs(Date.now()), CLOCK_MS);

    return () => {
      mounted.current = false;
      offInfra();
      window.clearInterval(poll);
      window.clearInterval(clock);
      if (debounce.current != null) window.clearTimeout(debounce.current);
    };
  }, [refresh, scheduleRefresh]);

  const loadChangeImpact = useCallback(async (nodeId: string): Promise<ChangeImpactReport | null> => {
    try {
      const req: EnterpriseIntelChangeImpactRequest = { nodeId };
      return await ipc.enterpriseIntel.changeImpact(req);
    } catch (err) {
      log.warn('changeImpact failed', { message: (err as Error).message });
      return null;
    }
  }, []);

  const loadRootCause = useCallback(
    async (req?: EnterpriseIntelRootCauseRequest): Promise<RootCauseReport | null> => {
      try {
        return await ipc.enterpriseIntel.rootCause(req);
      } catch (err) {
        log.warn('rootCause failed', { message: (err as Error).message });
        return null;
      }
    },
    [],
  );

  const value = useMemo<OpsCenterContextValue>(
    () => ({
      report,
      loading,
      error,
      refreshing,
      loadedAt,
      nowMs,
      refresh,
      loadChangeImpact,
      loadRootCause,
    }),
    [report, loading, error, refreshing, loadedAt, nowMs, refresh, loadChangeImpact, loadRootCause],
  );

  return <OpsCenterContext.Provider value={value}>{children}</OpsCenterContext.Provider>;
}

export function useOpsCenter(): OpsCenterContextValue {
  const ctx = useContext(OpsCenterContext);
  if (!ctx) throw new Error('useOpsCenter must be used within OpsCenterProvider');
  return ctx;
}
