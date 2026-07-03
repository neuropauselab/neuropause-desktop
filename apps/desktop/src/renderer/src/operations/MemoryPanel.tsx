import { useEffect, useMemo, useState } from 'react';
import type { ExecutiveMemoryView, MemoryAuditEvent } from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/cn';
import { formatRelative } from '@renderer/lib/format';
import { Icon } from '@renderer/components/ui/Icon';
import type { IconName } from '@renderer/components/ui/Icon';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { OpsPanel, IconAction } from './primitives';
import { TINT_TONE } from './lib';
import type { OpsTone } from './lib';

const byNewest = (a: ExecutiveMemoryView, b: ExecutiveMemoryView): number =>
  Date.parse(b.createdAt) - Date.parse(a.createdAt);

/**
 * Executive Workspace — Memory panel. A read/manage view over what Founder AI
 * remembers: open + recent decisions, remembered priorities, recent conversations,
 * pinned items, free-text search, and the audit feed. Pin / resolve / forget act
 * through the executive-memory IPC; nothing here can surface a secret (the
 * governance screen refused those before they were ever stored).
 */
export function MemoryPanel(): JSX.Element {
  const [all, setAll] = useState<ExecutiveMemoryView[]>([]);
  const [audit, setAudit] = useState<MemoryAuditEvent[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async (): Promise<void> => {
    setLoading(true);
    try {
      const [mem, aud] = await Promise.all([
        ipc.execMemory.search({ limit: 200 }),
        ipc.execMemory.audit({ limit: 12 }),
      ]);
      setAll(mem);
      setAudit(aud.entries);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    await fn();
    await load();
  };
  const pin = (m: ExecutiveMemoryView): Promise<void> =>
    act(() => ipc.execMemory.pin(m.id, !m.pinned));
  const resolve = (m: ExecutiveMemoryView): Promise<void> =>
    act(() => ipc.execMemory.resolve(m.id, 'resolved'));
  const forget = (m: ExecutiveMemoryView): Promise<void> => act(() => ipc.execMemory.forget(m.id));

  const openDecisions = useMemo(
    () => all.filter((m) => m.type === 'decision' && m.status === 'open').sort(byNewest),
    [all],
  );
  const recentDecisions = useMemo(
    () =>
      all
        .filter((m) => m.type === 'decision')
        .sort(byNewest)
        .slice(0, 6),
    [all],
  );
  const priorities = useMemo(
    () =>
      all
        .filter((m) => m.type === 'preference')
        .sort(byNewest)
        .slice(0, 6),
    [all],
  );
  const conversations = useMemo(
    () =>
      all
        .filter((m) => m.type === 'conversation')
        .sort(byNewest)
        .slice(0, 6),
    [all],
  );
  const pinned = useMemo(() => all.filter((m) => m.pinned).sort(byNewest), [all]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return all
      .filter((m) =>
        `${m.title} ${m.content} ${m.project ?? ''} ${m.worker ?? ''} ${m.connectorId ?? ''} ${m.type}`
          .toLowerCase()
          .includes(q),
      )
      .sort(byNewest);
  }, [all, query]);

  const rowActions = (m: ExecutiveMemoryView): JSX.Element => (
    <div className="flex items-center gap-0.5">
      {m.type === 'decision' && m.status === 'open' && (
        <IconAction
          icon="check"
          label="Mark resolved"
          tone="green"
          onClick={() => void resolve(m)}
        />
      )}
      <IconAction
        icon="pin"
        label={m.pinned ? 'Unpin' : 'Pin'}
        tone={m.pinned ? 'purple' : 'gray'}
        onClick={() => void pin(m)}
      />
      <IconAction icon="trash" label="Forget" tone="red" onClick={() => void forget(m)} />
    </div>
  );

  return (
    <OpsPanel
      title="Memory"
      subtitle="What Founder AI remembers from your executive conversations — decisions, priorities, discussions. Never secrets."
      actions={<IconAction icon="refresh" label="Refresh" onClick={() => void load()} />}
    >
      <div className="mb-4 flex items-center gap-2 rounded-xl border border-[var(--hairline)] px-3 py-2 focus-within:shadow-focus">
        <Icon name="search" size={15} className="text-faint" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search memory — keyword, project, worker, connector…"
          className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-faint"
        />
        {query && <IconAction icon="close" label="Clear" onClick={() => setQuery('')} />}
      </div>

      {loading && all.length === 0 ? (
        <div className="flex items-center gap-2 rounded-2xl border border-[var(--hairline)] p-4 text-sm text-muted">
          <Icon name="memory" size={14} className="text-faint" /> Loading memory…
        </div>
      ) : all.length === 0 ? (
        <EmptyState
          icon="memory"
          title="No memories yet"
          description="Ask Founder AI a question or state a decision — “I approved Release 1.0”, “our top priority is the mobile app” — and it’ll be remembered here."
        />
      ) : results !== null ? (
        <Section title="Search results" icon="search" tone="blue" count={results.length}>
          <MemoryList items={results} empty="No matches." actions={rowActions} />
        </Section>
      ) : (
        <div className="space-y-4">
          <Section title="Open decisions" icon="bolt" tone="orange" count={openDecisions.length}>
            <MemoryList
              items={openDecisions}
              empty="No decisions are awaiting resolution."
              actions={rowActions}
            />
          </Section>
          <Section
            title="Remembered priorities"
            icon="lightbulb"
            tone="purple"
            count={priorities.length}
          >
            <MemoryList items={priorities} empty="No priorities stated yet." actions={rowActions} />
          </Section>
          <Section
            title="Recent decisions"
            icon="check"
            tone="green"
            count={recentDecisions.length}
          >
            <MemoryList
              items={recentDecisions}
              empty="No decisions remembered yet."
              actions={rowActions}
            />
          </Section>
          <Section
            title="Recent conversations"
            icon="sparkles"
            tone="blue"
            count={conversations.length}
          >
            <MemoryList
              items={conversations}
              empty="No conversations kept yet."
              actions={rowActions}
            />
          </Section>
          <Section title="Pinned" icon="pin" tone="accent" count={pinned.length}>
            <MemoryList
              items={pinned}
              empty="Nothing pinned. Pin a memory to keep it surfaced here."
              actions={rowActions}
            />
          </Section>
          <AuditFeed events={audit} />
        </div>
      )}
    </OpsPanel>
  );
}

function Section({
  title,
  icon,
  tone,
  count,
  children,
}: {
  title: string;
  icon: IconName;
  tone: OpsTone;
  count: number;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="rounded-2xl border border-[var(--hairline)] p-4">
      <div className="mb-2 flex items-center gap-2">
        <span
          className={cn('flex h-6 w-6 items-center justify-center rounded-lg', TINT_TONE[tone])}
        >
          <Icon name={icon} size={13} />
        </span>
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <span className="text-2xs text-faint">{count}</span>
      </div>
      {children}
    </div>
  );
}

function MemoryList({
  items,
  empty,
  actions,
}: {
  items: ExecutiveMemoryView[];
  empty: string;
  actions: (m: ExecutiveMemoryView) => JSX.Element;
}): JSX.Element {
  if (items.length === 0) return <p className="text-2xs text-faint">{empty}</p>;
  return (
    <ul className="space-y-0.5">
      {items.map((m) => (
        <li key={m.id} className="flex items-start gap-2 rounded-lg px-1 py-1 fill-hover">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-syspurple" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-ink">{m.content}</p>
            <p className="flex flex-wrap gap-x-2 text-2xs text-faint">
              <span>{m.type}</span>
              {m.project && <span>· {m.project}</span>}
              {m.worker && <span>· {m.worker}</span>}
              {m.connectorId && <span>· {m.connectorId}</span>}
              <span>· {formatRelative(m.createdAt)}</span>
              <span>· {Math.round(m.confidence * 100)}% conf</span>
              {m.status === 'open' && <span className="text-sysorange">· open</span>}
              {m.scope !== 'longterm' && <span>· {m.scope}</span>}
            </p>
          </div>
          {actions(m)}
        </li>
      ))}
    </ul>
  );
}

const AUDIT_TONE: Record<string, OpsTone> = {
  created: 'green',
  used: 'blue',
  forgotten: 'gray',
  rejected: 'red',
  pinned: 'purple',
  updated: 'orange',
};

function AuditFeed({ events }: { events: MemoryAuditEvent[] }): JSX.Element | null {
  if (events.length === 0) return null;
  return (
    <Section title="Recent memory activity" icon="clock" tone="gray" count={events.length}>
      <ul className="space-y-1">
        {events.map((e) => (
          <li key={e.id} className="flex items-start gap-2 text-2xs">
            <span
              className={cn(
                'shrink-0 rounded px-1.5 py-0.5 font-medium',
                TINT_TONE[AUDIT_TONE[e.action] ?? 'gray'],
              )}
            >
              {e.action}
            </span>
            <span className="min-w-0 flex-1 text-muted">{e.detail}</span>
            <span className="shrink-0 text-faint">{formatRelative(e.at)}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
