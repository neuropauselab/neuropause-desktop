import type { DashboardData } from './types';

/**
 * Representative dashboard data for Phase 2.
 *
 * This is clearly seeded sample content — it lets us build and prove out the
 * real dashboard components now, before the Activity Intelligence, Connectors,
 * and Memory services exist. The UI surfaces a "Sample data" marker so it is
 * never mistaken for live activity. Phases 4–6 replace this module with real
 * sources behind the same types; the components stay identical.
 */

const minutesAgo = (m: number): string => new Date(Date.now() - m * 60_000).toISOString();

// Trailing 7 days, oldest first; the final entry is "today".
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
function lastSevenDays(values: number[]): { label: string; value: number }[] {
  const today = new Date().getDay(); // 0=Sun
  return values.map((value, i) => {
    const dayIndex = (today - (values.length - 1 - i) + 7 * 2) % 7;
    // Map JS Sunday=0 to our Mon-first labels.
    const label = WEEKDAYS[(dayIndex + 6) % 7];
    return { label, value };
  });
}

export const SAMPLE_DASHBOARD: DashboardData = {
  connectedApps: [
    { appId: 'chatgpt', lastUsed: minutesAgo(18), sessionsToday: 4 },
    { appId: 'claude', lastUsed: minutesAgo(52), sessionsToday: 3 },
    { appId: 'cursor', lastUsed: minutesAgo(6), sessionsToday: 7 },
    { appId: 'notion', lastUsed: minutesAgo(140), sessionsToday: 2 },
  ],

  runningSessions: [
    {
      id: 's1',
      appId: 'cursor',
      title: 'Refactor authentication module',
      startedAt: minutesAgo(42),
      state: 'active',
    },
    {
      id: 's2',
      appId: 'claude',
      title: 'Draft Q3 board narrative',
      startedAt: minutesAgo(15),
      state: 'active',
    },
    {
      id: 's3',
      appId: 'chatgpt',
      title: 'Competitor research summary',
      startedAt: minutesAgo(95),
      state: 'idle',
    },
  ],

  productivity: {
    focusMinutesToday: 215,
    deepWorkPct: 68,
    sessionsToday: 16,
    tasksCompletedToday: 9,
    weekly: lastSevenDays([180, 240, 150, 300, 215, 60, 95]),
  },

  tasks: [
    { id: 't1', title: 'Finish investor update draft', appId: 'claude', priority: 'high', due: 'Today' },
    { id: 't2', title: 'Review PR #482 — token rotation', appId: 'cursor', priority: 'high', due: 'Today' },
    { id: 't3', title: 'Reply to design feedback thread', appId: 'notion', priority: 'medium', due: 'Tomorrow' },
    { id: 't4', title: 'Outline onboarding email sequence', appId: 'chatgpt', priority: 'medium', due: 'Wed' },
    { id: 't5', title: 'Export research citations', appId: 'perplexity', priority: 'low', due: 'Fri' },
  ],

  activity: [
    { id: 'a1', kind: 'completed', title: 'Completed “Auth flow diagram”', appId: 'cursor', at: minutesAgo(8) },
    { id: 'a2', kind: 'created', title: 'Created “Q3 board narrative”', appId: 'claude', at: minutesAgo(15) },
    { id: 'a3', kind: 'opened', title: 'Opened competitor research', appId: 'chatgpt', at: minutesAgo(34) },
    { id: 'a4', kind: 'summarized', title: 'Summarized 3 chats into a brief', appId: 'claude', at: minutesAgo(70) },
    { id: 'a5', kind: 'connected', title: 'Connected Notion workspace', appId: 'notion', at: minutesAgo(150) },
    { id: 'a6', kind: 'completed', title: 'Completed “Pricing one-pager”', appId: 'notion', at: minutesAgo(190) },
  ],

  recommendations: [
    {
      id: 'r1',
      title: 'Wrap up the investor update',
      detail: 'Your Claude draft has been idle for 2 days and is due today.',
      tone: 'orange',
      action: 'Resume',
    },
    {
      id: 'r2',
      title: 'Summarize yesterday’s work',
      detail: 'You had 16 sessions across 4 apps. Generate a recap?',
      tone: 'accent',
      action: 'Summarize',
    },
    {
      id: 'r3',
      title: 'Connect Google Calendar',
      detail: 'Link your calendar to fold meetings into your timeline.',
      tone: 'blue',
      action: 'Connect',
    },
  ],

  notifications: [
    {
      id: 'n1',
      title: 'Draft due today',
      body: '“Investor update” in Claude is due in 3 hours.',
      appId: 'claude',
      at: minutesAgo(25),
      read: false,
      kind: 'reminder',
    },
    {
      id: 'n2',
      title: 'Daily summary ready',
      body: 'Your recap for yesterday is ready to review.',
      at: minutesAgo(180),
      read: false,
      kind: 'summary',
    },
    {
      id: 'n3',
      title: 'Stalled task detected',
      body: 'PR #482 in Cursor hasn’t moved in 2 days.',
      appId: 'cursor',
      at: minutesAgo(300),
      read: true,
      kind: 'reminder',
    },
  ],
};
