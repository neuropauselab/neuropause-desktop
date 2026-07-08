import { describe, expect, it } from 'vitest';
import { emptyDashboard, isDashboardEmpty } from './emptyDashboard';

describe('emptyDashboard', () => {
  it('fabricates nothing — all lists empty, all metrics zero', () => {
    const d = emptyDashboard();
    expect(d.connectedApps).toEqual([]);
    expect(d.runningSessions).toEqual([]);
    expect(d.tasks).toEqual([]);
    expect(d.activity).toEqual([]);
    expect(d.recommendations).toEqual([]);
    expect(d.notifications).toEqual([]);
    expect(d.productivity).toEqual({ focusMinutesToday: 0, deepWorkPercent: 0, sessionsToday: 0, tasksCompletedToday: 0 });
  });
  it('isDashboardEmpty is true for the empty twin', () => {
    expect(isDashboardEmpty(emptyDashboard())).toBe(true);
  });
  it('isDashboardEmpty is false once any real activity exists', () => {
    const d = emptyDashboard();
    d.runningSessions.push({ id: 's1', appId: 'cursor', title: 'x', startedAt: '2026-01-01T00:00:00Z', state: 'active' });
    expect(isDashboardEmpty(d)).toBe(false);
  });
  it('isDashboardEmpty is false when productivity has real minutes', () => {
    const d = emptyDashboard();
    d.productivity.focusMinutesToday = 45;
    expect(isDashboardEmpty(d)).toBe(false);
  });
});
