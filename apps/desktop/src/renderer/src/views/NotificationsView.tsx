/**
 * NotificationsView (Phase 6 Stage 5 — D-8): the real notification inbox +
 * the surfaced delivery preferences. The feed is the durable inbox behind the
 * delivery engine's notification-center channel; the preferences panel writes
 * the EXISTING delivery-preference store through `notifications:prefs.*`
 * (audited), and cadence changes take effect live (sources re-register).
 */
import { useCallback, useEffect, useState } from 'react';
import type { DeliveryPreferences, IntelligencePriority } from '@neuropause/shared';
import { ViewHeader } from '@renderer/components/ui/Page';
import { Icon } from '@renderer/components/ui/Icon';
import { Button } from '@renderer/components/ui/Button';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { Card, CardHeader } from '@renderer/components/ui/Card';
import { SegmentedControl, Toggle } from '@renderer/components/ui/controls';
import { formatRelative } from '@renderer/lib/format';
import { ipc } from '@renderer/lib/ipc';
import { useShell } from '@renderer/state/ShellProvider';
import { useNotificationInbox } from '@renderer/hub/useNotificationInbox';
import { sectionForDeepLink, sourceLabel } from '@renderer/hub/hubModel';

const PRIORITY_DOT: Record<string, string> = {
  low: 'bg-[var(--fill-2)]',
  normal: 'bg-sysblue',
  high: 'bg-sysorange',
  critical: 'bg-syspink',
};

/** The scheduled/event sources a user can mute (key → what it is). */
const MUTABLE_SOURCES: { key: string; label: string; detail: string }[] = [
  { key: 'mission-brief-morning', label: 'Morning Brief', detail: 'Daily priorities at your chosen time' },
  { key: 'work-afternoon', label: 'Afternoon Update', detail: 'Mid-day check-in' },
  { key: 'mission-brief-evening', label: 'Evening Summary', detail: 'What moved today' },
  { key: 'work-weekly', label: 'Weekly Brief', detail: 'Week in review' },
  { key: 'work-monthly', label: 'Monthly Summary', detail: 'Executive month roll-up' },
  { key: 'meeting-soon', label: 'Meeting reminders', detail: 'Meetings starting within 30 minutes' },
  { key: 'work-complete', label: 'Work completed', detail: 'Jobs, automations, and workflows finishing' },
  { key: 'approval-needed', label: 'Approvals', detail: 'Proposals parked for your decision' },
  { key: 'connector-issue', label: 'Connector issues', detail: 'Sync failures and re-auth needs' },
  // Phase 6 Stage 6 — the Enterprise Intelligence Layer's governed sources.
  { key: 'insight-monitor', label: 'Intelligence monitor', detail: 'New high-priority insight recommendations (15-min watch)' },
  { key: 'insight-risk-trend', label: 'Risk trend watch', detail: 'Daily health/risk trend deterioration' },
  // Phase 6 Stage 7 — the Knowledge Platform's governed hygiene source.
  { key: 'knowledge-hygiene', label: 'Knowledge hygiene', detail: 'Daily outdated/conflicting/unowned knowledge findings' },
  // Phase 6 Stage 8 — the Automation Platform's governed watch source.
  { key: 'automation-watch', label: 'Automation watch', detail: 'Daily stuck/failed/aging automation findings' },
  // Phase 6 Stage 9 — the Operations Platform's governed watch source.
  { key: 'operations-watch', label: 'Operations watch', detail: 'Daily SLA breaches, readiness regressions & critical incidents' },
];

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function timeToMinutes(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  return Number.isFinite(minutes) && minutes >= 0 && minutes < 1440 ? minutes : null;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function TimeRow({
  label,
  minutes,
  onChange,
}: {
  label: string;
  minutes: number;
  onChange: (minutes: number) => void;
}): JSX.Element {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted">{label}</span>
      <input
        type="time"
        value={minutesToTime(minutes)}
        onChange={(e) => {
          const next = timeToMinutes(e.target.value);
          if (next !== null) onChange(next);
        }}
        className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1 text-sm text-ink outline-none focus-visible:shadow-focus"
      />
    </label>
  );
}

