/**
 * Repository interfaces — the boundary between the UI and its data sources.
 *
 * The renderer depends only on these abstractions, never on a concrete source.
 * Today they're fulfilled by local implementations (a static registry + a demo
 * activity source). In later phases the same interfaces are fulfilled by real,
 * backend-backed implementations (catalog over the Phase 3 store API; activity
 * over the Phase 5 intelligence service) with no change to any component.
 */
import type { CatalogApp, DashboardData } from '@renderer/data/types';

export interface CatalogRepository {
  list(): Promise<CatalogApp[]>;
  get(id: string): Promise<CatalogApp | null>;
}

export interface DashboardRepository {
  /** The aggregate activity payload that powers the Home dashboard. */
  getDashboard(): Promise<DashboardData>;
}

export interface Services {
  catalog: CatalogRepository;
  dashboard: DashboardRepository;
}
