/**
 * Microsoft Entra detail panel (Phase P2.2) — an Entra-specific section rendered inside the existing
 * ConnectorDetail (gated on `dto.id === 'microsoft-entra'`, no new navigation, no redesign). Every value is
 * REAL: the Microsoft Graph API version the adapter targets, the live directory-sync health from the
 * already-wired `ipc.connectors.syncState` feed scored by the P2.1 `computeIntegrationHealth` engine, the
 * granted-permission status (from the OAuth grant on each account), and per-account access-token expiry.
 * Nothing is fabricated — when nothing has synced yet it says so.
 */
import { useEffect, useState } from 'react';
import type { ConnectorDto, ConnectorSyncSnapshot } from '@neuropause/shared';
import { GRAPH_API_VERSION, M365_MODULE_IDS, computeIntegrationHealth, formatDurationMs } from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/cn';
import { Icon } from '@renderer/components/ui/Icon';
import { StatusDot } from '@renderer/operations/primitives';
import type { OpsTone } from '@renderer/operations/lib';
import { relativeTime } from './connectorLib';

const STATE_TONE: Record<string, OpsTone> = {
  healthy: 'green',
  degraded: 'orange',
  unhealthy: 'red',
  idle: 'gray',
};

function Title({ children }: { children: string }): JSX.Element {
  return (
    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">{children}</div>
  );
}

function fmtExpiry(iso: string | null, nowMs: number): { text: string; soon: boolean } {
  if (!iso) return { text: 'n/a', soon: false };
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return { text: '—', soon: false };
  const delta = t - nowMs;
  if (delta <= 0) return { text: 'expired', soon: true };
  const min = Math.round(delta / 60_000);
  return { text: min < 60 ? `in ${min}m` : `in ${Math.round(min / 60)}h`, soon: delta < 5 * 60_000 };
}

/* ── Microsoft 365 module status (mail / calendar / OneDrive / contacts / teams) ───────── */

const M365_LABEL_FALLBACK: Record<string, string> = {
  mail: 'Outlook Mail',
  calendar: 'Calendar',
  drive: 'OneDrive',
  contacts: 'Contacts',
  teams: 'Teams',
};

type M365ModuleStatus = 'ok' | 'unauthorized' | 'unprovisioned' | 'pending';

const M365_BADGE: Record<M365ModuleStatus, { tone: OpsTone; text: string; className: string }> = {
  ok: { tone: 'green', text: 'Authorized', className: 'text-sysgreen' },
  unauthorized: { tone: 'orange', text: 'Permission missing', className: 'text-sysorange' },
  unprovisioned: { tone: 'gray', text: 'Provisioning…', className: 'text-faint' },
  pending: { tone: 'gray', text: 'Awaiting first sync', className: 'text-faint' },
};

interface M365ModuleRow {
  id: string;
  label: string;
  count: number;
  status: M365ModuleStatus;
  lastSyncAt: string | null;
}

/** Fold the per-account module stats into one row per Microsoft 365 module (worst status wins). */
function aggregateM365Modules(snaps: ConnectorSyncSnapshot[]): M365ModuleRow[] {
  const all = snaps.flatMap((s) => s.modules ?? []);
  return M365_MODULE_IDS.map((id) => {
    const found = all.filter((m) => m.id === id);
    if (found.length === 0) {
      return { id, label: M365_LABEL_FALLBACK[id], count: 0, status: 'pending', lastSyncAt: null };
    }
    const count = found.reduce((n, m) => n + m.objectCount, 0);
    const status: M365ModuleStatus = found.some((m) => m.status === 'unauthorized')
      ? 'unauthorized'
      : found.some((m) => m.status === 'unprovisioned')
        ? 'unprovisioned'
        : 'ok';
    const lastSyncAt = found.reduce<string | null>(
      (acc, m) => (m.lastSyncAt && (!acc || m.lastSyncAt > acc) ? m.lastSyncAt : acc),
      null,
    );
    return { id, label: found[0].label || M365_LABEL_FALLBACK[id], count, status, lastSyncAt };
  });
}

