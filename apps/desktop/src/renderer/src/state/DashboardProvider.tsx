import { createContext, useContext, type ReactNode } from 'react';
import { useDashboardData, type UseDashboardData } from '@renderer/data/useDashboardData';

const DashboardContext = createContext<UseDashboardData | null>(null);

/**
 * Shares a single dashboard payload (and notification mutations) across the
 * toolbar's notification bell and every view that reads activity data, so
 * there is one source of truth and marking a notification read updates
 * everywhere at once.
 */
export function DashboardProvider({ children }: { children: ReactNode }): JSX.Element {
  const value = useDashboardData();
  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}

export function useDashboard(): UseDashboardData {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error('useDashboard must be used within DashboardProvider');
  return ctx;
}
