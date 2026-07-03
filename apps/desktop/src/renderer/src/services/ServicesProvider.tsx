import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Services } from './repositories';
import { createHttpServices } from './httpRepositories';

const ServicesContext = createContext<Services | null>(null);

/**
 * Provides the repository layer to the tree. Constructed once. The catalog is
 * now backend-backed over the secure IPC bridge; the dashboard remains local
 * until Phase 5. This is the single place that selects the data source.
 */
export function ServicesProvider({ children }: { children: ReactNode }): JSX.Element {
  const services = useMemo(() => createHttpServices(), []);
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices(): Services {
  const ctx = useContext(ServicesContext);
  if (!ctx) throw new Error('useServices must be used within ServicesProvider');
  return ctx;
}
