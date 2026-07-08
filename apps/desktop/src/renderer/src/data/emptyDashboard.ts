/**
 * A truthful, empty DashboardData — every list empty and every metric zero.
 *
 * This is what the dashboard returns for a real user until an actual activity
 * source exists (Connectors + Activity Intelligence populate it). It fabricates
 * nothing: no sessions, no tasks, no recommendations, no productivity figures.
 * The Home view renders a welcome/empty state from this and progressively
 * populates as real data arrives.
 */
import type { DashboardData } from './types';

export function emptyDashboard(): DashboardData {
  return {
    connectedApps: [],
    runningSessions: [],
    productivity: {
      focusMinutesToday: 0,
      deepWorkPct: 0,
      sessionsToday: 0,
      tasksCompletedToday: 0,
      weekly: [],
    },
    tasks: [],
    activity: [],
    recommendations: [],
    notifications: [],
  };
}

/** True when a dashboard payload has no real activity of any kind. */
export function isDashboardEmpty(d: DashboardData): boolean {
  return (
    d.connectedApps.length === 0 &&
    d.runningSessions.length === 0 &&
    d.tasks.length === 0 &&
    d.activity.length === 0 &&
    d.recommendations.length === 0 &&
    d.productivity.sessionsToday === 0 &&
    d.productivity.focusMinutesToday === 0
  );
}
