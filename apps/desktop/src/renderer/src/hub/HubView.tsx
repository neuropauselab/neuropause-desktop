/**
 * HubView (Phase 6 Stage 5) — the Work Hub presentation. Pure rendering over
 * the tile models HubHost derives; every tile shows loading / ready /
 * unavailable(reason) explicitly (the Stage 2 honesty contract), and empty
 * feeds render honest empty lines — nothing is fabricated.
 */
import type { ReactNode } from 'react';
import type { AssistantConversationSummary } from '@neuropause/shared';
import { ViewHeader } from '@renderer/components/ui/Page';
import { Card, CardHeader } from '@renderer/components/ui/Card';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { Button } from '@renderer/components/ui/Button';
import { SegmentedTabs } from '@renderer/components/ui/pillTabs';
import { formatRelative } from '@renderer/lib/format';
import type { SectionId } from '@renderer/shell/sections';
import {
  HUB_TABS,
  type BriefDisplay,
  type EmailRow,
  type ExecHighlight,
  type HubTabId,
  type MeetingRow,
  type NotificationRowModel,
  type ProductivityTimelineEntry,
  type RecommendationCard,
  type TaskBoard,
  type TileState,
  type WorkSummaryTile,
} from './hubModel';

/* ── The tile shell (honest 3-state rendering) ───────────────────────────── */

function Tile<T>({
  icon,
  title,
  tile,
  action,
  children,
}: {
  icon: IconName;
  title: string;
  tile: TileState<T>;
  action?: ReactNode;
  children: (data: T) => ReactNode;
}): JSX.Element {
  return (
    <Card variant="raised" className="p-5">
      <CardHeader icon={<Icon name={icon} size={15} />} title={title} action={action} />
      {tile.state === 'loading' && <div className="py-4 text-sm text-faint">Loading…</div>}
      {tile.state === 'unavailable' && (
        <div className="py-4 text-sm text-muted">
          <span className="font-medium text-ink">Unavailable</span> — {tile.reason}
        </div>
      )}
      {tile.state === 'ready' && children(tile.data)}
    </Card>
  );
}

function EmptyLine({ text }: { text: string }): JSX.Element {
  return <div className="py-3 text-sm text-faint">{text}</div>;
}

const PRIORITY_DOT: Record<string, string> = {
  low: 'bg-[var(--fill-2)]',
  normal: 'bg-sysblue',
  high: 'bg-sysorange',
  critical: 'bg-syspink',
};

/* ── The view ────────────────────────────────────────────────────────────── */

export interface HubViewProps {
  tab: HubTabId;
  onTab: (tab: HubTabId) => void;
  onRefresh: () => void;
  unread: number;
  brief: TileState<BriefDisplay>;
  meetings: TileState<MeetingRow[]>;
  recommendations: TileState<RecommendationCard[]>;
  notifications: TileState<NotificationRowModel[]>;
  timeline: TileState<ProductivityTimelineEntry[]>;
  tasks: TileState<TaskBoard>;
  emails: TileState<EmailRow[]>;
  approvals: TileState<{ id: string; title: string; createdAt: string }[]>;
  conversations: TileState<AssistantConversationSummary[]>;
  summary: TileState<WorkSummaryTile>;
  executive: TileState<ExecHighlight[]>;
  decisions: TileState<{ id: string; title: string; status: string }[]>;
  onMarkNotificationRead: (id: string) => void;
  onPrepareMeeting: (query: string) => void;
  onNavigate?: (id: SectionId) => void;
}

