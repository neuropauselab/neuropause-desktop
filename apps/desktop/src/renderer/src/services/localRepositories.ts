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
import type { CatalogRepository, DashboardRepository, Services } from './repositories';

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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
    return structuredClone(SAMPLE_DASHBOARD);
  }
}

/** Builds the local service set. Swap this for `createHttpServices()` in Phase 3. */
export function createLocalServices(): Services {
  return {
    catalog: new LocalCatalogRepository(),
    dashboard: new LocalDashboardRepository(),
  };
}
