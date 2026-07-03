/**
 * The Enterprise Ecosystem data provider. Loads marketplace listings, the
 * organization's installs + summary, the exchange packs + stats, the partner
 * directory + stats, the ecosystem analytics, and the live workforce (for
 * sharing a worker to the marketplace) — then subscribes to the ecosystem
 * broadcast to stay live.
 *
 * Action surface: install / update / enable / uninstall a listing, share a
 * worker, and import / publish / remove exchange packs. Every side effect is a
 * typed IPC call validated in the main process.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  EcosystemAnalytics,
  ExchangePack,
  ExchangeStats,
  Installation,
  InstallSummary,
  ListingDetail,
  MarketplaceListing,
  PackItem,
  PackKind,
  Partner,
  PartnerStats,
  WorkerSummary,
} from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { createLogger } from '@renderer/lib/logger';

const log = createLogger('ecosystem');

interface EcosystemContextValue {
  ready: boolean;
  listings: MarketplaceListing[];
  installs: Installation[];
  installSummary: InstallSummary | null;
  packs: ExchangePack[];
  packsStats: ExchangeStats | null;
  partners: Partner[];
  partnersStats: PartnerStats | null;
  analytics: EcosystemAnalytics | null;
  workers: WorkerSummary[];
  refreshAll: () => Promise<void>;
  install: (listingId: string) => Promise<Installation | { error: string }>;
  update: (installationId: string) => Promise<void>;
  setEnabled: (installationId: string, enabled: boolean) => Promise<void>;
  uninstall: (installationId: string) => Promise<void>;
  shareWorker: (workerId: string) => Promise<ListingDetail | { error: string }>;
  importPack: (id: string) => Promise<void>;
  publishPack: (input: { name: string; summary: string; kind: PackKind; items: PackItem[] }) => Promise<ExchangePack>;
  removePack: (id: string) => Promise<void>;
  installedFor: (listingId: string) => Installation | undefined;
}

const EcosystemContext = createContext<EcosystemContextValue | null>(null);

export function EcosystemProvider({ children }: { children: ReactNode }): JSX.Element {
  const [ready, setReady] = useState(false);
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [installs, setInstalls] = useState<Installation[]>([]);
  const [installSummary, setInstallSummary] = useState<InstallSummary | null>(null);
  const [packs, setPacks] = useState<ExchangePack[]>([]);
  const [packsStats, setPacksStats] = useState<ExchangeStats | null>(null);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [partnersStats, setPartnersStats] = useState<PartnerStats | null>(null);
  const [analytics, setAnalytics] = useState<EcosystemAnalytics | null>(null);
  const [workers, setWorkers] = useState<WorkerSummary[]>([]);

  const refreshAll = useCallback(async () => {
    try {
      const [ls, ins, sum, pk, pks, prt, prs, an, w] = await Promise.all([
        ipc.ecosystem.listings(),
        ipc.ecosystem.installs(),
        ipc.ecosystem.installSummary(),
        ipc.ecosystem.packs(),
        ipc.ecosystem.packsStats(),
        ipc.ecosystem.partners(),
        ipc.ecosystem.partnersStats(),
        ipc.ecosystem.analytics(),
        ipc.workforce.workers(),
      ]);
      setListings(ls);
      setInstalls(ins);
      setInstallSummary(sum);
      setPacks(pk);
      setPacksStats(pks);
      setPartners(prt);
      setPartnersStats(prs);
      setAnalytics(an);
      setWorkers(w);
      setReady(true);
    } catch (err) {
      log.error('Failed to refresh ecosystem', err);
    }
  }, []);

  const refreshLive = useCallback(async () => {
    try {
      const [ls, ins, sum, pk, pks, an] = await Promise.all([
        ipc.ecosystem.listings(),
        ipc.ecosystem.installs(),
        ipc.ecosystem.installSummary(),
        ipc.ecosystem.packs(),
        ipc.ecosystem.packsStats(),
        ipc.ecosystem.analytics(),
      ]);
      setListings(ls);
      setInstalls(ins);
      setInstallSummary(sum);
      setPacks(pk);
      setPacksStats(pks);
      setAnalytics(an);
    } catch (err) {
      log.error('Failed to refresh ecosystem live slices', err);
    }
  }, []);

  useEffect(() => {
    void refreshAll();
    let t: ReturnType<typeof setTimeout> | null = null;
    const debounced = (fn: () => void): void => {
      if (t) clearTimeout(t);
      t = setTimeout(fn, 180);
    };
    const off = ipc.ecosystem.onEvent(() => debounced(() => void refreshLive()));
    return () => {
      if (t) clearTimeout(t);
      off();
    };
  }, [refreshAll, refreshLive]);

  const install = useCallback(async (listingId: string) => { const r = await ipc.ecosystem.installListing(listingId); await refreshLive(); return r; }, [refreshLive]);
  const update = useCallback(async (installationId: string) => { await ipc.ecosystem.updateInstall(installationId); await refreshLive(); }, [refreshLive]);
  const setEnabled = useCallback(async (installationId: string, enabled: boolean) => { await ipc.ecosystem.setInstallEnabled(installationId, enabled); await refreshLive(); }, [refreshLive]);
  const uninstall = useCallback(async (installationId: string) => { await ipc.ecosystem.uninstall(installationId); await refreshLive(); }, [refreshLive]);
  const shareWorker = useCallback(async (workerId: string) => { const r = await ipc.ecosystem.shareWorker(workerId); await refreshLive(); return r; }, [refreshLive]);
  const importPack = useCallback(async (id: string) => { await ipc.ecosystem.importPack(id); await refreshLive(); }, [refreshLive]);
  const publishPack = useCallback(async (input: { name: string; summary: string; kind: PackKind; items: PackItem[] }) => { const r = await ipc.ecosystem.publishPack(input); await refreshLive(); return r; }, [refreshLive]);
  const removePack = useCallback(async (id: string) => { await ipc.ecosystem.removePack(id); await refreshLive(); }, [refreshLive]);

  const installedFor = useCallback((listingId: string) => installs.find((i) => i.listingId === listingId), [installs]);

  const value = useMemo<EcosystemContextValue>(
    () => ({
      ready,
      listings,
      installs,
      installSummary,
      packs,
      packsStats,
      partners,
      partnersStats,
      analytics,
      workers,
      refreshAll,
      install,
      update,
      setEnabled,
      uninstall,
      shareWorker,
      importPack,
      publishPack,
      removePack,
      installedFor,
    }),
    [
      ready, listings, installs, installSummary, packs, packsStats, partners, partnersStats, analytics, workers,
      refreshAll, install, update, setEnabled, uninstall, shareWorker, importPack, publishPack, removePack, installedFor,
    ],
  );

  return <EcosystemContext.Provider value={value}>{children}</EcosystemContext.Provider>;
}

export function useEcosystem(): EcosystemContextValue {
  const ctx = useContext(EcosystemContext);
  if (!ctx) throw new Error('useEcosystem must be used within EcosystemProvider');
  return ctx;
}