export function HubView(p: HubViewProps): JSX.Element {
  const go = (id: SectionId | null): void => {
    if (id && p.onNavigate) p.onNavigate(id);
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-[1100px] px-8 pb-8 pt-7">
        <ViewHeader
          title="Work Hub"
          subtitle="Your workday — briefs, meetings, tasks, and what needs you — composed from your connected systems."
          right={
            <Button size="sm" variant="secondary" icon="refresh" onClick={p.onRefresh}>
              Refresh
            </Button>
          }
        />

        <div className="mb-5 mt-1">
          <SegmentedTabs
            items={HUB_TABS.map((t) => (t.id === 'today' && p.unread > 0 ? { ...t, count: p.unread } : t))}
            activeId={p.tab}
            onChange={p.onTab}
            ariaLabel="Work Hub tabs"
          />
        </div>

        {/* ── Today ─────────────────────────────────────────────────────── */}
        {p.tab === 'today' && (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Tile icon="sparkles" title="Today's brief" tile={p.brief}>
              {(b) =>
                b.sections.length === 0 ? (
                  <EmptyLine text={b.grounded ? 'Nothing to report yet.' : b.headline} />
                ) : (
                  <div className="space-y-3">
                    <div className="text-sm font-medium text-ink">{b.headline}</div>
                    {b.sections.map((s) => (
                      <div key={s.title}>
                        <div className="text-xs font-semibold uppercase tracking-wide text-faint">{s.title}</div>
                        <ul className="mt-1 space-y-1">
                          {s.lines.map((l) => (
                            <li key={l} className="text-sm text-muted">{l}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )
              }
            </Tile>

            <Tile icon="clock" title="Meetings today" tile={p.meetings}>
              {(rows) =>
                rows.length === 0 ? (
                  <EmptyLine text="No more meetings today." />
                ) : (
                  <ul className="space-y-2">
                    {rows.map((m) => (
                      <li key={m.id} className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-ink">{m.title}</div>
                          <div className="text-xs text-faint">
                            {new Date(m.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            {m.organizer ? ` · ${m.organizer}` : ''}
                          </div>
                        </div>
                        <Button size="sm" variant="secondary" onClick={() => p.onPrepareMeeting(m.prepareQuery)}>
                          Prepare
                        </Button>
                      </li>
                    ))}
                  </ul>
                )
              }
            </Tile>

            <Tile icon="lightbulb" title="Priorities & recommendations" tile={p.recommendations}>
              {(cards) =>
                cards.length === 0 ? (
                  <EmptyLine text="No recommendations right now." />
                ) : (
                  <ul className="space-y-2.5">
                    {cards.map((c) => (
                      <li key={c.id} className="rounded-xl border border-[var(--border)] p-3">
                        <div className="flex items-center gap-2">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[c.priority] ?? 'bg-sysblue'}`} />
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{c.title}</span>
                          {c.confidence !== null && (
                            <span className="shrink-0 text-2xs text-faint">{Math.round(c.confidence * 100)}%</span>
                          )}
                        </div>
                        <div className="mt-1 text-xs leading-snug text-muted">Why: {c.rationale}</div>
                        {c.suggestedAction && (
                          <div className="mt-1 text-xs text-muted">
                            <span className="font-medium text-ink">Action:</span> {c.suggestedAction}
                          </div>
                        )}
                        <div className="mt-1 text-2xs text-faint">
                          {c.evidenceCount} evidence ref(s)
                          {c.affectedSystems.length > 0 ? ` · ${c.affectedSystems.join(', ')}` : ''}
                        </div>
                      </li>
                    ))}
                  </ul>
                )
              }
            </Tile>

            <Tile
              icon="bell"
              title="Notifications"
              tile={p.notifications}
              action={
                <button
                  type="button"
                  className="text-xs font-medium text-accent hover:text-accent-hover"
                  onClick={() => go('notifications')}
                >
                  Open all
                </button>
              }
            >
              {(rows) =>
                rows.length === 0 ? (
                  <EmptyLine text="You're all caught up." />
                ) : (
                  <ul className="space-y-1.5">
                    {rows.slice(0, 8).map((n) => (
                      <li key={n.id}>
                        <button
                          type="button"
                          onClick={() => {
                            p.onMarkNotificationRead(n.id);
                            go(n.section);
                          }}
                          className="flex w-full items-start gap-2.5 rounded-lg px-1.5 py-1.5 text-left fill-hover"
                        >
                          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? 'bg-transparent' : (PRIORITY_DOT[n.priority] ?? 'bg-sysblue')}`} />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline justify-between gap-2">
                              <span className="truncate text-sm font-medium text-ink">{n.title}</span>
                              <span className="shrink-0 text-2xs text-faint">{formatRelative(n.at)}</span>
                            </span>
                            <span className="block truncate text-xs text-muted">{n.source} · {n.body}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              }
            </Tile>

            <div className="xl:col-span-2">
              <Tile icon="pulse" title="Productivity timeline" tile={p.timeline}>
                {(entries) =>
                  entries.length === 0 ? (
                    <EmptyLine text="Nothing recorded yet today." />
                  ) : (
                    <ul className="space-y-1.5">
                      {entries.map((e, i) => (
                        <li key={`${e.kind}-${e.at}-${i}`}>
                          <button
                            type="button"
                            onClick={() => go(e.section)}
                            className="flex w-full items-baseline gap-3 rounded-lg px-1.5 py-1 text-left fill-hover"
                          >
                            <span className="w-24 shrink-0 text-2xs tabular-nums text-faint">{formatRelative(e.at)}</span>
                            <span className="w-24 shrink-0 text-2xs font-medium uppercase tracking-wide text-faint">{e.kind}</span>
                            <span className="min-w-0 flex-1 truncate text-sm text-ink">{e.title}</span>
                            {e.detail && <span className="hidden shrink-0 text-xs text-muted sm:block">{e.detail}</span>}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )
                }
              </Tile>
            </div>
          </div>
        )}

        {/* ── My Work ───────────────────────────────────────────────────── */}
        {p.tab === 'my-work' && (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Tile icon="checklist" title="Tasks" tile={p.tasks}>
              {(board) =>
                board.assistant.length === 0 && board.connector.length === 0 ? (
                  <EmptyLine text="No open tasks. Ask the assistant to “add a task …”." />
                ) : (
                  <div className="space-y-3">
                    {board.assistant.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-faint">Assistant tasks</div>
                        <ul className="mt-1 space-y-1">
                          {board.assistant.map((t) => (
                            <li key={t.id} className="flex items-baseline justify-between gap-3 text-sm">
                              <span className="min-w-0 truncate text-ink">{t.title}</span>
                              <span className="shrink-0 text-2xs text-faint">
                                {t.priority === 'high' ? 'high · ' : ''}
                                {t.due ? `due ${formatRelative(t.due)}` : 'no due date'}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {board.connector.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-faint">From connected systems</div>
                        <ul className="mt-1 space-y-1">
                          {board.connector.map((t) => (
                            <li key={t.id} className="flex items-baseline justify-between gap-3 text-sm">
                              <span className="min-w-0 truncate text-ink">{t.title}</span>
                              <span className="shrink-0 text-2xs text-faint">{t.connectorId}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )
              }
            </Tile>

            <Tile icon="doc" title="Emails" tile={p.emails}>
              {(rows) =>
                rows.length === 0 ? (
                  <EmptyLine text="No messages synced yet." />
                ) : (
                  <ul className="space-y-1.5">
                    {rows.map((m) => (
                      <li key={m.id} className="flex items-start gap-2.5">
                        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${m.unread ? 'bg-accent' : 'bg-transparent'}`} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-sm font-medium text-ink">{m.title}</span>
                            <span className="shrink-0 text-2xs text-faint">{formatRelative(m.at)}</span>
                          </div>
                          <div className="truncate text-xs text-muted">
                            {m.author ?? 'Unknown sender'} · {m.category} · {m.why}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )
              }
            </Tile>

            <Tile
              icon="shield"
              title="Approvals waiting"
              tile={p.approvals}
              action={
                <button
                  type="button"
                  className="text-xs font-medium text-accent hover:text-accent-hover"
                  onClick={() => go('workforce')}
                >
                  Approval Center
                </button>
              }
            >
              {(rows) =>
                rows.length === 0 ? (
                  <EmptyLine text="Nothing is waiting for you." />
                ) : (
                  <ul className="space-y-1.5">
                    {rows.map((a) => (
                      <li key={a.id} className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="min-w-0 truncate text-ink">{a.title}</span>
                        <span className="shrink-0 text-2xs text-faint">{formatRelative(a.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                )
              }
            </Tile>

            <Tile
              icon="sparkles"
              title="Assistant conversations"
              tile={p.conversations}
              action={
                <button
                  type="button"
                  className="text-xs font-medium text-accent hover:text-accent-hover"
                  onClick={() => go('assistant')}
                >
                  Open Assistant
                </button>
              }
            >
              {(rows) =>
                rows.length === 0 ? (
                  <EmptyLine text="No conversations yet." />
                ) : (
                  <ul className="space-y-1.5">
                    {rows.slice(0, 8).map((c) => (
                      <li key={c.id} className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="min-w-0 truncate text-ink">{c.title}</span>
                        <span className="shrink-0 text-2xs text-faint">
                          {(c.waitingSteps ?? 0) > 0 ? `${c.waitingSteps} waiting · ` : ''}
                          {formatRelative(c.updatedAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )
              }
            </Tile>

            <div className="xl:col-span-2">
              <Tile icon="list" title="Work summary (today)" tile={p.summary}>
                {(s) =>
                  !s.grounded ? (
                    <EmptyLine text="Nothing recorded yet today — the summary fills in as work happens." />
                  ) : (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {s.sections.map((sec) => (
                        <div key={sec.title}>
                          <div className="text-xs font-semibold uppercase tracking-wide text-faint">{sec.title}</div>
                          <ul className="mt-1 space-y-1">
                            {sec.lines.map((l) => (
                              <li key={l} className="text-sm text-muted">{l}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )
                }
              </Tile>
            </div>
          </div>
        )}

        {/* ── Executive ─────────────────────────────────────────────────── */}
        {p.tab === 'executive' && (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <div className="xl:col-span-2">
              <Tile icon="gauge" title="Executive snapshot" tile={p.executive}>
                {(cards) => (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
                    {cards.map((c) => (
                      <div key={c.label} className="rounded-xl border border-[var(--border)] p-3">
                        <div className="text-2xs font-semibold uppercase tracking-wide text-faint">{c.label}</div>
                        <div
                          className={`mt-1 text-base font-semibold ${
                            c.tone === 'ok' ? 'text-sysgreen' : c.tone === 'warn' ? 'text-sysorange' : c.tone === 'bad' ? 'text-syspink' : 'text-ink'
                          }`}
                        >
                          {c.value}
                        </div>
                        {c.detail && <div className="mt-0.5 text-2xs leading-snug text-muted">{c.detail}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </Tile>
            </div>

            <Tile icon="lightbulb" title="Top recommendations" tile={p.recommendations}>
              {(cards) =>
                cards.length === 0 ? (
                  <EmptyLine text="No recommendations right now." />
                ) : (
                  <ul className="space-y-1.5">
                    {cards.slice(0, 6).map((c) => (
                      <li key={c.id} className="flex items-baseline gap-2 text-sm">
                        <span className={`h-2 w-2 shrink-0 self-center rounded-full ${PRIORITY_DOT[c.priority] ?? 'bg-sysblue'}`} />
                        <span className="min-w-0 flex-1 truncate text-ink">{c.title}</span>
                        <span className="shrink-0 text-2xs text-faint">{c.kind.replace(/_/g, ' ')}</span>
                      </li>
                    ))}
                  </ul>
                )
              }
            </Tile>

            <Tile icon="checklist" title="Recent decisions" tile={p.decisions}>
              {(rows) =>
                rows.length === 0 ? (
                  <EmptyLine text="No decisions recorded yet." />
                ) : (
                  <ul className="space-y-1.5">
                    {rows.map((d) => (
                      <li key={d.id} className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="min-w-0 truncate text-ink">{d.title}</span>
                        <span className="shrink-0 text-2xs uppercase tracking-wide text-faint">{d.status.replace(/_/g, ' ')}</span>
                      </li>
                    ))}
                  </ul>
                )
              }
            </Tile>
          </div>
        )}
      </div>
    </div>
  );
}
