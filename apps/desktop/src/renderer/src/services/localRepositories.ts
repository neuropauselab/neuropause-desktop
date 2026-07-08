/**
 * The local implementation of the repository layer.
 *
 * - The catalog is served from the bundled product registry. In Phase 3 this is
 *   replaced by a backend-backed implementation (PostgreSQL + the store API).
 * - The dashboard is served from a clearly-labeled demo activity source, since
 *   real activity does not exist until Connectors (Phase 4) and Activity
 *   Intelligence (Phase 5). This is the *only* module that reads the demo data;
 *   no component or view imports it directly.
 *
 * Each method is async and returns cloned data, so it behaves exactly like a
 * networked source and callers never mutate a shared singleton.
 */
import type { CatalogApp, DashboardData } from '@renderer/data/types';
import { CATALOG, getApp } from '@renderer/data/catalog';
import { SAMPLE_DASHBOARD } from '@renderer/data/sampleData';
import { emptyDashboard } from '@renderer/data/emptyDashboard';
import type { CatalogRepository, DashboardRepository, Services } from './repositories';

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Development-only switch to render the representative sample dashboard. Off by
 * default, so production users never see fabricated activity. Enable locally with
 * VITE_NP_SAMPLE_DASHBOARD=1 to preview the populated dashboard layout.
 */
const SHOW_SAMPLE_DASHBOARD =
  import.meta.env.DEV && import.meta.env.VITE_NP_SAMPLE_DASHBOARD === '1';

class LocalCatalogRepository implements CatalogRepository {
  async list(): Promise<CatalogApp[]> {
    await delay(120);
    return structuredClone(CATALOG);
  }
  async get(id: string): Promise<CatalogApp | null> {
    await delay(40);
    return getApp(id) ?? null;
  }
}

class LocalDashboardRepository implements DashboardRepository {
  async getDashboard(): Promise<DashboardData> {
    await delay(180);
    // Real users get a truthful empty dashboard until a real activity source
    // exists (Connectors + Activity Intelligence populate it). The fabricated
    // sample payload is opt-in for development only, never shown to users.
    if (SHOW_SAMPLE_DASHBOARD) return structuredClone(SAMPLE_DASHBOARD);
    return emptyDashboard();
  }
}

/** Builds the local service set. Swap this for `createHttpServices()` in Phase 3. */
export function createLocalServices(): Services {
  return {
    catalog: new LocalCatalogRepository(),
    dashboard: new LocalDashboardRepository(),
  };
}