export function NotificationsView(): JSX.Element {
  const { items, unread, available, markRead } = useNotificationInbox(100);
  const { setSection } = useShell();
  const [prefs, setPrefs] = useState<DeliveryPreferences | null>(null);
  const [prefsError, setPrefsError] = useState<string | null>(null);
  const [showPrefs, setShowPrefs] = useState(false);

  useEffect(() => {
    ipc.notifications
      .prefs()
      .then(setPrefs)
      .catch((err) => setPrefsError(err instanceof Error ? err.message : String(err)));
  }, []);

  const patch = useCallback((p: Parameters<typeof ipc.notifications.setPrefs>[0]): void => {
    // Optimistic: reflect immediately, reconcile with the store's answer.
    setPrefs((prev) => (prev ? { ...prev, ...p } : prev));
    ipc.notifications
      .setPrefs(p)
      .then(setPrefs)
      .catch((err) => setPrefsError(err instanceof Error ? err.message : String(err)));
  }, []);

  const mutedSet = new Set(prefs?.mutedSources ?? []);
  const toggleMute = (key: string, muted: boolean): void => {
    const next = new Set(mutedSet);
    if (muted) next.add(key);
    else next.delete(key);
    patch({ mutedSources: [...next].sort() });
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-[820px] px-8 pb-7 pt-7">
        <ViewHeader
          title="Notifications"
          subtitle="Everything the delivery engine sent — briefs, approvals, work updates, and alerts — with your delivery preferences."
          right={
            <div className="flex items-center gap-2">
              {unread > 0 && (
                <Button size="sm" variant="secondary" icon="check" onClick={() => markRead('all')}>
                  Mark all read
                </Button>
              )}
              <Button
                size="sm"
                variant={showPrefs ? 'primary' : 'secondary'}
                icon="settings"
                onClick={() => setShowPrefs((v) => !v)}
              >
                Preferences
              </Button>
            </div>
          }
        />

        {showPrefs && (
          <Card variant="raised" className="mb-5 p-5">
            <CardHeader icon={<Icon name="settings" size={15} />} title="Delivery preferences" />
            {prefsError && (
              <div className="mb-3 text-sm text-muted">
                <span className="font-medium text-ink">Unavailable</span> — {prefsError}
              </div>
            )}
            {!prefs && !prefsError && <div className="py-3 text-sm text-faint">Loading…</div>}
            {prefs && (
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-muted">Notifications enabled</span>
                    <Toggle checked={prefs.enabled} onChange={(v) => patch({ enabled: v })} label="Notifications enabled" />
                  </div>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-muted">Do not disturb (critical still gets through)</span>
                    <Toggle checked={prefs.doNotDisturb} onChange={(v) => patch({ doNotDisturb: v })} label="Do not disturb" />
                  </div>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-muted">Minimum priority</span>
                    <SegmentedControl<IntelligencePriority>
                      size="sm"
                      options={[
                        { value: 'low', label: 'Low' },
                        { value: 'normal', label: 'Normal' },
                        { value: 'high', label: 'High' },
                        { value: 'critical', label: 'Critical' },
                      ]}
                      value={prefs.minPriority}
                      onChange={(v) => patch({ minPriority: v })}
                    />
                  </div>
                  <TimeRow
                    label="Morning brief"
                    minutes={prefs.morningBriefMinutes}
                    onChange={(m) => patch({ morningBriefMinutes: m })}
                  />
                  <TimeRow
                    label="Afternoon update"
                    minutes={prefs.afternoonUpdateMinutes ?? 13 * 60 + 30}
                    onChange={(m) => patch({ afternoonUpdateMinutes: m })}
                  />
                  <TimeRow
                    label="Evening summary"
                    minutes={prefs.eveningSummaryMinutes}
                    onChange={(m) => patch({ eveningSummaryMinutes: m })}
                  />
                  <label className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-muted">Weekly brief day</span>
                    <select
                      value={prefs.weeklyReportDay}
                      onChange={(e) => patch({ weeklyReportDay: Number(e.target.value) })}
                      className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1 text-sm text-ink outline-none focus-visible:shadow-focus"
                    >
                      {WEEKDAYS.map((d, i) => (
                        <option key={d} value={i}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">Per-source mutes</div>
                  <div className="space-y-2.5">
                    {MUTABLE_SOURCES.map((s) => (
                      <div key={s.key} className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm text-ink">{s.label}</div>
                          <div className="truncate text-xs text-faint">{s.detail}</div>
                        </div>
                        <Toggle
                          checked={!mutedSet.has(s.key)}
                          onChange={(on) => toggleMute(s.key, !on)}
                          label={`${s.label} enabled`}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </Card>
        )}

        {available === false && (
          <div className="surface-raised rounded-2xl p-6 text-sm text-muted">
            <span className="font-medium text-ink">Unavailable</span> — the notification inbox could not be reached.
          </div>
        )}
        {available === null && <div className="py-6 text-sm text-faint">Loading…</div>}
        {available === true && items.length === 0 && (
          <div className="surface-raised rounded-2xl">
            <EmptyState
              icon="bell"
              title="You’re all caught up"
              description="Delivered briefs, approvals, and alerts will show up here."
            />
          </div>
        )}
        {available === true && items.length > 0 && (
          <div className="space-y-2">
            {items.map((n) => {
              const section = sectionForDeepLink(n.deepLink);
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => {
                    markRead([n.id]);
                    if (section) setSection(section);
                  }}
                  className="surface-raised flex w-full items-start gap-3 rounded-2xl p-4 text-left shadow-card outline-none transition hover:shadow-pop focus-visible:shadow-focus"
                >
                  <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/12 text-accent">
                    <Icon name="bell" size={18} />
                    {!n.read && (
                      <span className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-[var(--surface-2)] ${PRIORITY_DOT[n.priority] ?? 'bg-syspink'}`} />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-base font-semibold">{n.title}</span>
                      <span className="shrink-0 text-xs text-faint">{formatRelative(n.at)}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-sm leading-snug text-muted">{n.body}</p>
                    <div className="mt-1.5 text-xs text-faint">
                      {sourceLabel(n.sourceKey)}
                      {section ? ' · opens on click' : ''}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