export function EntraConnectorPanel({ dto }: { dto: ConnectorDto }): JSX.Element {
  const [snaps, setSnaps] = useState<ConnectorSyncSnapshot[]>([]);

  useEffect(() => {
    let alive = true;
    void ipc.connectors
      .syncState(dto.id)
      .then((s) => {
        if (alive) setSnaps(s);
      })
      .catch(() => undefined);
    const off = ipc.connectors.onSyncState((s) => {
      if (alive) setSnaps(s.filter((x) => x.connectorId === dto.id));
    });
    return () => {
      alive = false;
      off();
    };
  }, [dto.id]);

  const now = Date.now();
  const labelById = new Map(dto.accounts.map((a) => [a.id, a.label]));
  const expiryById = new Map(
    dto.accounts.map((a) => [a.id, a.accessTokenExpiresAt ? Date.parse(a.accessTokenExpiresAt) : null]),
  );
  const granted = new Set(dto.accounts.flatMap((a) => a.grantedScopes));
  const objectsSynced = snaps.reduce((n, s) => n + s.entityCount, 0);

  return (
    <section className="mb-6">
      <Title>Microsoft Entra directory</Title>

      {/* Graph summary */}
      <div className="mb-3 flex flex-wrap items-center gap-2.5 rounded-xl border border-[var(--hairline)] px-3.5 py-2.5 text-2xs">
        <span className="inline-flex items-center gap-1.5 rounded-md [background:var(--fill-2)] px-2 py-0.5 font-medium text-muted">
          <Icon name="globe" size={12} /> Microsoft Graph {GRAPH_API_VERSION}
        </span>
        <span className="text-faint">
          <span className="font-semibold text-ink">{objectsSynced}</span> objects synced
        </span>
      </div>

      {/* Directory sync (live health) */}
      {snaps.length === 0 ? (
        <p className="mb-3 text-2xs text-faint">
          No directory sync yet — connect and run a sync to populate users, groups, and organization.
        </p>
      ) : (
        <div className="mb-3 space-y-1.5">
          {snaps.map((s) => {
            const h = computeIntegrationHealth(s, now, { authExpiresAt: expiryById.get(s.accountId) ?? null });
            return (
              <div
                key={s.accountId}
                className="flex items-center gap-3 rounded-xl [background:var(--fill-2)] px-3 py-2 text-2xs"
              >
                <StatusDot tone={STATE_TONE[h.state] ?? 'gray'} pulse={h.state === 'unhealthy'} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-ink">
                    {labelById.get(s.accountId) ?? s.accountId}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-faint">
                    <span>Health {h.score}</span>
                    <span className="capitalize">{s.status.replace('_', ' ')}</span>
                    <span>{s.entityCount} objects</span>
                    <span>Last {s.lastSyncAt ? relativeTime(s.lastSyncAt) : 'never'}</span>
                    {s.lastDurationMs !== null && <span>{formatDurationMs(s.lastDurationMs)}</span>}
                    {h.errors.length > 0 && <span className="text-syspink">{h.errors[0]}</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Microsoft 365 modules — per-module status on the same Graph token (mail/calendar/drive/contacts/teams) */}
      <Title>Microsoft 365 modules</Title>
      <div className="mb-3 overflow-hidden rounded-xl border border-[var(--hairline)]">
        {aggregateM365Modules(snaps).map((m, idx) => {
          const badge = M365_BADGE[m.status];
          return (
            <div
              key={m.id}
              className={cn(
                'flex items-center gap-2.5 px-3.5 py-2 text-2xs',
                idx > 0 && 'border-t border-[var(--hairline)]',
              )}
            >
              <StatusDot tone={badge.tone} />
              <span className="min-w-0 flex-1 truncate font-medium text-ink">{m.label}</span>
              {m.status === 'ok' && (
                <span className="shrink-0 tabular-nums text-faint">
                  {m.count} object{m.count === 1 ? '' : 's'}
                </span>
              )}
              {m.status === 'ok' && m.lastSyncAt && (
                <span className="shrink-0 text-faint">· {relativeTime(m.lastSyncAt)}</span>
              )}
              <span className={cn('shrink-0', badge.className)}>{badge.text}</span>
            </div>
          );
        })}
      </div>
      <p className="mb-3 text-2xs text-faint">
        Modules ride the same Microsoft Graph token as the directory sync. “Permission missing” means the
        Graph scope wasn’t granted or the module isn’t licensed; “Provisioning…” means the mailbox or
        OneDrive isn’t set up yet.
      </p>

      {/* Permission viewer (granted status) */}
      <Title>Directory permissions</Title>
      <div className="mb-3 overflow-hidden rounded-xl border border-[var(--hairline)]">
        {dto.scopes.map((scope, idx) => {
          const ok = granted.has(scope.id);
          return (
            <div
              key={scope.id}
              className={cn(
                'flex items-center gap-2.5 px-3.5 py-2 text-2xs',
                idx > 0 && 'border-t border-[var(--hairline)]',
              )}
            >
              <Icon
                name={ok ? 'check' : 'lock'}
                size={13}
                className={cn('shrink-0', ok ? 'text-sysgreen' : 'text-faint')}
              />
              <span className="min-w-0 flex-1 truncate font-medium text-ink">{scope.label}</span>
              <span className={cn('shrink-0', ok ? 'text-sysgreen' : 'text-faint')}>
                {dto.accounts.length === 0 ? 'requested' : ok ? 'granted' : 'not granted'}
              </span>
            </div>
          );
        })}
      </div>

      {/* Access token expiry */}
      {dto.accounts.length > 0 && (
        <>
          <Title>Access tokens</Title>
          <div className="overflow-hidden rounded-xl border border-[var(--hairline)]">
            {dto.accounts.map((a, idx) => {
              const exp = fmtExpiry(a.accessTokenExpiresAt, now);
              return (
                <div
                  key={a.id}
                  className={cn(
                    'flex items-center justify-between gap-3 px-3.5 py-2 text-2xs',
                    idx > 0 && 'border-t border-[var(--hairline)]',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate text-ink">{a.label}</span>
                  <span className={cn('shrink-0 tabular-nums', exp.soon ? 'text-sysorange' : 'text-faint')}>
                    token {exp.text}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
