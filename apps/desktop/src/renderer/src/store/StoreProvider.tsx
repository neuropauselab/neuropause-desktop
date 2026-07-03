import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { RegistryEntryDto, StoreAppDetail } from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { createLogger } from '@renderer/lib/logger';
import { useShell } from '@renderer/state/ShellProvider';

const log = createLogger('store');

/** Where the store is currently pointed. Kept local to the Store view. */
export type StoreRoute = { name: 'home' } | { name: 'detail'; slug: string };

interface StoreContextValue {
  route: StoreRoute;
  openDetail: (slug: string) => void;
  back: () => void;
  /** Installed apps, keyed by slug (from the Local Application Registry). */
  installs: Map<string, RegistryEntryDto>;
  isInstalled: (slug: string) => boolean;
  refreshInstalls: () => Promise<void>;
  /** The app whose install flow is open, if any. */
  installing: StoreAppDetail | null;
  beginInstall: (app: StoreAppDetail) => void;
  endInstall: () => void;
  /** Launch an app in the Workspace. */
  launch: (slug: string, name: string) => void;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }): JSX.Element {
  const { openApp } = useShell();
  const [route, setRoute] = useState<StoreRoute>({ name: 'home' });
  const [installs, setInstalls] = useState<Map<string, RegistryEntryDto>>(new Map());
  const [installing, setInstalling] = useState<StoreAppDetail | null>(null);

  const refreshInstalls = useCallback(async () => {
    try {
      const list = await ipc.registry.list();
      setInstalls(new Map(list.map((e) => [e.slug, e])));
    } catch (err) {
      log.warn('Failed to load registry', { message: (err as Error).message });
    }
  }, []);

  useEffect(() => {
    void refreshInstalls();
  }, [refreshInstalls]);

  const openDetail = useCallback((slug: string) => {
    setRoute({ name: 'detail', slug });
    // Scrolling is handled by the detail view mounting fresh.
  }, []);
  const back = useCallback(() => setRoute({ name: 'home' }), []);
  const beginInstall = useCallback((app: StoreAppDetail) => setInstalling(app), []);
  const endInstall = useCallback(() => setInstalling(null), []);
  const launch = useCallback((slug: string, name: string) => openApp(slug, name), [openApp]);
  const isInstalled = useCallback((slug: string) => installs.has(slug), [installs]);

  const value = useMemo<StoreContextValue>(
    () => ({
      route,
      openDetail,
      back,
      installs,
      isInstalled,
      refreshInstalls,
      installing,
      beginInstall,
      endInstall,
      launch,
    }),
    [route, openDetail, back, installs, isInstalled, refreshInstalls, installing, beginInstall, endInstall, launch],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}
