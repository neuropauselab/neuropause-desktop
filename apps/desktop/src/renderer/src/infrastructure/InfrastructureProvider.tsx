/**
 * The Cloud Platform Center data provider (P6). Mirrors `cloud/CloudProvider.tsx`: one context holding the
 * infrastructure slices (platforms, stats, resource graph), a single `refresh()` over `ipc.infra.*`, a live
 * subscription that debounces re-fetches on `infra:event`, and a `discover()` action. Mounted locally in the
 * Cloud Platform Center root (not globally), exactly like `CloudProvider` in `CloudRoot`.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ipc } from '@renderer/lib/ipc';
import type { CloudPlatformDto, CloudPlatformStats, ResourceGraphModel } from '@neuropause/shared';

interface InfrastructureContextValue {
  ready: boolean;
  platforms: CloudPlatformDto[];
  stats: CloudPlatformStats | null;
  resourceGraph: ResourceGraphModel | null;
  refresh: () => Promise<void>;
  discover: (platformId: string, accountId?: string) => Promise<void>;
}

const InfrastructureContext = createContext<InfrastructureContextValue | null>(null);

export function InfrastructureProvider({ children }: { children: ReactNode }): JSX.Element {
  const [ready, setReady] = useState(false);
  const [platforms, setPlatforms] = useState<CloudPlatformDto[]>([]);
  const [stats, setStats] = useState<CloudPlatformStats | null>(null);
  const [resourceGraph, setResourceGraph] = useState<ResourceGraphModel | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    const [p, s, g] = await Promise.all([ipc.infra.platforms(), ipc.infra.stats(), ipc.infra.resourceGraph()]);
    setPlatforms(p);
    setStats(s);
    setResourceGraph(g);
    setReady(true);
  }, []);

  const discover = useCallback(
    async (platformId: string, accountId?: string) => {
      await ipc.infra.discover(platformId, accountId);
      await refresh();
    },
    [refresh],
  );

  useEffect(() => {
    void refresh().catch(() => setReady(true));
    const off = ipc.infra.onEvent(() => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void refresh(), 250);
    });
    return () => {
      if (timer.current) clearTimeout(timer.current);
      off();
    };
  }, [refresh]);

  const value = useMemo(
    () => ({ ready, platforms, stats, resourceGraph, refresh, discover }),
    [ready, platforms, stats, resourceGraph, refresh, discover],
  );
  return <InfrastructureContext.Provider value={value}>{children}</InfrastructureContext.Provider>;
}

export function useInfrastructure(): InfrastructureContextValue {
  const value = useContext(InfrastructureContext);
  if (!value) throw new Error('useInfrastructure must be used within an InfrastructureProvider');
  return value;
}
